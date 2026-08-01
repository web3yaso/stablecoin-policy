import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { coverageReadinessErrors } from "../lib/legal-corpus/coverage-review";

test("coverage review readiness requires checklist, published claims and fresh sources", () => {
  assert.deepEqual(coverageReadinessErrors({
    coverageInProgress: true,
    checklistJurisdictionMatches: true,
    corpusPublished: true,
    freshnessCutoffValid: true,
    jurisdictionClaimCount: 1,
    unsupportedChecklistItemCount: 0,
    staleSourceCount: 0,
  }), []);
  assert.deepEqual(coverageReadinessErrors({
    coverageInProgress: false,
    checklistJurisdictionMatches: false,
    corpusPublished: false,
    freshnessCutoffValid: false,
    jurisdictionClaimCount: 0,
    unsupportedChecklistItemCount: 1,
    staleSourceCount: 1,
  }), [
    "coverage_not_in_progress",
    "checklist_jurisdiction_mismatch",
    "corpus_not_published",
    "invalid_freshness_cutoff",
    "jurisdiction_claims_missing",
    "checklist_item_unsupported",
    "source_freshness_failed",
  ]);
});

test("coverage migration cannot invent completeness without reviewed evidence", async () => {
  const sql = await readFile(
    path.join(process.cwd(), "supabase/migrations/0013_coverage_review_workflow.sql"),
    "utf8",
  );
  assert.match(sql, /create table policy\.coverage_baseline_checklists/);
  assert.match(sql, /create table policy\.coverage_review_records/);
  assert.match(sql, /checklist_item_unsupported/);
  assert.match(sql, /source_freshness_failed/);
  assert.match(sql, /release_state <> 'PUBLISHED'/);
  assert.match(sql, /coverage review manifest checksum mismatch/);
  assert.match(sql, /coverage review requires an identified human reviewer/);
  assert.match(sql, /revoke update, delete on table policy\.coverage_scopes from service_role/);
  assert.match(sql, /grant execute on function policy\.review_coverage_scope[\s\S]*to service_role/);
  assert.doesNotMatch(sql, /insert into policy\.legal_claims/i);
  assert.doesNotMatch(sql, /decision_rule|playbook_action/i);
});
