import assert from "node:assert/strict";
import test from "node:test";
import { SupabaseHttpClient } from "../lib/data/supabase-client";
import { RetrievalIndexAdminClient, type RetrievalSuspensionRequest } from "../lib/retrieval/index-admin";
import { runSuspensionCommand } from "../lib/retrieval/suspend-command";
import { SupabaseEvidenceRetrievalRepository } from "../lib/retrieval/supabase-repository";
import { EvidenceSearchService } from "../lib/retrieval/search";
import { RAG_EVAL_INDEX } from "../scripts/evals/phase3-rag-fixture";

const input: RetrievalSuspensionRequest = {
  operationId: "suspend:test:one", policyDomain: "stablecoin", assuranceTier: "PROVISIONAL",
  indexReleaseId: "index:test:one", expectedManifestSha256: "a".repeat(64),
  expectedRevision: "9007199254740993", reason: "sanitized drill",
};
function harness(response: unknown = null) {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const client = new SupabaseHttpClient({
    url: "https://example.supabase.co", serviceRoleKey: "test-only", reportsBucket: "policy-reports",
    datasetsBucket: "policy-datasets", sourcesBucket: "policy-sources", requestTimeoutMs: 1000,
  }, async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return Response.json(response);
  });
  return { calls, client, admin: new RetrievalIndexAdminClient(client) };
}
const baseArgs = ["--domain", "stablecoin", "--assurance-tier", "PROVISIONAL"];
const executeArgs = [...baseArgs, "--execute", "--operation-id", input.operationId,
  "--index-release", input.indexReleaseId, "--expected-manifest-sha256", input.expectedManifestSha256,
  "--expected-revision", input.expectedRevision, "--reason", input.reason];

test("suspension dry-run inspects only, including an empty scope", async () => {
  const h = harness();
  assert.deepEqual(await runSuspensionCommand(baseArgs, h.admin), { mode: "DRY_RUN", pointer: null });
  assert.equal(h.calls.length, 1);
  assert.ok(h.calls[0].url.endsWith("/inspect_retrieval_index_pointer"));
});
test("execution sends exact operator pins and preserves bigint precision", async () => {
  const h = harness({ releaseState: "SUSPENDED" });
  await runSuspensionCommand(executeArgs, h.admin);
  assert.deepEqual(h.calls, [{ url: "https://example.supabase.co/rest/v1/rpc/suspend_retrieval_index_release",
    body: { p_operation_id: input.operationId, p_policy_domain: input.policyDomain,
      p_assurance_tier: input.assuranceTier, p_index_release_id: input.indexReleaseId,
      p_expected_manifest_sha256: input.expectedManifestSha256,
      p_expected_revision: input.expectedRevision, p_reason: input.reason } }]);
});
test("exact command replay reaches ledger without fresh inspection or replacement pins", async () => {
  const result = { operationId: input.operationId, releaseState: "SUSPENDED", revision: "2" };
  const h = harness(result);
  assert.deepEqual(await runSuspensionCommand(executeArgs, h.admin), await runSuspensionCommand(executeArgs, h.admin));
  assert.deepEqual(h.calls[0], h.calls[1]);
  assert.equal(h.calls.length, 2);
});
for (const [field, value] of [
  ["operationId", ""], ["operationId", null], ["indexReleaseId", "bad/id"],
  ["indexReleaseId", undefined], ["policyDomain", "../domain"], ["policyDomain", null],
  ["assuranceTier", "ANY"], ["expectedManifestSha256", "A".repeat(64)],
  ["expectedRevision", "0"], ["expectedRevision", "-1"], ["expectedRevision", "1.5"],
  ["expectedRevision", "01"], ["expectedRevision", "9223372036854775808"],
  ["expectedRevision", 1], ["reason", " "], ["reason", "x".repeat(501)],
] as const) {
  test(`suspension rejects invalid ${field}: ${String(value).slice(0, 25)}`, async () => {
    const h = harness();
    await assert.rejects(h.admin.suspend({ ...input, [field]: value } as RetrievalSuspensionRequest));
    assert.equal(h.calls.length, 0);
  });
}
for (const args of [
  [...baseArgs, "--execute"], [...baseArgs, "--unknown"], [...baseArgs, "--execute", "--execute"],
  [...baseArgs, "--domain", "stablecoin"], ["--domain"],
  ["--domain", "stablecoin", "--assurance-tier", "ANY"],
]) {
  test(`suspension CLI rejects incomplete/ambiguous args ${args.join(" ")}`, async () => {
    const h = harness();
    await assert.rejects(runSuspensionCommand(args, h.admin));
    assert.equal(h.calls.length, 0);
  });
}
test("suspended pinned index degrades without asking for query embeddings", async () => {
  const h = harness(null);
  const provider = { model: RAG_EVAL_INDEX.embeddingModel, version: RAG_EVAL_INDEX.embeddingModelVersion,
    dimensions: RAG_EVAL_INDEX.embeddingDimensions,
    embed: async () => { throw new Error("embedding must not run without an eligible index"); } };
  const service = new EvidenceSearchService(new SupabaseEvidenceRetrievalRepository(h.client), provider);
  const result = await service.search({ query: "sanitized query", topK: 10,
    filters: { jurisdictionCodes: ["EEA"], topics: [], sourceTypes: [], assuranceTier: "PROVISIONAL",
      corpusReleaseId: null, indexReleaseId: "index:test:suspended", asOf: "2026-09-04T00:00:00Z" } });
  assert.equal(result.status, "RETRIEVAL_UNAVAILABLE");
  assert.equal(result.explanation, null);
  assert.equal(h.calls.some(c => c.url.endsWith("/list_retrieval_index_chunks")), false);
});
