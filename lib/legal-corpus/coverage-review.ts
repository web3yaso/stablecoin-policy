import type { SupabaseHttpClient } from "../data/supabase-client";

export type CoverageReadinessInput = {
  coverageInProgress: boolean;
  checklistJurisdictionMatches: boolean;
  corpusPublished: boolean;
  freshnessCutoffValid: boolean;
  jurisdictionClaimCount: number;
  unsupportedChecklistItemCount: number;
  staleSourceCount: number;
};

export function coverageReadinessErrors(input: CoverageReadinessInput): string[] {
  const errors: string[] = [];
  if (!input.coverageInProgress) errors.push("coverage_not_in_progress");
  if (!input.checklistJurisdictionMatches) errors.push("checklist_jurisdiction_mismatch");
  if (!input.corpusPublished) errors.push("corpus_not_published");
  if (!input.freshnessCutoffValid) errors.push("invalid_freshness_cutoff");
  if (input.jurisdictionClaimCount === 0) errors.push("jurisdiction_claims_missing");
  if (input.unsupportedChecklistItemCount > 0) errors.push("checklist_item_unsupported");
  if (input.staleSourceCount > 0) errors.push("source_freshness_failed");
  return errors;
}

export type CoverageReviewEnvelope = {
  manifest: Record<string, unknown> & { jurisdictionCode: string };
  manifestSha256: string;
  readinessErrors: string[];
};

const SHA256 = /^[0-9a-f]{64}$/;
const ID = /^[a-z0-9][a-z0-9._:-]{2,160}$/;
const JURISDICTION = /^[A-Z][A-Z0-9-]{1,15}$/;
const MACHINE_REVIEWERS = new Set(["ai", "llm", "system", "automation", "unknown"]);

export class CoverageReviewClient {
  constructor(private readonly client: SupabaseHttpClient) {}

  async createChecklist(input: {
    checklistId: string;
    jurisdictionCode: string;
    versionLabel: string;
    items: unknown[];
  }) {
    assertId(input.checklistId);
    assertJurisdiction(input.jurisdictionCode);
    if (!input.versionLabel.trim() || input.items.length === 0) {
      throw new Error("coverage checklist requires a version and items");
    }
    return this.client.rpc<Record<string, unknown>>("create_coverage_baseline_checklist", {
      p_checklist_id: input.checklistId,
      p_jurisdiction_code: input.jurisdictionCode,
      p_version_label: input.versionLabel.trim(),
      p_items: input.items,
    });
  }

  async prepare(input: {
    jurisdictionCode: string;
    checklistId: string;
    releaseId: string;
    freshnessCutoff: string;
    publicNote: string;
  }): Promise<CoverageReviewEnvelope> {
    assertJurisdiction(input.jurisdictionCode);
    assertId(input.checklistId);
    assertId(input.releaseId);
    return this.client.rpc("get_coverage_review_manifest", {
      p_jurisdiction_code: input.jurisdictionCode,
      p_checklist_id: input.checklistId,
      p_release_id: input.releaseId,
      p_freshness_cutoff: input.freshnessCutoff,
      p_public_note: input.publicNote,
    });
  }

  async review(input: {
    coverageReviewId: string;
    jurisdictionCode: string;
    checklistId: string;
    releaseId: string;
    freshnessCutoff: string;
    publicNote: string;
    manifestSha256: string;
    reviewerRole: string;
    reviewerRef: string;
    reviewedAt: string;
    privateNotes?: string;
    humanReviewConfirmed: boolean;
  }) {
    assertId(input.coverageReviewId);
    const envelope = await this.prepare(input);
    if (!SHA256.test(input.manifestSha256) || input.manifestSha256 !== envelope.manifestSha256) {
      throw new Error("coverage review manifest checksum mismatch");
    }
    if (envelope.readinessErrors.length > 0) {
      throw new Error(`coverage is not ready: ${envelope.readinessErrors.join(", ")}`);
    }
    if (!input.humanReviewConfirmed || !input.reviewerRole.trim()
        || !input.reviewerRef.trim()
        || MACHINE_REVIEWERS.has(input.reviewerRef.trim().toLowerCase())) {
      throw new Error("coverage review requires an identified human reviewer");
    }
    return this.client.rpc<Record<string, unknown>>("review_coverage_scope", {
      p_coverage_review_id: input.coverageReviewId,
      p_jurisdiction_code: input.jurisdictionCode,
      p_checklist_id: input.checklistId,
      p_release_id: input.releaseId,
      p_freshness_cutoff: input.freshnessCutoff,
      p_public_note: input.publicNote,
      p_manifest_sha256: input.manifestSha256,
      p_reviewer_role: input.reviewerRole.trim(),
      p_reviewer_ref: input.reviewerRef.trim(),
      p_reviewed_at: input.reviewedAt,
      p_private_notes: input.privateNotes?.trim() || null,
    });
  }
}

function assertId(value: string): void {
  if (!ID.test(value)) throw new Error("coverage review ID is invalid");
}
function assertJurisdiction(value: string): void {
  if (!JURISDICTION.test(value)) throw new Error("coverage jurisdiction is invalid");
}
