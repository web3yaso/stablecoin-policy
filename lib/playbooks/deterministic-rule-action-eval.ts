import { sha256, stableJson } from "../data/integrity";
import type { EvidenceSearchResponse } from "../retrieval/contracts";
import type {
  BusinessProfile,
  CapabilityConclusion,
  CapabilityResult,
  PlaybookDefinition,
} from "./contracts";
import {
  buildPlaybookRetrievalRequest,
  retrievePlaybookEvidence,
} from "./retrieval";
import {
  evaluatePlaybook,
  UNDETERMINED_OPERATIONAL_ACTION,
  type EvaluationEvidence,
} from "./runtime";
import {
  selfServiceScopeId,
  type SelfServiceScope,
} from "./scope-readiness";

const CASE_ID = /^[a-z0-9][a-z0-9._:-]{2,160}$/;

export type DegradationKind =
  | "NONE"
  | "MISSING_INPUT"
  | "MISSING_EVIDENCE"
  | "STALE_REQUIREMENT"
  | "STALE_PROHIBITION"
  | "CONFLICTING_EVIDENCE"
  | "UNVERIFIED_DEPLOYMENT"
  | "UNSUPPORTED_ACTIVITY";

export type DeterministicRuleActionEvalCase = {
  caseId: string;
  scope: SelfServiceScope;
  definition: PlaybookDefinition;
  profile: BusinessProfile;
  evidence: EvaluationEvidence;
  expected: {
    capabilityId: string;
    conclusion: CapabilityConclusion;
    reasonCodes: string[];
  };
  degradationKind: DegradationKind;
};

export type DeterministicRuleActionScopeMetrics = {
  scopeId: string;
  jurisdictionCode: string;
  assetId: string | null;
  playbookId: string;
  caseCount: number;
  statusReasonExactMatchRate: number;
  repeatedRunExactMatchRate: number;
  ragIsolationRate: number;
  safeDegradationRate: number;
  materialActionGroundingRate: number;
  deterministicRuleActionGatePassed: boolean;
};

export type DeterministicRuleActionEvalReport = {
  schemaVersion: "1.0.0";
  datasetId: string;
  thresholds: {
    minimumCasesPerScope: 4;
    statusReasonExactMatchRate: 1;
    repeatedRunExactMatchRate: 1;
    ragIsolationRate: 1;
    safeDegradationRate: 1;
    materialActionGroundingRate: 1;
  };
  caseCount: number;
  scopes: DeterministicRuleActionScopeMetrics[];
  results: Array<{
    caseId: string;
    scopeId: string;
    inputArtifactSha256: string;
    statusReasonExactMatch: boolean;
    repeatedRunExactMatch: boolean;
    ragIsolationValid: boolean;
    safeDegradationValid: boolean;
    materialActionGroundingValid: boolean;
    exactMatch: boolean;
  }>;
  outcome: "PASSED" | "FAILED";
  limitations: string[];
};

type EvaluationFunction = typeof evaluatePlaybook;

export async function runDeterministicRuleActionEval(
  inputCases: DeterministicRuleActionEvalCase[],
  evaluation: EvaluationFunction = evaluatePlaybook,
): Promise<DeterministicRuleActionEvalReport> {
  if (inputCases.length === 0) {
    throw new Error("deterministic rule/action eval dataset is empty");
  }
  const cases = [...inputCases].sort((left, right) => left.caseId.localeCompare(right.caseId));
  if (new Set(cases.map((item) => item.caseId)).size !== cases.length
    || cases.some((item) => !CASE_ID.test(item.caseId))) {
    throw new Error("deterministic rule/action eval case IDs must be valid and unique");
  }

  const results = await Promise.all(cases.map((evalCase) => evaluateCase(evalCase, evaluation)));
  const scopes = [...new Set(cases.map((evalCase) => selfServiceScopeId(evalCase.scope)))]
    .sort()
    .map((scopeId) => {
      const scopeCases = cases.filter((item) => selfServiceScopeId(item.scope) === scopeId);
      const scopeResults = results.filter((item) => item.scopeId === scopeId);
      return scopeMetrics(scopeId, scopeCases[0].scope, scopeResults);
    });
  const datasetProjection = cases.map((evalCase, index) => ({
    caseId: evalCase.caseId,
    scope: evalCase.scope,
    degradationKind: evalCase.degradationKind,
    expected: evalCase.expected,
    inputArtifactSha256: results[index].inputArtifactSha256,
  }));
  return {
    schemaVersion: "1.0.0",
    datasetId: `deterministic-rule-action-eval:${sha256(
      Buffer.from(stableJson(datasetProjection), "utf8"),
    ).slice(0, 32)}`,
    thresholds: {
      minimumCasesPerScope: 4,
      statusReasonExactMatchRate: 1,
      repeatedRunExactMatchRate: 1,
      ragIsolationRate: 1,
      safeDegradationRate: 1,
      materialActionGroundingRate: 1,
    },
    caseCount: cases.length,
    scopes,
    results,
    outcome: scopes.every((scope) => scope.deterministicRuleActionGatePassed)
      ? "PASSED"
      : "FAILED",
    limitations: [
      "This sanitized regression report measures the two current MVP scopes and does not activate self-service.",
      "The report contains hashes and aggregate outcomes only; profiles, rules, actions, claims, dossiers, and source text are not copied into it.",
      "Machine-assured deterministic coverage does not imply human legal review or replace signed production smoke.",
    ],
  };
}

