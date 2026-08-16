import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { DataIntegrityError } from "../lib/data/external-storage-errors";
import { SupabaseHttpClient, type FetchLike } from "../lib/data/supabase-client";
import {
  parseWatchlistCreateResult,
  parseWatchlistImpactResponse,
  PlaybookPackageWatchlistStore,
} from "../lib/monitoring/package-watchlists";

const PACKAGE_ID = "package:stablecoin-pre-listing:aaaaaaaaaaaaaaaa";
const EVENT_ID = "event:eea:mica:2026-08-14";

test("watchlist store creates an exact package-derived watchlist", async () => {
  const calls: Array<{ functionName: string; body: Record<string, unknown> }> = [];
  const fetch: FetchLike = async (input, init) => {
    const url = new URL(String(input));
    calls.push({
      functionName: url.pathname.split("/").at(-1) ?? "",
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    return Response.json({ status: "CREATED", watchlist: watchlistFixture() });
  };

  const result = await new PlaybookPackageWatchlistStore(client(fetch)).create(PACKAGE_ID);
  assert.deepEqual(result, { status: "CREATED", watchlist: watchlistFixture() });
  assert.deepEqual(calls, [{
    functionName: "create_playbook_package_watchlist",
    body: { p_package_id: PACKAGE_ID },
  }]);
});

test("watchlist creation parser preserves typed replay and rejection outcomes", () => {
  assert.deepEqual(parseWatchlistCreateResult({
    status: "REPLAYED",
    watchlist: watchlistFixture(),
  }, PACKAGE_ID), {
    status: "REPLAYED",
    watchlist: watchlistFixture(),
  });
  assert.deepEqual(parseWatchlistCreateResult({ status: "NOT_FOUND" }, PACKAGE_ID), {
    status: "NOT_FOUND",
  });
  assert.deepEqual(parseWatchlistCreateResult({
    status: "NOT_WATCHLISTABLE",
    reason: "EMPTY_DEPENDENCIES",
  }, PACKAGE_ID), {
    status: "NOT_WATCHLISTABLE",
    reason: "EMPTY_DEPENDENCIES",
  });
});

test("watchlist creation rejects expanded or cross-package database responses", () => {
  assert.throws(() => parseWatchlistCreateResult({
    status: "CREATED",
    watchlist: watchlistFixture(),
    customerId: "must-not-cross-boundary",
  }, PACKAGE_ID), DataIntegrityError);
  assert.throws(() => parseWatchlistCreateResult({
    status: "CREATED",
    watchlist: { ...watchlistFixture(), packageId: "package:other:bbbbbbbbbbbbbbbb" },
  }, PACKAGE_ID), /watchlist package identity mismatch/);
});

test("watchlist impact lookup returns canonical published reviewed matches", async () => {
  const response = impactFixture();
  const fetch: FetchLike = async () => Response.json(response);
  const store = new PlaybookPackageWatchlistStore(client(fetch));
  assert.deepEqual(await store.findByPublishedEvent(EVENT_ID), response);
});

test("watchlist impact parser rejects unpublished, duplicate, or expanded data", () => {
  assert.throws(
    () => parseWatchlistImpactResponse({ ...impactFixture(), eventState: "REVIEWED" }),
    DataIntegrityError,
  );
  assert.throws(
    () => parseWatchlistImpactResponse({ ...impactFixture(), subscriptionId: "private" }),
    DataIntegrityError,
  );
  assert.throws(() => parseWatchlistImpactResponse({
    ...impactFixture(),
    watchlists: [impactFixture().watchlists[0], impactFixture().watchlists[0]],
  }), /duplicate affected playbook watchlist/);
});

test("watchlist response validates against its strict JSON Schema", async () => {
  const schema = JSON.parse(await readFile(path.join(
    process.cwd(), "contracts/v1/playbook-watchlist-response.schema.json",
  ), "utf8")) as object;
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  assert.equal(validate(watchlistFixture()), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...watchlistFixture(), customerId: "private" }), false);
});

function watchlistFixture() {
  return {
    schemaVersion: "1.0.0" as const,
    watchlistId: "watchlist:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    packageId: PACKAGE_ID,
    state: "ACTIVE" as const,
    createdAt: "2026-08-14T20:00:00.000Z",
  };
}

function impactFixture() {
  return {
    schemaVersion: "1.0.0" as const,
    eventId: EVENT_ID,
    eventState: "PUBLISHED" as const,
    watchlists: [{
      watchlistId: "watchlist:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      createdAt: "2026-08-14T20:00:00.000Z",
      packageId: PACKAGE_ID,
      playbookId: "stablecoin-pre-listing",
      evaluatedAt: "2026-08-12T00:00:00.000Z",
      assuranceReviewStatus: "PROVISIONAL" as const,
      claimImpacts: [{
        claimId: "claim:eea:mica:e-money-token-authorisation:18",
        impactType: "MAY_AFFECT" as const,
      }],
    }],
  };
}

function client(fetchImpl: FetchLike): SupabaseHttpClient {
  return new SupabaseHttpClient({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role-key",
    reportsBucket: "policy-reports",
    datasetsBucket: "policy-datasets",
    sourcesBucket: "policy-sources",
    requestTimeoutMs: 1_000,
  }, fetchImpl);
}
