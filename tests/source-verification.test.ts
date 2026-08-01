import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { SupabaseHttpClient, type FetchLike } from "../lib/data/supabase-client";
import {
  assertSourceVerificationSubmission,
  SourceVerificationClient,
  sourceVerificationReadinessErrors,
  type SourceVerificationManifestEnvelope,
} from "../lib/legal-corpus/verification";

const MANIFEST_SHA256 = "a".repeat(64);

function envelope(
  overrides: Partial<SourceVerificationManifestEnvelope> = {},
): SourceVerificationManifestEnvelope {
  return {
    manifestSha256: MANIFEST_SHA256,
    lifecycleState: "OBSERVED",
    verifiedAt: null,
    manifest: {
      schemaVersion: "1.0.0",
      versionId: "document:eu:fixture:en:abc123",
      documentId: "document:eu:fixture",
      versionLabel: "fixture-1",
      rawObjectId: "object:fixture",
      checksumSha256: "b".repeat(64),
      officialUrl: "https://example.eu/legal",
      publishedAt: "2025-01-01T00:00:00+00:00",
      effectiveFrom: "2025-01-01T00:00:00+00:00",
      effectiveTo: null,
      observedAt: "2026-07-30T00:00:00+00:00",
      retrievedAt: "2026-07-30T00:00:00+00:00",
      storageRights: "ALLOWED",
      rightsReviewedAt: "2026-07-30T00:00:00+00:00",
      rightsBasis: "Fixture reviewed rights basis",
      redistributionRights: "FULL_TEXT",
      licenceIdentifier: "Fixture licence",
      provisions: [
        {
          provisionId: "provision:fixture:1",
          locator: "Article 1",
          languageCode: "en",
          textChecksumSha256: "c".repeat(64),
          ordinal: 0,
          effectiveExcerptPermission: "ALLOWED",
        },
      ],
    },
    ...overrides,
  };
}

test("verification readiness fails closed on mutable state, rights and provision gaps", () => {
  assert.deepEqual(sourceVerificationReadinessErrors(envelope()), []);
  assert.deepEqual(
    sourceVerificationReadinessErrors({
      ...envelope(),
      lifecycleState: "VERIFIED",
      verifiedAt: "2026-07-31T00:00:00+00:00",
      manifest: {
        ...envelope().manifest,
        storageRights: "REVIEW_REQUIRED",
        rightsReviewedAt: null,
        rightsBasis: null,
        provisions: [
          {
            ...envelope().manifest.provisions[0],
            effectiveExcerptPermission: "UNKNOWN",
          },
        ],
      },
    }),
    [
      "source_not_observed",
      "source_already_verified",
      "storage_rights_not_allowed",
      "storage_rights_review_missing",
      "excerpt_permission_unknown",
    ],
  );
});

test("verification submission requires an exact manifest and identified human", () => {
  const valid = {
    verificationId: "verification:fixture:1",
    versionId: envelope().manifest.versionId,
    outcome: "APPROVED" as const,
    verificationMethod: "OFFICIAL_BYTE_AND_LOCATOR_REVIEW" as const,
    reviewerRole: "Qualified legal reviewer",
    reviewerRef: "reviewer:fixture:1",
    manifestSha256: MANIFEST_SHA256,
    reviewedAt: "2026-07-31T00:00:00.000Z",
    humanReviewConfirmed: true,
  };
  assert.doesNotThrow(() => assertSourceVerificationSubmission(valid, envelope()));
  assert.throws(
    () => assertSourceVerificationSubmission({ ...valid, manifestSha256: "d".repeat(64) }, envelope()),
    /checksum mismatch/,
  );
  assert.throws(
    () => assertSourceVerificationSubmission({ ...valid, reviewerRef: "llm" }, envelope()),
    /human reviewer/,
  );
  assert.throws(
    () => assertSourceVerificationSubmission({ ...valid, humanReviewConfirmed: false }, envelope()),
    /human-review confirmation/,
  );
});

test("verification client rechecks the manifest immediately before atomic submission", async () => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ url, body });
    if (url.endsWith("/rpc/get_official_source_verification_manifest")) {
      return Response.json(envelope());
    }
    return Response.json({
      verificationId: "verification:fixture:1",
      versionId: envelope().manifest.versionId,
      outcome: "APPROVED",
      manifestSha256: MANIFEST_SHA256,
      lifecycleState: "VERIFIED",
      reviewedAt: "2026-07-31T00:00:00.000Z",
    });
  };
  const client = new SourceVerificationClient(new SupabaseHttpClient({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role",
    reportsBucket: "policy-reports",
    datasetsBucket: "policy-datasets",
    sourcesBucket: "policy-sources",
    requestTimeoutMs: 1000,
  }, fetchImpl));

  const result = await client.submit({
    verificationId: "verification:fixture:1",
    versionId: envelope().manifest.versionId,
    outcome: "APPROVED",
    verificationMethod: "OFFICIAL_BYTE_AND_LOCATOR_REVIEW",
    reviewerRole: "Qualified legal reviewer",
    reviewerRef: "reviewer:fixture:1",
    manifestSha256: MANIFEST_SHA256,
    reviewedAt: "2026-07-31T00:00:00.000Z",
    humanReviewConfirmed: true,
  });

  assert.equal(result.lifecycleState, "VERIFIED");
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /get_official_source_verification_manifest/);
  assert.match(calls[1].url, /review_official_source_version/);
  assert.equal(calls[1].body.p_reviewer_ref, "reviewer:fixture:1");
  assert.equal(calls[1].body.p_private_notes, null);
});

test("source verification migration is private, immutable and cannot create claims", async () => {
  const sql = await readFile(
    path.join(process.cwd(), "supabase/migrations/0010_source_verification_workflow.sql"),
    "utf8",
  );
  assert.match(sql, /create table regulatory\.source_verification_records/);
  assert.match(sql, /protect_source_verification_record_trigger/);
  assert.match(sql, /source_verification_one_approval_idx/);
  assert.match(sql, /source verification manifest checksum mismatch/);
  assert.match(sql, /v_unknown_permission_count > 0/);
  assert.match(sql, /lifecycle_state = 'VERIFIED'/);
  assert.match(sql, /language plpgsql\s+security definer\s+set search_path = policy, regulatory, public, extensions/);
  assert.match(sql, /grant select on table regulatory\.source_verification_records\s+to service_role/);
  assert.doesNotMatch(sql, /grant select, insert on table regulatory\.source_verification_records/i);
  assert.match(sql, /grant execute on function policy\.review_official_source_version[\s\S]*to service_role/);
  assert.match(sql, /from public, anon, authenticated/);
  assert.doesNotMatch(sql, /insert into policy\.legal_claims/i);
  assert.doesNotMatch(sql, /insert into policy\.citations/i);
  assert.doesNotMatch(sql, /decision_rule|playbook_action/i);
});
