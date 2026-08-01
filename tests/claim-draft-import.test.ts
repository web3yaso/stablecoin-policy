import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  assertClaimDraftBundle,
  ClaimDraftImportClient,
  claimDraftBundleErrors,
  claimDraftImportErrors,
  claimDraftReviewReadinessErrors,
} from "../lib/legal-corpus/claim-draft-import";
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
test("claim draft preflight client uses only the read-only RPC", async () => {
  const calls: string[] = [];
  const client = { rpc: async (name: string) => { calls.push(name); return { importReady: true, legalValidityAssessed: false }; } } as unknown as SupabaseHttpClient;
  await new ClaimDraftImportClient(client).preflight(fixture());
  assert.deepEqual(calls, ["preflight_legal_claim_draft_bundle"]);
});
test("claim draft preflight blockers are deterministic", () => {
  assert.deepEqual(claimDraftBundleErrors({ batchManifestConflictCount: 1 }), [
    "batch_manifest_conflict",
  ]);
  assert.deepEqual(claimDraftImportErrors({
    duplicateClaimIdCount: 1,
    existingClaimIdCount: 1,
    missingSupersedesCount: 1,
    duplicateCitationIdCount: 1,
    existingCitationIdCount: 1,
    missingProvisionCount: 1,
    unauthorizedExcerptCount: 1,
  }), [
    "duplicate_claim_id",
    "claim_id_exists",
    "supersedes_claim_missing",
    "duplicate_citation_id",
    "citation_id_exists",
    "provision_missing",
    "unauthorized_excerpt",
  ]);
  assert.deepEqual(claimDraftReviewReadinessErrors({
    missingProvisionCount: 1,
    contradictionCount: 1,
    unverifiedSourceCount: 1,
    unknownPermissionCount: 1,
    unauthorizedExcerptCount: 1,
    directOfficialSupportCount: 0,
  }), [
    "provision_missing",
    "contradictory_evidence",
    "unverified_source",
    "unknown_excerpt_permission",
    "unauthorized_excerpt",
    "direct_official_support_missing",
  ]);
});
test("draft import migration cannot review or publish", async () => {
  const sql = await readFile(path.join(process.cwd(), "supabase/migrations/0015_claim_draft_import_workflow.sql"), "utf8");
  assert.match(sql, /security definer/);
  assert.match(sql, /grant execute[\s\S]*to service_role/);
  assert.doesNotMatch(sql, /submit_legal_claim_for_review|review_legal_claim|publish_corpus_release/);
});
test("draft preflight migration is stable, private and read-only", async () => {
  const sql = await readFile(path.join(process.cwd(), "supabase/migrations/0017_claim_draft_bundle_preflight.sql"), "utf8");
  assert.match(sql, /language plpgsql[\s\S]*stable[\s\S]*security definer/);
  assert.match(sql, /legalValidityAssessed/);
  assert.match(sql, /grant execute[\s\S]*to service_role/);
  assert.doesNotMatch(sql, /\b(insert into|update policy\.|delete from)\b/i);
  assert.doesNotMatch(sql, /review_legal_claim|publish_corpus_release|review_coverage_scope/);
});
