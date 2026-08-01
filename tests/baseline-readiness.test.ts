import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseHttpClient } from "../lib/data/supabase-client";
import {
  BaselineReadinessClient,
  baselineReadinessBlockers,
  baselineWorkflowStage,
  type BaselineReadinessInput,
} from "../lib/legal-corpus/baseline-readiness";

const completeInput: BaselineReadinessInput = {
  sourceVersionCount: 1,
  verifiedSourceVersionCount: 1,
  claimCount: 1,
  pendingClaimCount: 0,
  reviewedClaimCount: 1,
  publishedReleaseCount: 1,
  checklistCount: 1,
  coverageReviewed: true,
  coverageFresh: true,
};

test("baseline workflow stage advances without claiming legal completeness", () => {
  assert.equal(baselineWorkflowStage({ ...completeInput, sourceVersionCount: 0, coverageReviewed: false }), "SOURCE_INGESTION");
  assert.equal(baselineWorkflowStage({ ...completeInput, verifiedSourceVersionCount: 0, coverageReviewed: false }), "SOURCE_REVIEW");
  assert.equal(baselineWorkflowStage({ ...completeInput, claimCount: 0, coverageReviewed: false }), "CLAIM_DRAFTING");
  assert.equal(baselineWorkflowStage({ ...completeInput, reviewedClaimCount: 0, coverageReviewed: false }), "CLAIM_REVIEW");
  assert.equal(baselineWorkflowStage({ ...completeInput, publishedReleaseCount: 0, coverageReviewed: false }), "CORPUS_RELEASE");
  assert.equal(baselineWorkflowStage({ ...completeInput, checklistCount: 0, coverageReviewed: false }), "COVERAGE_REVIEW");
  assert.equal(baselineWorkflowStage(completeInput), "COMPLETE");
});

test("baseline blocker order is deterministic and fails closed", () => {
  assert.deepEqual(baselineReadinessBlockers({
    ...completeInput,
    sourceVersionCount: 0,
    verifiedSourceVersionCount: 0,
    claimCount: 0,
    reviewedClaimCount: 0,
    publishedReleaseCount: 0,
    checklistCount: 0,
    coverageReviewed: false,
  }), [
    "source_versions_missing",
    "verified_sources_missing",
    "claims_missing",
    "reviewed_claims_missing",
    "published_release_missing",
    "coverage_checklist_missing",
    "coverage_review_missing",
  ]);
  assert.deepEqual(baselineReadinessBlockers(completeInput), []);
});

test("baseline readiness client calls only the read-only RPC", async () => {
  const calls: Array<{ name: string; body: Record<string, unknown> }> = [];
  const client = {
    rpc: async (name: string, body: Record<string, unknown>) => {
      calls.push({ name, body });
      return { jurisdictionCode: "EEA", workflowStage: "SOURCE_INGESTION" };
    },
  } as unknown as SupabaseHttpClient;
  await new BaselineReadinessClient(client).get("EEA");
  assert.deepEqual(calls, [{
    name: "get_jurisdiction_baseline_readiness",
    body: { p_jurisdiction_code: "EEA" },
  }]);
  await assert.rejects(
    new BaselineReadinessClient(client).get("bad"),
    /jurisdiction is invalid/,
  );
});

test("baseline readiness migration is private and contains no state mutation", async () => {
  const sql = await readFile(
    path.join(process.cwd(), "supabase/migrations/0016_jurisdiction_baseline_readiness.sql"),
    "utf8",
  );
  assert.match(sql, /language plpgsql[\s\S]*stable[\s\S]*security definer/);
  assert.match(sql, /legalCompletenessAssessed/);
  assert.match(sql, /grant execute[\s\S]*to service_role/);
  assert.doesNotMatch(sql, /\b(insert into|update policy\.|delete from)\b/i);
  assert.doesNotMatch(sql, /review_coverage_scope|publish_corpus_release/);
});
