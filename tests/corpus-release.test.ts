import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { SupabaseHttpClient, type FetchLike } from "../lib/data/supabase-client";
import {
  CorpusReleaseClient,
  corpusReleaseReadinessErrors,
  type CorpusReleaseManifestEnvelope,
} from "../lib/legal-corpus/corpus-release";

const MANIFEST_SHA256 = "a".repeat(64);

function envelope(
  overrides: Partial<CorpusReleaseManifestEnvelope> = {},
): CorpusReleaseManifestEnvelope {
  return {
    manifestSha256: MANIFEST_SHA256,
    releaseState: "IN_REVIEW",
    submittedAt: "2026-08-01T00:00:00.000Z",
    publishedAt: null,
    readinessErrors: [],
    manifest: {
      schemaVersion: "1.0.0",
      releaseId: "corpus:fixture:1",
      asOf: "2026-07-31T00:00:00.000Z",
      knowledgeCutoff: "2026-08-01T00:00:00.000Z",
      claims: [],
    },
    ...overrides,
  };
}

test("corpus release readiness fails closed on membership, review and time gaps", () => {
  assert.deepEqual(corpusReleaseReadinessErrors({
    claimCount: 1,
    unreviewedClaimCount: 0,
    staleClaimApprovalCount: 0,
    outsideAsOfCount: 0,
    afterKnowledgeCutoffCount: 0,
  }), []);
  assert.deepEqual(corpusReleaseReadinessErrors({
    claimCount: 0,
    unreviewedClaimCount: 1,
    staleClaimApprovalCount: 1,
    outsideAsOfCount: 1,
    afterKnowledgeCutoffCount: 1,
  }), [
    "claims_missing",
    "unreviewed_claim",
    "claim_approval_missing_or_stale",
    "claim_outside_as_of",
    "claim_after_knowledge_cutoff",
  ]);
});

test("corpus release client rechecks manifest before review", async () => {
  const calls: string[] = [];
  const fetchImpl: FetchLike = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/rpc/get_corpus_release_review_manifest")) {
      return Response.json(envelope());
    }
    return Response.json({ releaseId: "corpus:fixture:1", releaseState: "REVIEWED" });
  };
  const client = new CorpusReleaseClient(new SupabaseHttpClient({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role",
    reportsBucket: "policy-reports",
    datasetsBucket: "policy-datasets",
    sourcesBucket: "policy-sources",
    requestTimeoutMs: 1000,
  }, fetchImpl));
  const result = await client.review({
    releaseReviewId: "release-review:fixture:1",
    releaseId: "corpus:fixture:1",
    outcome: "APPROVED",
    reviewerRole: "Corpus release reviewer",
    reviewerRef: "reviewer:fixture:1",
    manifestSha256: MANIFEST_SHA256,
    reviewedAt: "2026-08-01T01:00:00.000Z",
    humanReviewConfirmed: true,
  });
  assert.equal(result.releaseState, "REVIEWED");
  assert.equal(calls.length, 2);
  assert.match(calls[0], /get_corpus_release_review_manifest/);
  assert.match(calls[1], /review_corpus_release/);
});

test("corpus release client blocks stale or non-human approval", async () => {
  const fetchImpl: FetchLike = async () => Response.json(envelope());
  const client = new CorpusReleaseClient(new SupabaseHttpClient({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role",
    reportsBucket: "policy-reports",
    datasetsBucket: "policy-datasets",
    sourcesBucket: "policy-sources",
    requestTimeoutMs: 1000,
  }, fetchImpl));
  await assert.rejects(client.review({
    releaseReviewId: "release-review:fixture:1",
    releaseId: "corpus:fixture:1",
    outcome: "APPROVED",
    reviewerRole: "Corpus release reviewer",
    reviewerRef: "system",
    manifestSha256: MANIFEST_SHA256,
    reviewedAt: "2026-08-01T01:00:00.000Z",
    humanReviewConfirmed: true,
  }), /human reviewer/);
  await assert.rejects(client.review({
    releaseReviewId: "release-review:fixture:1",
    releaseId: "corpus:fixture:1",
    outcome: "APPROVED",
    reviewerRole: "Corpus release reviewer",
    reviewerRef: "reviewer:fixture:1",
    manifestSha256: "b".repeat(64),
    reviewedAt: "2026-08-01T01:00:00.000Z",
    humanReviewConfirmed: true,
  }), /checksum mismatch/);
});

test("corpus release migration requires exact named-human approval", async () => {
  const sql = await readFile(
    path.join(process.cwd(), "supabase/migrations/0012_corpus_release_workflow.sql"),
    "utf8",
  );
  assert.match(sql, /create table policy\.corpus_release_review_records/);
  assert.match(sql, /build_corpus_release_manifest/);
  assert.match(sql, /claimManifestSha256/);
  assert.match(sql, /claim_outside_as_of/);
  assert.match(sql, /claim_after_knowledge_cutoff/);
  assert.match(sql, /only IN_REVIEW corpus releases may be reviewed/);
  assert.match(sql, /corpus release approval is missing, stale, or invalid/);
  assert.match(sql, /revoke insert, update, delete on table policy\.corpus_releases from service_role/);
  assert.match(sql, /grant execute on function policy\.publish_corpus_release[\s\S]*to service_role/);
  assert.doesNotMatch(sql, /insert into policy\.legal_claims/i);
  assert.doesNotMatch(sql, /decision_rule|playbook_action/i);
});
