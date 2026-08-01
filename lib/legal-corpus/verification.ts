import type { SupabaseHttpClient } from "../data/supabase-client";

export type SourceVerificationOutcome = "APPROVED" | "REJECTED";
export type SourceVerificationMethod =
  | "OFFICIAL_BYTE_AND_LOCATOR_REVIEW"
  | "REFERENCE_COPY_CROSS_CHECK";

export type SourceVerificationManifest = {
  schemaVersion: "1.0.0";
  versionId: string;
  documentId: string;
  versionLabel: string;
  rawObjectId: string;
  checksumSha256: string;
  officialUrl: string;
  publishedAt: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  observedAt: string;
  retrievedAt: string;
  storageRights: "ALLOWED" | "REVIEW_REQUIRED" | "PROHIBITED";
  rightsReviewedAt: string | null;
  rightsBasis: string | null;
  redistributionRights: "FULL_TEXT" | "EXCERPT" | "LINK_ONLY" | "UNKNOWN";
  licenceIdentifier: string | null;
  provisions: Array<{
    provisionId: string;
    locator: string;
    languageCode: string;
    textChecksumSha256: string;
    ordinal: number;
    effectiveExcerptPermission: "ALLOWED" | "LINK_ONLY" | "UNKNOWN";
  }>;
};

export type SourceVerificationManifestEnvelope = {
  manifest: SourceVerificationManifest;
  manifestSha256: string;
  lifecycleState: "OBSERVED" | "VERIFIED" | "SUPERSEDED" | "CORRECTED" | "RETRACTED";
  verifiedAt: string | null;
};

export type SourceVerificationSubmission = {
  verificationId: string;
  versionId: string;
  outcome: SourceVerificationOutcome;
  verificationMethod: SourceVerificationMethod;
  reviewerRole: string;
  reviewerRef: string;
  manifestSha256: string;
  reviewedAt: string;
  privateNotes?: string;
  humanReviewConfirmed: boolean;
};

export type SourceVerificationResult = {
  verificationId: string;
  versionId: string;
  outcome: SourceVerificationOutcome;
  manifestSha256: string;
  lifecycleState: "OBSERVED" | "VERIFIED";
  reviewedAt: string;
};

const SHA256 = /^[0-9a-f]{64}$/;
const ID = /^[a-z0-9][a-z0-9._:-]{2,160}$/;
const MACHINE_REVIEWERS = new Set(["ai", "llm", "system", "automation", "unknown"]);
const OUTCOMES = new Set<SourceVerificationOutcome>(["APPROVED", "REJECTED"]);
const METHODS = new Set<SourceVerificationMethod>([
  "OFFICIAL_BYTE_AND_LOCATOR_REVIEW",
  "REFERENCE_COPY_CROSS_CHECK",
]);

export function sourceVerificationReadinessErrors(
  envelope: SourceVerificationManifestEnvelope,
): string[] {
  const errors: string[] = [];
  if (envelope.lifecycleState !== "OBSERVED") errors.push("source_not_observed");
  if (envelope.verifiedAt !== null) errors.push("source_already_verified");
  if (envelope.manifest.storageRights !== "ALLOWED") errors.push("storage_rights_not_allowed");
  if (!envelope.manifest.rightsReviewedAt || !envelope.manifest.rightsBasis?.trim()) {
    errors.push("storage_rights_review_missing");
  }
  if (envelope.manifest.provisions.length === 0) errors.push("provisions_missing");
  if (
    envelope.manifest.provisions.some(
      (provision) => provision.effectiveExcerptPermission === "UNKNOWN",
    )
  ) {
    errors.push("excerpt_permission_unknown");
  }
  return errors;
}

export function assertSourceVerificationSubmission(
  submission: SourceVerificationSubmission,
  envelope: SourceVerificationManifestEnvelope,
): void {
  if (!ID.test(submission.verificationId) || !ID.test(submission.versionId)) {
    throw new Error("source verification IDs are invalid");
  }
  if (!OUTCOMES.has(submission.outcome)) {
    throw new Error("source verification outcome is invalid");
  }
  if (!METHODS.has(submission.verificationMethod)) {
    throw new Error("source verification method is invalid");
  }
  if (submission.versionId !== envelope.manifest.versionId) {
    throw new Error("source verification version does not match manifest");
  }
  if (!SHA256.test(submission.manifestSha256)) {
    throw new Error("source verification manifest checksum is invalid");
  }
  if (submission.manifestSha256 !== envelope.manifestSha256) {
    throw new Error("source verification manifest checksum mismatch");
  }
  if (!submission.humanReviewConfirmed) {
    throw new Error("source verification requires explicit human-review confirmation");
  }
  if (!submission.reviewerRole.trim() || !submission.reviewerRef.trim()) {
    throw new Error("source verification requires an identified human reviewer");
  }
  if (MACHINE_REVIEWERS.has(submission.reviewerRef.trim().toLowerCase())) {
    throw new Error("source verification requires an identified human reviewer");
  }
  const reviewedAt = Date.parse(submission.reviewedAt);
  if (!Number.isFinite(reviewedAt) || reviewedAt < Date.parse(envelope.manifest.retrievedAt)) {
    throw new Error("source verification review time is invalid");
  }
  if (reviewedAt > Date.now() + 5 * 60_000) {
    throw new Error("source verification review time cannot be in the future");
  }
  if (submission.outcome === "APPROVED") {
    const errors = sourceVerificationReadinessErrors(envelope);
    if (errors.length > 0) {
      throw new Error(`source version is not ready for approval: ${errors.join(", ")}`);
    }
  } else if (envelope.lifecycleState !== "OBSERVED") {
    throw new Error("only OBSERVED source versions may be reviewed");
  }
}

export class SourceVerificationClient {
  constructor(private readonly client: SupabaseHttpClient) {}

  async prepare(versionId: string): Promise<SourceVerificationManifestEnvelope> {
    if (!ID.test(versionId)) throw new Error("source version ID is invalid");
    return this.client.rpc<SourceVerificationManifestEnvelope>(
      "get_official_source_verification_manifest",
      { p_version_id: versionId },
    );
  }

  async submit(submission: SourceVerificationSubmission): Promise<SourceVerificationResult> {
    const envelope = await this.prepare(submission.versionId);
    assertSourceVerificationSubmission(submission, envelope);
    return this.client.rpc<SourceVerificationResult>("review_official_source_version", {
      p_verification_id: submission.verificationId,
      p_version_id: submission.versionId,
      p_outcome: submission.outcome,
      p_verification_method: submission.verificationMethod,
      p_reviewer_role: submission.reviewerRole.trim(),
      p_reviewer_ref: submission.reviewerRef.trim(),
      p_manifest_sha256: submission.manifestSha256,
      p_reviewed_at: submission.reviewedAt,
      p_private_notes: submission.privateNotes?.trim() || null,
    });
  }
}