async function evaluateCase(
  evalCase: DeterministicRuleActionEvalCase,
  evaluation: EvaluationFunction,
): Promise<DeterministicRuleActionEvalReport["results"][number]> {
  const scopeId = selfServiceScopeId(evalCase.scope);
  const baseline = evaluation(evalCase.definition, evalCase.profile, evalCase.evidence);
  const repeated = evaluation(evalCase.definition, evalCase.profile, evalCase.evidence);
  const result = baseline.find(
    (candidate) => candidate.capabilityId === evalCase.expected.capabilityId,
  );
  const statusReasonExactMatch = result !== undefined
    && result.conclusion === evalCase.expected.conclusion
    && stableJson(result.reasonCodes) === stableJson(evalCase.expected.reasonCodes);
  const repeatedRunExactMatch = stableJson(baseline) === stableJson(repeated);

  const requestAvailable = buildPlaybookRetrievalRequest(
    evalCase.definition,
    baseline,
    evalCase.evidence,
  ) !== null;
  const disabled = await retrievePlaybookEvidence(
    null,
    evalCase.definition,
    baseline,
    evalCase.evidence,
  );
  const success = await retrievePlaybookEvidence(
    { search: async () => successfulRetrievalProbe() },
    evalCase.definition,
    baseline,
    evalCase.evidence,
  );
  const outage = await retrievePlaybookEvidence(
    { search: async () => { throw new Error("fixture outage"); } },
    evalCase.definition,
    baseline,
    evalCase.evidence,
  );
  const retrievalPathsValid = requestAvailable
    ? disabled.status === "RETRIEVAL_UNAVAILABLE"
      && success.status === "SUCCESS"
      && outage.status === "RETRIEVAL_UNAVAILABLE"
    : disabled.status === "INSUFFICIENT_EVIDENCE"
      && success.status === "INSUFFICIENT_EVIDENCE"
      && outage.status === "INSUFFICIENT_EVIDENCE";
  const baselineProjection = decisionProjection(baseline);
  const ragProjections = [disabled, success, outage].map(() => decisionProjection(
    evaluation(evalCase.definition, evalCase.profile, evalCase.evidence),
  ));
  const ragIsolationValid = retrievalPathsValid && ragProjections.every(
    (projection) => stableJson(projection) === stableJson(baselineProjection),
  );
  const safeDegradationValid = result !== undefined
    && degradationIsSafe(evalCase.degradationKind, result);
  const materialActionGroundingValid = result !== undefined
    && actionsAreGrounded(result);
  const exactMatch = statusReasonExactMatch
    && repeatedRunExactMatch
    && ragIsolationValid
    && safeDegradationValid
    && materialActionGroundingValid;
  return {
    caseId: evalCase.caseId,
    scopeId,
    inputArtifactSha256: sha256(Buffer.from(stableJson({
      definition: evalCase.definition,
      profile: evalCase.profile,
      evidence: evalCase.evidence,
    }), "utf8")),
    statusReasonExactMatch,
    repeatedRunExactMatch,
    ragIsolationValid,
    safeDegradationValid,
    materialActionGroundingValid,
    exactMatch,
  };
}

