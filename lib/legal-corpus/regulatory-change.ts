import type { SupabaseHttpClient } from "../data/supabase-client";

export type RegulatoryEventType =
  | "PUBLICATION"
  | "AMENDMENT"
  | "EFFECTIVE_DATE"
  | "DEADLINE"
  | "CORRECTION"
  | "REPEAL";
export type RegulatoryEventState = "CANDIDATE" | "REVIEWED" | "PUBLISHED" | "RETRACTED";
export type ChangeImpactType = "MAY_AFFECT" | "INVALIDATES" | "SUPERSEDES" | "DEADLINE";
export type ChangeImpactState = "PENDING" | "REVIEWED" | "DISMISSED";

export type ProvisionChange = {
  changeType: "ADDED" | "REMOVED" | "MODIFIED";
  locator: string;
  languageCode: string;
  beforeProvisionId: string | null;
  beforeTextChecksumSha256: string | null;
  afterProvisionId: string | null;
  afterTextChecksumSha256: string | null;
};

export type RegulatoryChangeCandidateEnvelope = {
  manifest: {
    schemaVersion: "1.0.0";
    documentId: string;
    authorityId: string;
    beforeVersionId: string;
    beforeVersionChecksumSha256: string;
    afterVersionId: string;
    afterVersionChecksumSha256: string;
    provisionChanges: ProvisionChange[];
    claimCandidates: Array<{
      claimId: string;
      jurisdictionCode: string;
      topic: string;
    }>;
  };
  manifestSha256: string;
  readinessErrors: string[];
  legalImpactAssessed: false;
  humanReviewRequired: true;
};

export type RegulatoryEventReviewEnvelope = {
  eventId: string;
  eventType: RegulatoryEventType;
  title: string;
  observedAt: string;
  effectiveAt: string | null;
  eventState: RegulatoryEventState;
  candidateManifestSha256: string;
  currentManifestSha256: string;
  readinessErrors: string[];
  impacts: Array<{
    claimId: string;
    impactType: ChangeImpactType;
    reviewState: ChangeImpactState;
    jurisdictionCode: string;
    topic: string;
  }>;
  humanReviewRequired: true;
  automaticPublicationAllowed: false;
};

export type ChangeCandidateReadinessInput = {
  sameDocument: boolean;
  beforeVersionVerified: boolean;
  afterVersionVerified: boolean;
  provisionChangeCount: number;
  claimCandidateCount: number;
};

export type ChangePublicationReadinessInput = {
  eventState: RegulatoryEventState;
  manifestFresh: boolean;
  eventHumanApprovalCurrent: boolean;
  pendingImpactCount: number;
  reviewedImpactCount: number;
  reviewedImpactsWithCurrentApproval: number;
};

const ID = /^[a-z0-9][a-z0-9._:-]{2,160}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const MACHINE_REVIEWERS = new Set(["ai", "llm", "system", "automation", "unknown"]);

export function changeCandidateReadinessErrors(input: ChangeCandidateReadinessInput): string[] {
  const errors: string[] = [];
  if (!input.sameDocument) errors.push("source_document_mismatch");
  if (!input.beforeVersionVerified) errors.push("before_version_unverified");
  if (!input.afterVersionVerified) errors.push("after_version_unverified");
  if (input.provisionChangeCount === 0) errors.push("provision_diff_empty");
  if (input.claimCandidateCount === 0) errors.push("claim_candidates_missing");
  return errors;
}

export function changePublicationReadinessErrors(input: ChangePublicationReadinessInput): string[] {
  const errors: string[] = [];
  if (input.eventState !== "REVIEWED") errors.push("event_not_reviewed");
  if (!input.manifestFresh) errors.push("change_manifest_stale");
  if (!input.eventHumanApprovalCurrent) errors.push("event_human_approval_missing_or_stale");
  if (input.pendingImpactCount > 0) errors.push("pending_impact_review");
  if (input.reviewedImpactCount === 0) errors.push("reviewed_impact_missing");
  if (input.reviewedImpactsWithCurrentApproval !== input.reviewedImpactCount) {
    errors.push("impact_human_approval_missing_or_stale");
  }
  return errors;
}

export class RegulatoryChangeClient {
  constructor(private readonly client: SupabaseHttpClient) {}

  async prepareCandidate(beforeVersionId: string, afterVersionId: string) {
    assertId(beforeVersionId, "before source version");
    assertId(afterVersionId, "after source version");
    if (beforeVersionId === afterVersionId) throw new Error("regulatory change requires distinct versions");
    return this.client.rpc<RegulatoryChangeCandidateEnvelope>(
      "get_regulatory_change_candidate_manifest",
      { p_before_version_id: beforeVersionId, p_after_version_id: afterVersionId },
    );
  }

  async createCandidate(input: {
    eventId: string;
    beforeVersionId: string;
    afterVersionId: string;
    eventType: RegulatoryEventType;
    title: string;
    observedAt: string;
    effectiveAt?: string;
    manifestSha256: string;
  }) {
    assertId(input.eventId, "regulatory event");
    const envelope = await this.prepareCandidate(input.beforeVersionId, input.afterVersionId);
    if (envelope.manifestSha256 !== input.manifestSha256 || !SHA256.test(input.manifestSha256)) {
      throw new Error("regulatory change manifest checksum mismatch");
    }
    if (envelope.readinessErrors.length > 0) {
      throw new Error(`regulatory change candidate is not ready: ${envelope.readinessErrors.join(", ")}`);
    }
    if (!input.title.trim()) throw new Error("regulatory event title is required");
    return this.client.rpc<Record<string, unknown>>("create_regulatory_event_candidate", {
      p_event_id: input.eventId,
      p_before_version_id: input.beforeVersionId,
      p_after_version_id: input.afterVersionId,
      p_event_type: input.eventType,
      p_title: input.title.trim(),
      p_observed_at: input.observedAt,
      p_effective_at: input.effectiveAt ?? null,
      p_manifest_sha256: input.manifestSha256,
    });
  }

