import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { assertClaimDraftBundle, ClaimDraftImportClient } from "../lib/legal-corpus/claim-draft-import";
import type { SupabaseHttpClient } from "../lib/data/supabase-client";

function fixture(): Record<string, unknown> {
  return { schemaVersion: "1.0.0", batchId: "draft-batch:test:1", jurisdictionCode: "EEA", claims: [{ claimId: "claim:test:1", topic: "test", proposition: "Sanitized draft.", legalStatus: "UNDETERMINED", effectiveFrom: "2026-01-01T00:00:00Z", effectiveTo: null, knowledgeCutoff: "2026-01-02T00:00:00Z", actorTypes: ["TEST"], activityCodes: ["TEST"], supersedesClaimId: null, citations: [{ citationId: "citation:test:1", provisionId: "provision:test:1", supportRelation: "DIRECT_SUPPORT", exactLocator: "Article 1", allowedExcerpt: null }] }] };
}

test("valid claim draft bundle is accepted", () => assert.doesNotThrow(() => assertClaimDraftBundle(fixture())));
test("claim draft cannot request review state", () => {
  const input = fixture();
  ((input.claims as Array<Record<string, unknown>>)[0]).reviewState = "REVIEWED";
  assert.throws(() => assertClaimDraftBundle(input), /cannot set review/);
});
test("claim draft client uses only the atomic RPC", async () => {
  const calls: string[] = [];
  const client = { rpc: async (name: string) => { calls.push(name); return { reviewState: "DRAFT" }; } } as unknown as SupabaseHttpClient;
  await new ClaimDraftImportClient(client).import(fixture());
  assert.deepEqual(calls, ["import_legal_claim_draft_bundle"]);
});
test("draft import migration cannot review or publish", async () => {
  const sql = await readFile(path.join(process.cwd(), "supabase/migrations/0015_claim_draft_import_workflow.sql"), "utf8");
  assert.match(sql, /security definer/);
  assert.match(sql, /grant execute[\s\S]*to service_role/);
  assert.doesNotMatch(sql, /submit_legal_claim_for_review|review_legal_claim|publish_corpus_release/);
});
