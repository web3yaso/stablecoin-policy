import type { SupabaseHttpClient } from "../data/supabase-client";

export type BaselineWorkflowStage =
  | "SOURCE_INGESTION"
  | "SOURCE_REVIEW"
  | "CLAIM_DRAFTING"
  | "CLAIM_REVIEW"
  | "CORPUS_RELEASE"
  | "COVERAGE_REVIEW"
  | "COMPLETE";

export type BaselineReadinessInput = {
  sourceVersionCount: number;
  verifiedSourceVersionCount: number;
  claimCount: number;
  pendingClaimCount: number;
  reviewedClaimCount: number;
  publishedReleaseCount: number;
  checklistCount: number;
  coverageReviewed: boolean;
  coverageFresh: boolean;
};

export type BaselineReadinessEnvelope = {
  schemaVersion: "1.0.0";
  jurisdictionCode: string;
  workflowStage: BaselineWorkflowStage;
  workflowComplete: boolean;
  legalCompletenessAssessed: false;
  coverage: {
    coverageState: "UNSUPPORTED" | "IN_PROGRESS" | "REVIEWED";
    completenessPercent: number;
    freshnessState: "CURRENT" | "STALE" | "UNKNOWN";
    reviewedAt: string | null;
  };
  counts: {
    sourceVersions: number;
    verifiedSourceVersions: number;
    claims: number;
    pendingClaims: number;
    reviewedClaims: number;
    publishedReleases: number;
    coverageChecklists: number;
  };
  blockers: string[];
  warnings: string[];
};

const JURISDICTION = /^[A-Z][A-Z0-9-]{1,15}$/;

export function baselineWorkflowStage(input: BaselineReadinessInput): BaselineWorkflowStage {
  if (input.coverageReviewed) return "COMPLETE";
  if (input.sourceVersionCount === 0) return "SOURCE_INGESTION";
  if (input.verifiedSourceVersionCount === 0) return "SOURCE_REVIEW";
  if (input.claimCount === 0) return "CLAIM_DRAFTING";
  if (input.reviewedClaimCount === 0) return "CLAIM_REVIEW";
  if (input.publishedReleaseCount === 0) return "CORPUS_RELEASE";
  return "COVERAGE_REVIEW";
}

export function baselineReadinessBlockers(input: BaselineReadinessInput): string[] {
  const blockers: string[] = [];
  if (input.sourceVersionCount === 0) blockers.push("source_versions_missing");
  if (input.verifiedSourceVersionCount === 0) blockers.push("verified_sources_missing");
  if (input.claimCount === 0) blockers.push("claims_missing");
  if (input.reviewedClaimCount === 0) blockers.push("reviewed_claims_missing");
  if (input.publishedReleaseCount === 0) blockers.push("published_release_missing");
  if (input.checklistCount === 0) blockers.push("coverage_checklist_missing");
  if (!input.coverageReviewed) blockers.push("coverage_review_missing");
  return blockers;
}

export class BaselineReadinessClient {
  constructor(private readonly client: SupabaseHttpClient) {}

  async get(jurisdictionCode: string): Promise<BaselineReadinessEnvelope> {
    if (!JURISDICTION.test(jurisdictionCode)) {
      throw new Error("baseline readiness jurisdiction is invalid");
    }
    return this.client.rpc("get_jurisdiction_baseline_readiness", {
      p_jurisdiction_code: jurisdictionCode,
    });
  }
}
