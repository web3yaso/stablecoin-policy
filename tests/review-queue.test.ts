import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseHttpClient } from "../lib/data/supabase-client";
import { ReviewQueueClient, reviewQueueNextAction } from "../lib/legal-corpus/review-queue";

test("review queue next actions are deterministic and fail closed on blockers", () => {
  assert.equal(reviewQueueNextAction({ taskType: "SOURCE_VERIFICATION", subjectState: "OBSERVED", hasReadinessErrors: true }), "RESOLVE_SOURCE_EVIDENCE");
  assert.equal(reviewQueueNextAction({ taskType: "SOURCE_VERIFICATION", subjectState: "OBSERVED", hasReadinessErrors: false }), "REVIEW_SOURCE");
  assert.equal(reviewQueueNextAction({ taskType: "CLAIM_REVIEW", subjectState: "DRAFT", hasReadinessErrors: false }), "SUBMIT_CLAIM_FOR_REVIEW");
  assert.equal(reviewQueueNextAction({ taskType: "CLAIM_REVIEW", subjectState: "IN_REVIEW", hasReadinessErrors: false }), "REVIEW_CLAIM");
  assert.equal(reviewQueueNextAction({ taskType: "CORPUS_RELEASE_REVIEW", subjectState: "REVIEWED", hasReadinessErrors: false }), "PUBLISH_RELEASE");
  assert.equal(reviewQueueNextAction({ taskType: "COVERAGE_REVIEW_PREPARATION", subjectState: "IN_PROGRESS", hasReadinessErrors: false, hasCoverageChecklist: false }), "DEFINE_COVERAGE_CHECKLIST");
});

test("review queue client calls only the read-only RPC", async () => {
  const calls: Array<{ name: string; body: Record<string, unknown> }> = [];
  const client = { rpc: async (name: string, body: Record<string, unknown>) => {
    calls.push({ name, body });
    return { jurisdictionCode: "EEA", tasks: [] };
  } } as unknown as SupabaseHttpClient;
  await new ReviewQueueClient(client).get("EEA", 25);
  assert.deepEqual(calls, [{ name: "get_legal_corpus_review_queue", body: {
    p_jurisdiction_code: "EEA", p_limit: 25,
  } }]);
  await assert.rejects(new ReviewQueueClient(client).get("bad"), /jurisdiction is invalid/);
  await assert.rejects(new ReviewQueueClient(client).get("EEA", 0), /limit must be between/);
});

test("review queue migration is private, stable and mutation-free", async () => {
  const sql = await readFile(path.join(process.cwd(), "supabase/migrations/0018_human_review_queue.sql"), "utf8");
  assert.match(sql, /language plpgsql[\s\S]*stable[\s\S]*security definer/);
  assert.match(sql, /automaticApprovalAllowed[\s\S]*false/);
  assert.match(sql, /grant execute[\s\S]*to service_role/);
  assert.doesNotMatch(sql, /\b(insert into|update policy\.|delete from)\b/i);
  assert.doesNotMatch(sql, /review_(claim|source|corpus|coverage)|publish_corpus_release/);
});