function decisionProjection(results: CapabilityResult[]) {
  return results.map((result) => ({
    capabilityId: result.capabilityId,
    conclusion: result.conclusion,
    reasonCodes: result.reasonCodes,
  }));
}

function degradationIsSafe(kind: DegradationKind, result: CapabilityResult): boolean {
  const expected: Record<Exclude<DegradationKind, "NONE">, {
    conclusion: CapabilityConclusion;
    reasonCode: string;
  }> = {
    MISSING_INPUT: { conclusion: "UNDETERMINED", reasonCode: "MISSING_INPUT" },
    MISSING_EVIDENCE: { conclusion: "UNDETERMINED", reasonCode: "NO_DIRECT_EVIDENCE" },
    STALE_REQUIREMENT: { conclusion: "CONDITIONAL", reasonCode: "EVIDENCE_STALE" },
    STALE_PROHIBITION: { conclusion: "COUNSEL_REVIEW", reasonCode: "EVIDENCE_STALE" },
    CONFLICTING_EVIDENCE: { conclusion: "COUNSEL_REVIEW", reasonCode: "EVIDENCE_CONFLICT" },
    UNVERIFIED_DEPLOYMENT: {
      conclusion: "UNDETERMINED",
      reasonCode: "DEPLOYMENT_NOT_VERIFIED",
    },
    UNSUPPORTED_ACTIVITY: { conclusion: "UNDETERMINED", reasonCode: "UNSUPPORTED_ACTIVITY" },
  };
  if (kind === "NONE") return true;
  const rule = expected[kind];
  return result.conclusion === rule.conclusion
    && result.reasonCodes.includes(rule.reasonCode)
    && (rule.conclusion !== "UNDETERMINED"
      || stableJson(result.actions) === stableJson([UNDETERMINED_OPERATIONAL_ACTION]));
}

function actionsAreGrounded(result: CapabilityResult): boolean {
  if (result.conclusion === "UNDETERMINED") {
    return stableJson(result.actions) === stableJson([UNDETERMINED_OPERATIONAL_ACTION]);
  }
  return result.actions.length > 0 && result.evidenceClaimIds.length > 0;
}

function scopeMetrics(
  scopeId: string,
  scope: SelfServiceScope,
  results: DeterministicRuleActionEvalReport["results"],
): DeterministicRuleActionScopeMetrics {
  const caseCount = results.length;
  const rate = (key: keyof Pick<
    DeterministicRuleActionEvalReport["results"][number],
    | "statusReasonExactMatch"
    | "repeatedRunExactMatch"
    | "ragIsolationValid"
    | "safeDegradationValid"
    | "materialActionGroundingValid"
  >) => results.filter((result) => result[key]).length / caseCount;
  const metrics = {
    statusReasonExactMatchRate: rate("statusReasonExactMatch"),
    repeatedRunExactMatchRate: rate("repeatedRunExactMatch"),
    ragIsolationRate: rate("ragIsolationValid"),
    safeDegradationRate: rate("safeDegradationValid"),
    materialActionGroundingRate: rate("materialActionGroundingValid"),
  };
  return {
    scopeId,
    jurisdictionCode: scope.jurisdictionCode,
    assetId: scope.assetId,
    playbookId: scope.playbookId,
    caseCount,
    ...metrics,
    deterministicRuleActionGatePassed: caseCount >= 4
      && Object.values(metrics).every((value) => value === 1),
  };
}

function successfulRetrievalProbe(): EvidenceSearchResponse {
  return {
    schemaVersion: "1.0.0",
    runId: "rag-run:1111111111111111:0000000000000001",
    status: "SUCCESS",
    querySha256: "1".repeat(64),
    indexRelease: {
      indexReleaseId: "rag-index:deterministic-eval:1",
      corpusReleaseId: "corpus:deterministic-eval:1",
      assuranceTier: "PROVISIONAL",
      asOf: "2026-08-02T00:00:00.000Z",
      knowledgeCutoff: "2026-08-01T00:00:00.000Z",
      generatedAt: "2026-08-03T00:00:00.000Z",
      freshThrough: "2026-08-04T00:00:00.000Z",
      embeddingModel: "sanitized-eval",
      embeddingModelVersion: "1",
      embeddingDimensions: 3,
      lexicalConfigVersion: "1",
      vectorConfigVersion: "1",
    },
    hits: [],
    limitations: ["Sanitized eval probe; narrative output is not evaluated here."],
    explanation: null,
  };
}
