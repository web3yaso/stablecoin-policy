import type { SupabaseHttpClient } from "../data/supabase-client";

export type ReviewQueueTaskType =
  | "SOURCE_VERIFICATION"
  | "CLAIM_REVIEW"
  | "CORPUS_RELEASE_REVIEW"
  | "COVERAGE_REVIEW_PREPARATION";

export type ReviewQueueNextAction =
  | "RESOLVE_SOURCE_EVIDENCE"
  | "REVIEW_SOURCE"
  | "RESOLVE_CLAIM_EVIDENCE"
  | "SUBMIT_CLAIM_FOR_REVIEW"
  | "REVIEW_CLAIM"
  | "RESOLVE_RELEASE_EVIDENCE"
  | "SUBMIT_RELEASE_FOR_REVIEW"
  | "REVIEW_RELEASE"
  | "PUBLISH_RELEASE"
  | "DEFINE_COVERAGE_CHECKLIST"
  | "PREPARE_COVERAGE_REVIEW";

export type ReviewQueueTask = {
  taskType: ReviewQueueTaskType;
  subjectId: string;
  subjectState: string;
  priority: number;
  nextAction: ReviewQueueNextAction;
  readinessErrors: string[];
  requiredInputs: string[];
  relatedIds?: { releaseId: string | null; checklistId: string | null };
  command: { script: string; args: string[] };
};

export type ReviewQueueEnvelope = {
  schemaVersion: "1.0.0";
  jurisdictionCode: string;
  humanReviewRequired: true;
  automaticApprovalAllowed: false;
  totalTaskCount: number;
  returnedTaskCount: number;
  tasks: ReviewQueueTask[];
};

export type ReviewQueueActionInput = {
  taskType: ReviewQueueTaskType;
  subjectState: string;
  hasReadinessErrors: boolean;
  hasCoverageChecklist?: boolean;
};

const JURISDICTION = /^[A-Z][A-Z0-9-]{1,15}$/;

export function reviewQueueNextAction(input: ReviewQueueActionInput): ReviewQueueNextAction {
  if (input.taskType === "SOURCE_VERIFICATION") {
    return input.hasReadinessErrors ? "RESOLVE_SOURCE_EVIDENCE" : "REVIEW_SOURCE";
  }
  if (input.taskType === "CLAIM_REVIEW") {
    if (input.hasReadinessErrors) return "RESOLVE_CLAIM_EVIDENCE";
    return input.subjectState === "DRAFT" ? "SUBMIT_CLAIM_FOR_REVIEW" : "REVIEW_CLAIM";
  }
  if (input.taskType === "CORPUS_RELEASE_REVIEW") {
    if (input.hasReadinessErrors) return "RESOLVE_RELEASE_EVIDENCE";
    if (input.subjectState === "DRAFT") return "SUBMIT_RELEASE_FOR_REVIEW";
    if (input.subjectState === "IN_REVIEW") return "REVIEW_RELEASE";
    return "PUBLISH_RELEASE";
  }
  return input.hasCoverageChecklist
    ? "PREPARE_COVERAGE_REVIEW"
    : "DEFINE_COVERAGE_CHECKLIST";
}

export class ReviewQueueClient {
  constructor(private readonly client: SupabaseHttpClient) {}

  async get(jurisdictionCode: string, limit = 100): Promise<ReviewQueueEnvelope> {
    if (!JURISDICTION.test(jurisdictionCode)) {
      throw new Error("review queue jurisdiction is invalid");
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      throw new Error("review queue limit must be between 1 and 200");
    }
    return this.client.rpc("get_legal_corpus_review_queue", {
      p_jurisdiction_code: jurisdictionCode,
      p_limit: limit,
    });
  }
}
