import type { SupabaseHttpClient } from "../data/supabase-client";

export type ClaimReviewOutcome = "APPROVED" | "CHANGES_REQUESTED" | "REJECTED";
export type ClaimReviewState =
  | "DRAFT"
  | "IN_REVIEW"
  | "REVIEWED"
  | "PUBLISHED"
  | "SUPERSEDED"
  | "RETRACTED";

export type ClaimReviewManifest = {
  schemaVersion: "1.0.0";
  claimId: string;
  policyDomain: "stablecoin";
  jurisdictionCode: string;
  topic: string;
  proposition: string;
  legalStatus: "REQUIREMENT" | "PERMISSION" | "PROHIBITION" | "EXEMPTION" | "GUIDANCE" | "UNDETERMINED";
  effectiveFrom: string;
  effectiveTo: string | null;
  knowledgeCutoff: string;
  actorTypes: string[];
  activityCodes: string[];
  supersedesClaimId: string | null;
  citations: Array<{
    citationId: string;
    supportRelation: "DIRECT_SUPPORT" | "INDIRECT_SUPPORT" | "CONTRADICTS";
    exactLocator: string;
    allowedExcerpt: string | null;
    provisionId: string;
    provisionLocator: string;
    languageCode: string;
    textChecksumSha256: string;
    effectiveExcerptPermission: "ALLOWED" | "LINK_ONLY" | "UNKNOWN";
    sourceVersionId: string;
    sourceVersionChecksumSha256: string;
    documentId: string;
    documentTitle: string;
    canonicalUrl: string;
    authorityId: string;
    authorityName: string;
    evidenceLayer: "OFFICIAL_SOURCE";
  }>;
};

export type ClaimReviewManifestEnvelope = {
  manifest: ClaimReviewManifest;
  manifestSha256: string;
  reviewState: ClaimReviewState;
  readinessErrors: string[];
};

export type ClaimReviewSubmission = {
  reviewId: string;
  claimId: string;
  outcome: ClaimReviewOutcome;
  reviewerRole: string;
  reviewerRef: string;
  manifestSha256: string;
  reviewedAt: string;
  privateNotes?: string;
  humanReviewConfirmed: boolean;
};

const SHA256 = /^[0-9a-f]{64}$/;
const ID = /^[a-z0-9][a-z0-9._:-]{2,160}$/;
const OUTCOMES = new Set<ClaimReviewOutcome>([
  "APPROVED",
  "CHANGES_REQUESTED",
  "REJECTED",
]);
const MACHINE_REVIEWERS = new Set(["ai", "llm", "system", "automation", "unknown"]);

export type ClaimEvidenceReadinessInput = {
  citationCount: number;
  contradictionCount: number;
  unverifiedSourceCount: number;
  unknownPermissionCount: number;
  unauthorizedExcerptCount: number;
  directOfficialSupportCount: number;
};

export function claimEvidenceReadinessErrors(input: ClaimEvidenceReadinessInput): string[] {
  const errors: string[] = [];
  if (input.citationCount === 0) errors.push("citations_missing");
  if (input.contradictionCount > 0) errors.push("contradictory_evidence");
  if (input.unverifiedSourceCount > 0) errors.push("unverified_source");
  if (input.unknownPermissionCount > 0) errors.push("unknown_excerpt_permission");
  if (input.unauthorizedExcerptCount > 0) errors.push("unauthorized_excerpt");
  if (input.directOfficialSupportCount === 0) errors.push("direct_official_support_missing");
  return errors;
}

export function assertClaimReviewSubmission(
  submission: ClaimReviewSubmission,
  envelope: ClaimReviewManifestEnvelope,
): void {
  if (!ID.test(submission.reviewId) || !ID.test(submission.claimId)) {
    throw new Error("claim review IDs are invalid");
  }
  if (!OUTCOMES.has(submission.outcome)) throw new Error("claim review outcome is invalid");
  if (submission.claimId !== envelope.manifest.claimId) {
    throw new Error("claim review claim does not match manifest");
  }
  if (envelope.reviewState !== "IN_REVIEW") {
    throw new Error("only IN_REVIEW claims may be reviewed");
  }
  if (!SHA256.test(submission.manifestSha256)) {
    throw new Error("claim review manifest checksum is invalid");
  }
  if (submission.manifestSha256 !== envelope.manifestSha256) {
    throw new Error("claim review manifest checksum mismatch");
  }
  if (!submission.humanReviewConfirmed) {
    throw new Error("claim review requires explicit human-review confirmation");
  }
  if (!submission.reviewerRole.trim() || !submission.reviewerRef.trim()) {
    throw new Error("claim review requires an identified human reviewer");
  }
  if (MACHINE_REVIEWERS.has(submission.reviewerRef.trim().toLowerCase())) {
    throw new Error("claim review requires an identified human reviewer");
  }
  const reviewedAt = Date.parse(submission.reviewedAt);
  if (!Number.isFinite(reviewedAt) || reviewedAt > Date.now() + 5 * 60_000) {
    throw new Error("claim review time is invalid");
  }
  if (submission.outcome === "APPROVED" && envelope.readinessErrors.length > 0) {
    throw new Error(`claim is not ready for approval: ${envelope.readinessErrors.join(", ")}`);
  }
}

export class ClaimReviewClient {
  constructor(private readonly client: SupabaseHttpClient) {}

  async submitForReview(claimId: string): Promise<Record<string, unknown>> {
    if (!ID.test(claimId)) throw new Error("claim ID is invalid");
    return this.client.rpc("submit_legal_claim_for_review", { p_claim_id: claimId });
  }

  async prepare(claimId: string): Promise<ClaimReviewManifestEnvelope> {
    if (!ID.test(claimId)) throw new Error("claim ID is invalid");
    return this.client.rpc("get_legal_claim_review_manifest", { p_claim_id: claimId });
  }

  async review(submission: ClaimReviewSubmission): Promise<Record<string, unknown>> {
    const envelope = await this.prepare(submission.claimId);
    assertClaimReviewSubmission(submission, envelope);
    return this.client.rpc("review_legal_claim", {
      p_review_id: submission.reviewId,
      p_claim_id: submission.claimId,
      p_outcome: submission.outcome,
      p_reviewer_role: submission.reviewerRole.trim(),
      p_reviewer_ref: submission.reviewerRef.trim(),
      p_manifest_sha256: submission.manifestSha256,
      p_reviewed_at: submission.reviewedAt,
      p_private_notes: submission.privateNotes?.trim() || null,
    });
  }
}
