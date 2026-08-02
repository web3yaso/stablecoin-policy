import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseHttpClient } from "../lib/data/supabase-client";
import {
  RegulatoryChangeClient,
  changeCandidateReadinessErrors,
  changePublicationReadinessErrors,
  type RegulatoryChangeCandidateEnvelope,
  type RegulatoryEventReviewEnvelope,
} from "../lib/legal-corpus/regulatory-change";

const hash = "a".repeat(64);

test("change candidate readiness fails closed in deterministic order", () => {
  assert.deepEqual(changeCandidateReadinessErrors({
    sameDocument: false,
    beforeVersionVerified: false,
    afterVersionVerified: false,
    provisionChangeCount: 0,
    claimCandidateCount: 0,
  }), [
    "source_document_mismatch",
    "before_version_unverified",
    "after_version_unverified",
    "provision_diff_empty",
    "claim_candidates_missing",
  ]);
});

test("change publication readiness requires both layers of current human approval", () => {
  assert.deepEqual(changePublicationReadinessErrors({
    eventState: "CANDIDATE",
    manifestFresh: false,
    eventHumanApprovalCurrent: false,
    pendingImpactCount: 1,
    reviewedImpactCount: 1,
    reviewedImpactsWithCurrentApproval: 0,
  }), [
    "event_not_reviewed",
    "change_manifest_stale",
    "event_human_approval_missing_or_stale",
    "pending_impact_review",
    "impact_human_approval_missing_or_stale",
  ]);
});

test("change client rechecks the candidate manifest immediately before creation", async () => {
  const calls: Array<{ name: string; body: Record<string, unknown> }> = [];
  const client = { rpc: async (name: string, body: Record<string, unknown>) => {
    calls.push({ name, body });
    return name === "get_regulatory_change_candidate_manifest" ? candidateEnvelope() : { eventState: "CANDIDATE" };
  } } as unknown as SupabaseHttpClient;
  await new RegulatoryChangeClient(client).createCandidate({
    eventId: "event:test:1",
    beforeVersionId: "version:test:before",
    afterVersionId: "version:test:after",
    eventType: "AMENDMENT",
    title: "Sanitized amendment",
    observedAt: "2026-08-01T00:00:00.000Z",
    manifestSha256: hash,
  });
  assert.deepEqual(calls.map((call) => call.name), [
    "get_regulatory_change_candidate_manifest",
    "create_regulatory_event_candidate",
  ]);
});

test("change client rejects automated review before the mutation RPC", async () => {
  const calls: string[] = [];
  const client = { rpc: async (name: string) => {
    calls.push(name);
    return eventEnvelope();
  } } as unknown as SupabaseHttpClient;
  await assert.rejects(new RegulatoryChangeClient(client).reviewEvent({
    eventReviewId: "event-review:test:1",
    eventId: "event:test:1",
    outcome: "APPROVED",
    reviewerRole: "Automated reviewer",
    reviewerRef: "llm",
    manifestSha256: hash,
    reviewedAt: "2026-08-01T00:00:00.000Z",
    humanReviewConfirmed: true,
  }), /identified human reviewer/);
  assert.deepEqual(calls, ["get_regulatory_event_review_manifest"]);
});

test("change migration closes direct writes and cannot mutate domain decisions", async () => {
  const sql = await readFile(
    path.join(process.cwd(), "supabase/migrations/0019_regulatory_change_pipeline.sql"),
    "utf8",
  );
  assert.match(sql, /revoke insert, update, delete on regulatory\.regulatory_events from service_role/);
  assert.match(sql, /automaticPublicationAllowed[\s\S]*false/);
  assert.match(sql, /regulatory_event_review_records rows are immutable|protect_regulatory_event_review_record_trigger/);
  assert.doesNotMatch(sql, /\b(update|insert into|delete from) policy\.(legal_claims|citations|corpus_releases|coverage_scopes)\b/i);
  const backup = await readFile(
    path.join(process.cwd(), "scripts/migrate/export-phase1-metadata.ts"),
    "utf8",
  );
  assert.match(backup, /formatVersion: "1\.5\.0"/);
  assert.match(backup, /get_regulatory_change_backup_metadata/);
  assert.match(backup, /machine_assurance_records/);
  assert.match(backup, /machine_assurance_states/);
});

function candidateEnvelope(): RegulatoryChangeCandidateEnvelope {
  return {
    manifest: {
      schemaVersion: "1.0.0",
      documentId: "document:test:1",
      authorityId: "authority:test:1",
      beforeVersionId: "version:test:before",
      beforeVersionChecksumSha256: "b".repeat(64),
      afterVersionId: "version:test:after",
      afterVersionChecksumSha256: "c".repeat(64),
      provisionChanges: [{
        changeType: "MODIFIED",
        locator: "Article 1",
        languageCode: "en",
        beforeProvisionId: "provision:test:before",
        beforeTextChecksumSha256: "d".repeat(64),
        afterProvisionId: "provision:test:after",
        afterTextChecksumSha256: "e".repeat(64),
      }],
      claimCandidates: [{ claimId: "claim:test:1", jurisdictionCode: "EEA", topic: "test" }],
    },
    manifestSha256: hash,
    readinessErrors: [],
    legalImpactAssessed: false,
    humanReviewRequired: true,
  };
}

function eventEnvelope(): RegulatoryEventReviewEnvelope {
  return {
    eventId: "event:test:1",
    eventType: "AMENDMENT",
    title: "Sanitized amendment",
    observedAt: "2026-08-01T00:00:00.000Z",
    effectiveAt: null,
    eventState: "CANDIDATE",
    candidateManifestSha256: hash,
    currentManifestSha256: hash,
    readinessErrors: [],
    impacts: [{
      claimId: "claim:test:1",
      impactType: "MAY_AFFECT",
      reviewState: "PENDING",
      jurisdictionCode: "EEA",
      topic: "test",
    }],
    humanReviewRequired: true,
    automaticPublicationAllowed: false,
  };
}