  async prepareEvent(eventId: string): Promise<RegulatoryEventReviewEnvelope> {
    assertId(eventId, "regulatory event");
    return this.client.rpc("get_regulatory_event_review_manifest", { p_event_id: eventId });
  }

  async reviewEvent(input: {
    eventReviewId: string;
    eventId: string;
    outcome: "APPROVED" | "REJECTED";
    reviewerRole: string;
    reviewerRef: string;
    manifestSha256: string;
    reviewedAt: string;
    privateNotes?: string;
    humanReviewConfirmed: boolean;
  }) {
    assertId(input.eventReviewId, "regulatory event review");
    const envelope = await this.prepareEvent(input.eventId);
    assertHumanReview(input);
    assertCurrentEventManifest(envelope, input.manifestSha256);
    if (envelope.eventState !== "CANDIDATE") throw new Error("only CANDIDATE events may be reviewed");
    if (input.outcome === "APPROVED" && envelope.readinessErrors.length > 0) {
      throw new Error(`regulatory event is not ready: ${envelope.readinessErrors.join(", ")}`);
    }
    return this.client.rpc<Record<string, unknown>>("review_regulatory_event", {
      p_event_review_id: input.eventReviewId,
      p_event_id: input.eventId,
      p_outcome: input.outcome,
      p_reviewer_role: input.reviewerRole.trim(),
      p_reviewer_ref: input.reviewerRef.trim(),
      p_manifest_sha256: input.manifestSha256,
      p_reviewed_at: input.reviewedAt,
      p_private_notes: input.privateNotes?.trim() || null,
    });
  }

  async reviewImpact(input: {
    impactReviewId: string;
    eventId: string;
    claimId: string;
    outcome: "REVIEWED" | "DISMISSED";
    impactType: ChangeImpactType;
    reviewerRole: string;
    reviewerRef: string;
    manifestSha256: string;
    reviewedAt: string;
    privateNotes?: string;
    humanReviewConfirmed: boolean;
  }) {
    assertId(input.impactReviewId, "regulatory impact review");
    assertId(input.claimId, "legal claim");
    const envelope = await this.prepareEvent(input.eventId);
    assertHumanReview(input);
    assertCurrentEventManifest(envelope, input.manifestSha256);
    if (envelope.eventState !== "REVIEWED") throw new Error("impact review requires a REVIEWED event");
    const impact = envelope.impacts.find((candidate) => candidate.claimId === input.claimId);
    if (!impact || impact.reviewState !== "PENDING") throw new Error("impact is not pending review");
    return this.client.rpc<Record<string, unknown>>("review_regulatory_event_impact", {
      p_impact_review_id: input.impactReviewId,
      p_event_id: input.eventId,
      p_claim_id: input.claimId,
      p_outcome: input.outcome,
      p_impact_type: input.impactType,
      p_reviewer_role: input.reviewerRole.trim(),
      p_reviewer_ref: input.reviewerRef.trim(),
      p_manifest_sha256: input.manifestSha256,
      p_reviewed_at: input.reviewedAt,
      p_private_notes: input.privateNotes?.trim() || null,
    });
  }

  async publish(eventId: string, manifestSha256: string, publishedAt: string) {
    const envelope = await this.prepareEvent(eventId);
    assertCurrentEventManifest(envelope, manifestSha256);
    const pending = envelope.impacts.filter((impact) => impact.reviewState === "PENDING").length;
    const reviewed = envelope.impacts.filter((impact) => impact.reviewState === "REVIEWED").length;
    if (envelope.eventState !== "REVIEWED" || pending > 0 || reviewed === 0) {
      throw new Error("regulatory event is not ready for publication");
    }
    return this.client.rpc<Record<string, unknown>>("publish_regulatory_event", {
      p_event_id: eventId,
      p_manifest_sha256: manifestSha256,
      p_published_at: publishedAt,
    });
  }
}

function assertCurrentEventManifest(envelope: RegulatoryEventReviewEnvelope, manifestSha256: string) {
  if (!SHA256.test(manifestSha256)
    || manifestSha256 !== envelope.candidateManifestSha256
    || manifestSha256 !== envelope.currentManifestSha256) {
    throw new Error("regulatory change manifest checksum mismatch");
  }
}

function assertHumanReview(input: {
  reviewerRole: string;
  reviewerRef: string;
  humanReviewConfirmed: boolean;
}) {
  if (!input.humanReviewConfirmed) throw new Error("regulatory change requires human review");
  if (!input.reviewerRole.trim() || !input.reviewerRef.trim()
    || MACHINE_REVIEWERS.has(input.reviewerRef.trim().toLowerCase())) {
    throw new Error("regulatory change requires an identified human reviewer");
  }
}

function assertId(value: string, name: string) {
  if (!ID.test(value)) throw new Error(`${name} ID is invalid`);
}
