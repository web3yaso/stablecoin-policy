import assert from "node:assert/strict";
import test from "node:test";
import { DataIntegrityError } from "../lib/data/external-storage-errors";
import { SupabaseHttpClient, type FetchLike } from "../lib/data/supabase-client";
import {
  PackageImpactIndex,
  parsePackageImpactResponse,
} from "../lib/monitoring/package-impact";

const EVENT_ID = "event:eea:mica:2026-08-14";

test("package impact index returns only canonical published reviewed matches", async () => {
  const response = fixture();
  const calls: Array<{ functionName: string; body: Record<string, unknown> }> = [];
  const fetch: FetchLike = async (input, init) => {
    const url = new URL(String(input));
    const functionName = url.pathname.split("/").at(-1) ?? "";
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ functionName, body });
    return Response.json(response);
  };
  const index = new PackageImpactIndex(client(fetch));

  assert.deepEqual(await index.findByPublishedEvent(EVENT_ID), response);
  assert.deepEqual(calls, [{
    functionName: "get_affected_playbook_packages",
    body: { p_event_id: EVENT_ID },
  }]);
});

test("package impact parser rejects unpublished, non-canonical, or expanded responses", () => {
  assert.throws(
    () => parsePackageImpactResponse({ ...fixture(), eventState: "REVIEWED" }),
    DataIntegrityError,
  );
  assert.throws(
    () => parsePackageImpactResponse({ ...fixture(), privateProfile: {} }),
    DataIntegrityError,
  );
  assert.throws(
    () => parsePackageImpactResponse({
      ...fixture(),
      packages: [fixture().packages[0], fixture().packages[0]],
    }),
    /duplicate affected playbook package/,
  );
});

test("package impact index rejects malformed input and mismatched event identity", async () => {
  const fetch: FetchLike = async () => Response.json({
    ...fixture(),
    eventId: "event:eea:other:2026-08-14",
  });
  const index = new PackageImpactIndex(client(fetch));

  await assert.rejects(
    () => index.findByPublishedEvent("INVALID EVENT"),
    /invalid regulatory event ID/,
  );
  await assert.rejects(
    () => index.findByPublishedEvent(EVENT_ID),
    /package impact event identity mismatch/,
  );
});

function fixture() {
  return {
    schemaVersion: "1.0.0" as const,
    eventId: EVENT_ID,
    eventState: "PUBLISHED" as const,
    packages: [{
      packageId: "package:stablecoin-pre-listing:aaaaaaaaaaaaaaaa",
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
