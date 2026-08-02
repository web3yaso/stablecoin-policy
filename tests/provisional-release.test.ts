import assert from "node:assert/strict";
import test from "node:test";
import {
  ProvisionalReleaseClient,
  provisionalReleaseInputErrors,
  type ProvisionalReleaseInput,
} from "../lib/legal-corpus/provisional-release";
import { SupabaseHttpClient, type FetchLike } from "../lib/data/supabase-client";

function releaseInput(
  overrides: Partial<ProvisionalReleaseInput> = {},
): ProvisionalReleaseInput {
  return {
    releaseId: "provisional:eea:2026-08-02",
    jurisdictionCode: "EEA",
    asOf: "2026-08-01T00:00:00.000Z",
    knowledgeCutoff: "2026-07-30T00:00:00.000Z",
    claimIds: ["claim:eea:fixture:1", "claim:eea:fixture:2"],
    ...overrides,
  };
}

function fixtureClient(fetchStub: FetchLike): ProvisionalReleaseClient {
  return new ProvisionalReleaseClient(
    new SupabaseHttpClient(
      {
        url: "https://fixture.supabase.co",
        serviceRoleKey: "fixture-key",
        reportsBucket: "policy-reports",
        datasetsBucket: "policy-datasets",
        sourcesBucket: "policy-sources",
        requestTimeoutMs: 5000,
      },
      fetchStub,
    ),
  );
}

test("release input validation fails closed on empty or malformed membership", () => {
  assert.deepEqual(provisionalReleaseInputErrors(releaseInput()), []);
  assert.ok(
    provisionalReleaseInputErrors(releaseInput({ claimIds: [] })).includes(
      "membership_empty",
    ),
  );
  assert.ok(
    provisionalReleaseInputErrors(
      releaseInput({ claimIds: ["BAD ID"] }),
    ).includes("identifier_invalid"),
  );
  assert.ok(
    provisionalReleaseInputErrors(
      releaseInput({ claimIds: ["claim:a", "claim:a"] }),
    ).includes("membership_duplicate"),
  );
  assert.ok(
    provisionalReleaseInputErrors(releaseInput({ asOf: "yesterday" })).includes(
      "timestamp_invalid",
    ),
  );
  assert.ok(
    provisionalReleaseInputErrors(
      releaseInput({ jurisdictionCode: "eea" }),
    ).includes("jurisdiction_invalid"),
  );
});

test("the client publishes through the service RPC with sorted membership", async () => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetchStub: FetchLike = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response(
      JSON.stringify({ releaseId: "provisional:eea:2026-08-02", manifestSha256: "f".repeat(64) }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  const result = await fixtureClient(fetchStub).publish(
    releaseInput({ claimIds: ["claim:eea:fixture:2", "claim:eea:fixture:1"] }),
  );

  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.includes("publish_provisional_release"));
  assert.deepEqual(calls[0].body.p_claim_ids, [
    "claim:eea:fixture:1",
    "claim:eea:fixture:2",
  ]);
  assert.equal(result.manifestSha256, "f".repeat(64));
});

test("the client rejects invalid input locally without touching the network", async () => {
  const fetchStub: FetchLike = async () => {
    throw new Error("network must not be reached for invalid input");
  };
  await assert.rejects(
    () => fixtureClient(fetchStub).publish(releaseInput({ claimIds: [] })),
    /membership_empty/,
  );
});
