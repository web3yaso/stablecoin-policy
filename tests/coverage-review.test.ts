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
  const workflowSql = await readFile(
    path.join(process.cwd(), "supabase/migrations/0013_coverage_review_workflow.sql"),
    "utf8",
  );
  const boundarySql = await readFile(
    path.join(process.cwd(), "supabase/migrations/0014_coverage_scope_write_boundary.sql"),
    "utf8",
  );
  assert.match(workflowSql, /create table policy\.coverage_baseline_checklists/);
  assert.match(workflowSql, /create table policy\.coverage_review_records/);
  assert.match(workflowSql, /checklist_item_unsupported/);
  assert.match(workflowSql, /source_freshness_failed/);
  assert.match(workflowSql, /release_state <> 'PUBLISHED'/);
  assert.match(workflowSql, /coverage review manifest checksum mismatch/);
  assert.match(workflowSql, /coverage review requires an identified human reviewer/);
  assert.match(boundarySql, /revoke insert, update, delete on table policy\.coverage_scopes from service_role/);
  assert.match(boundarySql, /grant select on table policy\.coverage_scopes to service_role/);
  assert.match(workflowSql, /grant execute on function policy\.review_coverage_scope[\s\S]*to service_role/);
  assert.doesNotMatch(workflowSql, /insert into policy\.legal_claims/i);
  assert.doesNotMatch(workflowSql, /decision_rule|playbook_action/i);
});
