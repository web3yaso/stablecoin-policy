import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { DataIntegrityError } from "../lib/data/external-storage-errors";
import { SupabaseHttpClient, type FetchLike } from "../lib/data/supabase-client";
import {
  decodeChangeDeltaCursor,
  encodeChangeDeltaCursor,
  InvalidChangeDeltaCursorError,
  parseDeltaListResult,
  PlaybookWatchlistChangeDeltaStore,
} from "../lib/monitoring/change-to-action-deltas";

const PACKAGE_ID = "package:stablecoin-pre-listing:aaaaaaaaaaaaaaaa";
const OTHER_PACKAGE_ID = "package:stablecoin-pre-listing:bbbbbbbbbbbbbbbb";
const WATCHLIST_ID = "watchlist:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

test("change delta store binds an opaque cursor to the exact package and watchlist", async () => {
  const calls: Array<{ functionName: string; body: Record<string, unknown> }> = [];
  const fetch: FetchLike = async (input, init) => {
    const url = new URL(String(input));
    calls.push({
      functionName: url.pathname.split("/").at(-1) ?? "",
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    return Response.json(rawPageFixture());
  };
  const result = await new PlaybookWatchlistChangeDeltaStore(client(fetch)).list(
    PACKAGE_ID,
    undefined,
    25,
  );
  assert.equal(result.status, "OK");
  if (result.status !== "OK") return;
  assert.equal(result.page.items.length, 1);
  assert.deepEqual(
    decodeChangeDeltaCursor(result.page.items[0].cursor, PACKAGE_ID),
    { watchlistId: WATCHLIST_ID, sequence: 7 },
  );
  assert.deepEqual(
    decodeChangeDeltaCursor(result.page.nextCursor, PACKAGE_ID),
    { watchlistId: WATCHLIST_ID, sequence: 7 },
  );
  assert.deepEqual(calls, [{
    functionName: "get_playbook_watchlist_change_deltas",
    body: {
      p_package_id: PACKAGE_ID,
      p_after_sequence: 0,
      p_cursor_watchlist_id: null,
      p_limit: 25,
    },
  }]);
});

test("change delta store forwards a decoded watchlist-bound cursor", async () => {
  const cursor = encodeChangeDeltaCursor(PACKAGE_ID, WATCHLIST_ID, 7);
  let body: Record<string, unknown> | null = null;
  const fetch: FetchLike = async (_input, init) => {
    body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    return Response.json({
      ...rawPageFixture(),
      items: [],
      nextSequence: 7,
      hasMore: false,
    });
  };
  const result = await new PlaybookWatchlistChangeDeltaStore(client(fetch)).list(
    PACKAGE_ID,
    cursor,
  );
  assert.equal(result.status, "OK");
  assert.deepEqual(body, {
    p_package_id: PACKAGE_ID,
    p_after_sequence: 7,
    p_cursor_watchlist_id: WATCHLIST_ID,
    p_limit: 50,
  });
});

test("empty page returns a reusable watchlist-bound zero cursor", () => {
  const parsed = parseDeltaListResult({
    ...rawPageFixture(),
    items: [],
    nextSequence: 0,
    hasMore: false,
  }, PACKAGE_ID, 0, 50);
  assert.equal(parsed.status, "OK");
  if (parsed.status !== "OK") return;
  assert.deepEqual(
    decodeChangeDeltaCursor(parsed.page.nextCursor, PACKAGE_ID),
    { watchlistId: WATCHLIST_ID, sequence: 0 },
  );
});

test("change delta cursor rejects another package, expansion, and malformed input", () => {
  const cursor = encodeChangeDeltaCursor(PACKAGE_ID, WATCHLIST_ID, 7);
  assert.throws(
    () => decodeChangeDeltaCursor(cursor, OTHER_PACKAGE_ID),
    InvalidChangeDeltaCursorError,
  );
  const expanded = Buffer.from(JSON.stringify({
    version: 1,
    packageId: PACKAGE_ID,
    watchlistId: WATCHLIST_ID,
    sequence: 7,
    customerId: "must-not-cross-boundary",
  })).toString("base64url");
  assert.throws(
    () => decodeChangeDeltaCursor(expanded, PACKAGE_ID),
    InvalidChangeDeltaCursorError,
  );
  assert.throws(
    () => decodeChangeDeltaCursor("not-json", PACKAGE_ID),
    InvalidChangeDeltaCursorError,
  );
  assert.throws(
    () => decodeChangeDeltaCursor(`${cursor}!`, PACKAGE_ID),
    InvalidChangeDeltaCursorError,
  );
});

test("change delta parser preserves typed not-found and invalid-cursor outcomes", () => {
  assert.deepEqual(parseDeltaListResult(
    { status: "NOT_FOUND" }, PACKAGE_ID, 0, 50,
  ), { status: "NOT_FOUND" });
  assert.throws(
    () => parseDeltaListResult(
      { status: "INVALID_CURSOR" }, PACKAGE_ID, 7, 50,
    ),
    InvalidChangeDeltaCursorError,
  );
});

test("change delta parser rejects reordered, duplicate, expanded, or regressing data", () => {
  const fixture = rawPageFixture();
  assert.throws(() => parseDeltaListResult({
    ...fixture,
    items: [{ ...fixture.items[0], customerId: "private" }],
  }, PACKAGE_ID, 0, 50), DataIntegrityError);
  assert.throws(() => parseDeltaListResult({
    ...fixture,
    items: [{
      ...fixture.items[0],
      actions: ["REQUEST_PLAYBOOK_RERUN", "REVIEW_EVIDENCE_CHANGE"],
    }],
  }, PACKAGE_ID, 0, 50), DataIntegrityError);
  assert.throws(() => parseDeltaListResult({
    ...fixture,
    items: [{
      ...fixture.items[0],
      evidenceChanges: [
        fixture.items[0].evidenceChanges[0],
        fixture.items[0].evidenceChanges[0],
      ],
    }],
  }, PACKAGE_ID, 0, 50), /duplicate change delta claim impact/);
  assert.throws(() => parseDeltaListResult(
    { ...fixture, nextSequence: 6 }, PACKAGE_ID, 0, 50,
  ), /next cursor mismatch/);
});

test("change delta response validates against its strict JSON Schema", async () => {
  const parsed = parseDeltaListResult(rawPageFixture(), PACKAGE_ID, 0, 50);
  assert.equal(parsed.status, "OK");
  if (parsed.status !== "OK") return;
  const schema = JSON.parse(await readFile(path.join(
    process.cwd(),
    "contracts/v1/playbook-watchlist-changes-response.schema.json",
  ), "utf8")) as object;
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  assert.equal(validate(parsed.page), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...parsed.page, customerId: "private" }), false);
});

function rawPageFixture() {
  return {
    status: "OK",
    schemaVersion: "1.0.0",
    watchlistId: WATCHLIST_ID,
    packageId: PACKAGE_ID,
    items: [{
      deltaId: "delta:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      deltaSequence: 7,
      watchlistId: WATCHLIST_ID,
      packageId: PACKAGE_ID,
      event: {
        eventId: "event:eea:mica:2026-08-16",
        eventType: "AMENDMENT",
        title: "Sanitized reviewed evidence change",
        publishedAt: "2026-08-16T12:00:00.000Z",
        effectiveAt: null,
        beforeVersionId: "version:mica:1",
        afterVersionId: "version:mica:2",
      },
      evidenceChanges: [{
        claimId: "claim:eea:mica:authorization",
        impactType: "MAY_AFFECT",
      }],
      status: "REVIEW_REQUIRED",
      packageAssuranceReviewStatus: "PROVISIONAL",
      actions: ["REVIEW_EVIDENCE_CHANGE", "REQUEST_PLAYBOOK_RERUN"],
      requiredCustomerResponse: "ACKNOWLEDGE_AND_RERUN",
      createdAt: "2026-08-16T12:00:01.000Z",
    }],
    nextSequence: 7,
    hasMore: false,
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
