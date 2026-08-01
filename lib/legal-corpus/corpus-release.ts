import type { SupabaseHttpClient } from "../data/supabase-client";
import type { ClaimReviewManifest } from "./claim-review";

export type CorpusReleaseState =
  | "DRAFT"
  | "IN_REVIEW"
  | "REVIEWED"
  | "PUBLISHED"
  | "SUPERSEDED"
  | "RETRACTED";
export type CorpusReleaseReviewOutcome = "APPROVED" | "CHANGES_REQUESTED" | "REJECTED";

export type CorpusReleaseManifestEnvelope = {
  manifest: {
    schemaVersion: "1.0.0";
    releaseId: string;
    asOf: string;
    knowledgeCutoff: string;
    claims: Array<{
      claimId: string;
      claimManifest: ClaimReviewManifest;
      claimManifestSha256: string;
    }>;
  };
  manifestSha256: string;
  releaseState: CorpusReleaseState;
  submittedAt: string | null;
  publishedAt: string | null;
  readinessErrors: string[];
};

export type CorpusReleaseReadinessInput = {
  claimCount: number;
  unreviewedClaimCount: number;
  staleClaimApprovalCount: number;
  outsideAsOfCount: number;
  afterKnowledgeCutoffCount: number;
};

export function corpusReleaseReadinessErrors(input: CorpusReleaseReadinessInput): string[] {
  const errors: string[] = [];
  if (input.claimCount === 0) errors.push("claims_missing");
  if (input.unreviewedClaimCount > 0) errors.push("unreviewed_claim");
  if (input.staleClaimApprovalCount > 0) errors.push("claim_approval_missing_or_stale");
  if (input.outsideAsOfCount > 0) errors.push("claim_outside_as_of");
  if (input.afterKnowledgeCutoffCount > 0) errors.push("claim_after_knowledge_cutoff");
  return errors;
}

const ID = /^[a-z0-9][a-z0-9._:-]{2,160}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const MACHINE_REVIEWERS = new Set(["ai", "llm", "system", "automation", "unknown"]);

export class CorpusReleaseClient {
  constructor(private readonly client: SupabaseHttpClient) {}

  async create(releaseId: string, asOf: string, knowledgeCutoff: string) {
    assertId(releaseId);
    return this.client.rpc<Record<string, unknown>>("create_corpus_release", {
      p_release_id: releaseId,
      p_as_of: asOf,
      p_knowledge_cutoff: knowledgeCutoff,
    });
  }

  async prepare(releaseId: string): Promise<CorpusReleaseManifestEnvelope> {
    assertId(releaseId);
    return this.client.rpc("get_corpus_release_review_manifest", {
      p_release_id: releaseId,
    });
  }

  async submitForReview(releaseId: string) {
    assertId(releaseId);
    return this.client.rpc<Record<string, unknown>>("submit_corpus_release_for_review", {
      p_release_id: releaseId,
    });
  }

  async review(input: {
    releaseReviewId: string;
    releaseId: string;
    outcome: CorpusReleaseReviewOutcome;
    reviewerRole: string;
    reviewerRef: string;
    manifestSha256: string;
    reviewedAt: string;
    privateNotes?: string;
    humanReviewConfirmed: boolean;
  }) {
    const envelope = await this.prepare(input.releaseId);
    assertReview(input, envelope);
    return this.client.rpc<Record<string, unknown>>("review_corpus_release", {
      p_release_review_id: input.releaseReviewId,
      p_release_id: input.releaseId,
      p_outcome: input.outcome,
      p_reviewer_role: input.reviewerRole.trim(),
      p_reviewer_ref: input.reviewerRef.trim(),
      p_manifest_sha256: input.manifestSha256,
      p_reviewed_at: input.reviewedAt,
      p_private_notes: input.privateNotes?.trim() || null,
    });
  }

  async publish(releaseId: string, manifestSha256: string, publishedAt: string) {
    assertId(releaseId);
    if (!SHA256.test(manifestSha256)) throw new Error("corpus release checksum is invalid");
    const envelope = await this.prepare(releaseId);
    if (envelope.releaseState !== "REVIEWED") {
      throw new Error("only REVIEWED corpus releases may be published");
    }
    if (envelope.manifestSha256 !== manifestSha256 || envelope.readinessErrors.length > 0) {
      throw new Error("corpus release approval is stale or invalid");
    }
    return this.client.rpc<Record<string, unknown>>("publish_corpus_release", {
      p_release_id: releaseId,
      p_manifest_sha256: manifestSha256,
      p_published_at: publishedAt,
    });
  }
}

function assertReview(
  input: {
    releaseReviewId: string;
    releaseId: string;
    outcome: CorpusReleaseReviewOutcome;
    reviewerRole: string;
    reviewerRef: string;
    manifestSha256: string;
    reviewedAt: string;
    humanReviewConfirmed: boolean;
  },
  envelope: CorpusReleaseManifestEnvelope,
): void {
  assertId(input.releaseReviewId);
  assertId(input.releaseId);
  if (envelope.releaseState !== "IN_REVIEW") {
    throw new Error("only IN_REVIEW corpus releases may be reviewed");
  }
  if (!SHA256.test(input.manifestSha256) || input.manifestSha256 !== envelope.manifestSha256) {
    throw new Error("corpus release manifest checksum mismatch");
  }
  if (!input.humanReviewConfirmed) throw new Error("corpus release requires human review");
  if (!input.reviewerRole.trim() || !input.reviewerRef.trim()
      || MACHINE_REVIEWERS.has(input.reviewerRef.trim().toLowerCase())) {
    throw new Error("corpus release requires an identified human reviewer");
  }
  if (input.outcome === "APPROVED" && envelope.readinessErrors.length > 0) {
    throw new Error(`corpus release is not ready: ${envelope.readinessErrors.join(", ")}`);
  }
}

function assertId(value: string): void {
  if (!ID.test(value)) throw new Error("corpus release ID is invalid");
}
