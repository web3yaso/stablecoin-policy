import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { SupabaseHttpClient, type FetchLike } from "../lib/data/supabase-client";
import {
  assertClaimReviewSubmission,
  ClaimReviewClient,
  claimEvidenceReadinessErrors,
  type ClaimReviewManifestEnvelope,
} from "../lib/legal-corpus/claim-review";

const MANIFEST_SHA256 = "a".repeat(64);

function envelope(
  overrides: Partial<ClaimReviewManifestEnvelope> = {},
): ClaimReviewManifestEnvelope {
  return {
    manifestSha256: MANIFEST_SHA256,
    reviewState: "IN_REVIEW",
    readinessErrors: [],
    manifest: {
      schemaVersion: "1.0.0",
      claimId: "claim:fixture:1",
      policyDomain: "stablecoin",
      jurisdictionCode: "EEA",
      topic: "market-access",
      proposition: "A fixture legal proposition.",
      legalStatus: "REQUIREMENT",
      effectiveFrom: "2025-01-01T00:00:00+00:00",
      effectiveTo: null,
      knowledgeCutoff: "2026-07-31T00:00:00+00:00",
      actorTypes: ["ISSUER"],
      activityCodes: ["ISSUE"],
      supersedesClaimId: null,
      citations: [{
        citationId: "citation:fixture:1",
        supportRelation: "DIRECT_SUPPORT",
        exactLocator: "Article 1",
        allowedExcerpt: "Fixture excerpt",
        provisionId: "provision:fixture:1",
        provisionLocator: "Article 1",
        languageCode: "en",
        textChecksumSha256: "b".repeat(64),
        effectiveExcerptPermission: "ALLOWED",
        sourceVersionId: "version:fixture:1",
        sourceVersionChecksumSha256: "c".repeat(64),
        documentId: "document:fixture:1",
        documentTitle: "Fixture regulation",
        canonicalUrl: "https://example.gov/legal",
        authorityId: "authority:fixture",
        authorityName: "Fixture authority",
        evidenceLayer: "OFFICIAL_SOURCE",
      }],
    },
    ...overrides,
  };
}

test("claim evidence approval readiness fails closed on every material evidence gap", () => {
  assert.deepEqual(claimEvidenceReadinessErrors({
    citationCount: 1,
    contradictionCount: 0,
    unverifiedSourceCount: 0,
    unknownPermissionCount: 0,
    unauthorizedExcerptCount: 0,
    directOfficialSupportCount: 1,
  }), []);
  assert.deepEqual(claimEvidenceReadinessErrors({
    citationCount: 0,
    contradictionCount: 1,
    unverifiedSourceCount: 1,
    unknownPermissionCount: 1,
    unauthorizedExcerptCount: 1,
    directOfficialSupportCount: 0,
  }), [
    "citations_missing",
    "contradictory_evidence",
    "unverified_source",
    "unknown_excerpt_permission",
    "unauthorized_excerpt",
    "direct_official_support_missing",
  ]);
});

test("claim approval requires exact manifest, IN_REVIEW state and a human reviewer", () => {
  const valid = {
    reviewId: "review:fixture:1",
    claimId: "claim:fixture:1",
    outcome: "APPROVED" as const,
    reviewerRole: "Qualified legal reviewer",
    reviewerRef: "reviewer:fixture:1",
    manifestSha256: MANIFEST_SHA256,
    reviewedAt: "2026-08-01T00:00:00.000Z",
    humanReviewConfirmed: true,
  };
  assert.doesNotThrow(() => assertClaimReviewSubmission(valid, envelope()));
  assert.throws(
    () => assertClaimReviewSubmission(valid, envelope({ reviewState: "DRAFT" })),
    /IN_REVIEW/,
  );
  assert.throws(
    () => assertClaimReviewSubmission({ ...valid, reviewerRef: "ai" }, envelope()),
    /human reviewer/,
  );
  assert.throws(
    () => assertClaimReviewSubmission(valid, envelope({ readinessErrors: ["unverified_source"] })),
    /not ready for approval/,
  );
});

test("claim review client refreshes the manifest before atomic review", async () => {
  const calls: string[] = [];
  const fetchImpl: FetchLike = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith("/rpc/get_legal_claim_review_manifest")) {
      return Response.json(envelope());
    }
    return Response.json({ claimId: "claim:fixture:1", reviewState: "REVIEWED" });
  };
  const client = new ClaimReviewClient(new SupabaseHttpClient({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role",
    reportsBucket: "policy-reports",
    datasetsBucket: "policy-datasets",
    sourcesBucket: "policy-sources",
    requestTimeoutMs: 1000,
  }, fetchImpl));
  const result = await client.review({
    reviewId: "review:fixture:1",
    claimId: "claim:fixture:1",
    outcome: "APPROVED",
    reviewerRole: "Qualified legal reviewer",
    reviewerRef: "reviewer:fixture:1",
    manifestSha256: MANIFEST_SHA256,
    reviewedAt: "2026-08-01T00:00:00.000Z",
    humanReviewConfirmed: true,
  });
  assert.equal(result.reviewState, "REVIEWED");
  assert.equal(calls.length, 2);
  assert.match(calls[0], /get_legal_claim_review_manifest/);
  assert.match(calls[1], /review_legal_claim/);
});

test("claim review migration binds approval and publication to verified evidence", async () => {
  const sql = await readFile(
    path.join(process.cwd(), "supabase/migrations/0011_claim_review_workflow.sql"),
    "utf8",
  );
  assert.match(sql, /build_legal_claim_review_manifest/);
  assert.match(sql, /claim review manifest checksum mismatch/);
  assert.match(sql, /source_verification_records/);
  assert.match(sql, /v_direct_official_count = 0/);
  assert.match(sql, /citations for claim % are immutable outside DRAFT/);
  assert.match(sql, /citation excerpt is not permitted/);
  assert.match(sql, /security definer/);
  assert.match(sql, /revoke insert, update, delete on table policy\.review_records from service_role/);
  assert.match(sql, /grant execute on function policy\.review_legal_claim[\s\S]*to service_role/);
  assert.doesNotMatch(sql, /decision_rule|playbook_action/i);
});
