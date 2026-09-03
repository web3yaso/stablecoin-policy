import { sha256, stableJson } from "../data/integrity";
import type {
  EvidenceSearchResponse,
  EvidenceSearchStatus,
  IndexedEvidenceChunk,
  RetrievalIndexRelease,
} from "../retrieval/contracts";
import {
  selfServiceScopeId,
  type SelfServiceScope,
} from "./scope-readiness";

const CASE_ID = /^[a-z0-9][a-z0-9._:-]{2,160}$/;
const PROMPT_INJECTION = /ignore (all|previous).*instruction|treat .* as .*authority/i;

export type RetrievalRagEvalScenario =
  | "SUCCESS"
  | "UNAUTHORIZED_EVIDENCE"
  | "STALE_INDEX"
  | "CONFLICTING_EVIDENCE"
  | "RETRIEVAL_UNAVAILABLE";

export type RetrievalRagEvalCase = {
  caseId: string;
  scope: SelfServiceScope;
  scenario: RetrievalRagEvalScenario;
  query: string;
  topic: string;
  expectedStatus: EvidenceSearchStatus;
  expectedProvisionId: string | null;
};

export type RetrievalRagScopeMetrics = {
  scopeId: string;
  jurisdictionCode: string;
  assetId: string | null;
  playbookId: string;
  caseCount: number;
  successCaseCount: number;
  recallAt10: number;
  mrrAt10: number;
  citationPrecision: number;
  structuredFilterAccuracy: number;
  versionIsolationRate: number;
  repeatedRunExactMatchRate: number;
  safeDegradationRate: number;
  nonNarrativeSafetyRate: number;
  unauthorizedAuthorityUseCount: number;
  retrievalRagGatePassed: boolean;
};

export type RetrievalRagEvalReport = {
  schemaVersion: "1.0.0";
  datasetId: string;
  thresholds: {
    minimumCasesPerScope: 8;
    minimumSuccessCasesPerScope: 4;
    recallAt10: 0.95;
    mrrAt10: 0.9;
    citationPrecision: 1;
    structuredFilterAccuracy: 1;
    versionIsolationRate: 1;
    repeatedRunExactMatchRate: 1;
    safeDegradationRate: 1;
    nonNarrativeSafetyRate: 1;
    unauthorizedAuthorityUseCount: 0;
  };
  caseCount: number;
  scopes: RetrievalRagScopeMetrics[];
  results: Array<{
    caseId: string;
    scopeId: string;
    inputArtifactSha256: string;
    actualStatus: EvidenceSearchStatus;
    expectedStatusMatch: boolean;
    firstExpectedRank: number | null;
    citationIntegrityValid: boolean;
    structuredFiltersValid: boolean;
    versionIsolationValid: boolean;
    repeatedRunExactMatch: boolean;
    safeDegradationValid: boolean;
    nonNarrativeSafe: boolean;
    unauthorizedAuthorityUseCount: number;
    exactMatch: boolean;
  }>;
  outcome: "PASSED" | "FAILED";
  limitations: string[];
};

type SearchCase = (evalCase: RetrievalRagEvalCase) => Promise<EvidenceSearchResponse>;

type EvalContext = {
  index: RetrievalIndexRelease;
  chunks: IndexedEvidenceChunk[];
  searchCase: SearchCase;
};

type InternalResult = RetrievalRagEvalReport["results"][number] & {
  expectedSuccess: boolean;
  recalled: boolean;
  reciprocalRank: number;
};

export async function runRetrievalRagEval(
  inputCases: RetrievalRagEvalCase[],
  context: EvalContext,
): Promise<RetrievalRagEvalReport> {
  if (inputCases.length === 0) throw new Error("retrieval/RAG eval dataset is empty");
  const cases = [...inputCases].sort((left, right) => left.caseId.localeCompare(right.caseId));
  if (new Set(cases.map((item) => item.caseId)).size !== cases.length
    || cases.some((item) => !CASE_ID.test(item.caseId))) {
    throw new Error("retrieval/RAG eval case IDs must be valid and unique");
  }
  if (cases.some((item) => item.query.trim().length === 0 || item.topic.trim().length === 0)) {
    throw new Error("retrieval/RAG eval queries and topics must be non-empty");
  }
  if (cases.some((item) => item.scenario !== item.expectedStatus
    || (item.scenario === "SUCCESS") !== (item.expectedProvisionId !== null))) {
    throw new Error("retrieval/RAG eval expectations do not match their scenario");
  }

  const sourceByChunkId = new Map(context.chunks.map((chunk) => [chunk.chunkId, chunk]));
  if (sourceByChunkId.size !== context.chunks.length) {
    throw new Error("retrieval/RAG eval source chunk IDs must be unique");
  }
  const results = await Promise.all(cases.map(async (evalCase) => {
    const [response, repeatedResponse] = await Promise.all([
      context.searchCase(evalCase),
      context.searchCase(evalCase),
    ]);
    return evaluateCase(
      evalCase,
      response,
      repeatedResponse,
      context.index,
      sourceByChunkId,
    );
  }));
  const scopes = [...new Set(cases.map((evalCase) => selfServiceScopeId(evalCase.scope)))]
    .sort()
    .map((scopeId) => {
      const scopeCases = cases.filter((item) => selfServiceScopeId(item.scope) === scopeId);
      const scopeResults = results.filter((item) => item.scopeId === scopeId);
      return scopeMetrics(scopeId, scopeCases[0].scope, scopeResults);
    });
  const datasetProjection = cases.map((evalCase) => ({
    caseId: evalCase.caseId,
    scope: evalCase.scope,
    scenario: evalCase.scenario,
    inputArtifactSha256: sha256(Buffer.from(stableJson(evalCase), "utf8")),
  }));
  return {
    schemaVersion: "1.0.0",
    datasetId: `retrieval-rag-eval:${sha256(
      Buffer.from(stableJson(datasetProjection), "utf8"),
    ).slice(0, 32)}`,
    thresholds: {
      minimumCasesPerScope: 8,
      minimumSuccessCasesPerScope: 4,
      recallAt10: 0.95,
      mrrAt10: 0.9,
      citationPrecision: 1,
      structuredFilterAccuracy: 1,
      versionIsolationRate: 1,
      repeatedRunExactMatchRate: 1,
      safeDegradationRate: 1,
      nonNarrativeSafetyRate: 1,
      unauthorizedAuthorityUseCount: 0,
    },
    caseCount: cases.length,
    scopes,
    results: results.map(toReportResult),
    outcome: scopes.every((scope) => scope.retrievalRagGatePassed) ? "PASSED" : "FAILED",
    limitations: [
      "This sanitized regression report measures the two current MVP scopes and does not activate self-service.",
      "The report contains hashes and aggregate outcomes only; queries, evidence text, citations, URLs, model instructions, and customer data are not copied into it.",
      "Machine-assured fixture coverage does not imply human legal review or replace signed production smoke.",
    ],
  };
}

function toReportResult(
  result: InternalResult,
): RetrievalRagEvalReport["results"][number] {
  return {
    caseId: result.caseId,
    scopeId: result.scopeId,
    inputArtifactSha256: result.inputArtifactSha256,
    actualStatus: result.actualStatus,
    expectedStatusMatch: result.expectedStatusMatch,
    firstExpectedRank: result.firstExpectedRank,
    citationIntegrityValid: result.citationIntegrityValid,
    structuredFiltersValid: result.structuredFiltersValid,
    versionIsolationValid: result.versionIsolationValid,
    repeatedRunExactMatch: result.repeatedRunExactMatch,
    safeDegradationValid: result.safeDegradationValid,
    nonNarrativeSafe: result.nonNarrativeSafe,
    unauthorizedAuthorityUseCount: result.unauthorizedAuthorityUseCount,
    exactMatch: result.exactMatch,
  };
}

function evaluateCase(
  evalCase: RetrievalRagEvalCase,
  response: EvidenceSearchResponse,
  repeatedResponse: EvidenceSearchResponse,
  index: RetrievalIndexRelease,
  sourceByChunkId: Map<string, IndexedEvidenceChunk>,
): InternalResult {
  const expectedSuccess = evalCase.expectedStatus === "SUCCESS";
  const expectedIndex = evalCase.expectedProvisionId === null
    ? null
    : response.hits.findIndex(
      (hit) => hit.citation.provisionId === evalCase.expectedProvisionId,
    );
  const rank = expectedIndex === null || expectedIndex < 0 ? null : expectedIndex + 1;
  const hitChecks = response.hits.map((hit) => {
    const source = sourceByChunkId.get(hit.chunkId);
    const citationIntegrityValid = source !== undefined
      && source.citationId === hit.citation.citationId
      && source.provisionId === hit.citation.provisionId
      && source.locator === hit.citation.locator
      && source.sourceVersionId === hit.citation.sourceVersionId
      && source.sourceVersionChecksumSha256 === hit.citation.sourceVersionChecksumSha256;
    const structuredFiltersValid = source !== undefined
      && hit.jurisdictionCode === evalCase.scope.jurisdictionCode
      && source.topic === evalCase.topic
      && source.sourceType === "REGULATION"
      && Date.parse(source.effectiveFrom) <= Date.parse(index.asOf)
      && (source.effectiveTo === null || Date.parse(source.effectiveTo) > Date.parse(index.asOf));
    const versionIsolationValid = source !== undefined
      && source.indexReleaseId === index.indexReleaseId
      && source.corpusReleaseId === index.corpusReleaseId
      && hit.assuranceTier === index.assuranceTier;
    const unauthorized = source === undefined
      || !source.internalSearchAllowed
      || PROMPT_INJECTION.test(source.searchText)
      || !versionIsolationValid;
    return { citationIntegrityValid, structuredFiltersValid, versionIsolationValid, unauthorized };
  });
  const expectedStatusMatch = response.status === evalCase.expectedStatus;
  const citationIntegrityValid = response.hits.length > 0
    && hitChecks.every((check) => check.citationIntegrityValid);
  const structuredFiltersValid = expectedSuccess
    ? response.hits.length > 0 && hitChecks.every((check) => check.structuredFiltersValid)
    : response.hits.length === 0;
  const versionIsolationValid = response.status === "RETRIEVAL_UNAVAILABLE"
    ? response.indexRelease === null && response.hits.length === 0
    : response.indexRelease?.indexReleaseId === index.indexReleaseId
      && response.indexRelease.corpusReleaseId === index.corpusReleaseId
      && (expectedSuccess
        ? response.hits.length > 0 && hitChecks.every((check) => check.versionIsolationValid)
        : true);
  const safeDegradationValid = expectedSuccess
    ? true
    : expectedStatusMatch && response.hits.length === 0 && response.explanation === null;
  const nonNarrativeSafe = response.explanation === null;
  const repeatedRunExactMatch = stableJson(replayProjection(response))
    === stableJson(replayProjection(repeatedResponse));
  const unauthorizedAuthorityUseCount = hitChecks.filter((check) => check.unauthorized).length;
  const recalled = rank !== null && rank <= 10;
  const exactMatch = expectedStatusMatch
    && (expectedSuccess ? recalled && citationIntegrityValid : safeDegradationValid)
    && structuredFiltersValid
    && versionIsolationValid
    && repeatedRunExactMatch
    && nonNarrativeSafe
    && unauthorizedAuthorityUseCount === 0;
  return {
    caseId: evalCase.caseId,
    scopeId: selfServiceScopeId(evalCase.scope),
    inputArtifactSha256: sha256(Buffer.from(stableJson(evalCase), "utf8")),
    actualStatus: response.status,
    expectedStatusMatch,
    firstExpectedRank: rank,
    citationIntegrityValid: expectedSuccess ? citationIntegrityValid : true,
    structuredFiltersValid,
    versionIsolationValid,
    repeatedRunExactMatch,
    safeDegradationValid,
    nonNarrativeSafe,
    unauthorizedAuthorityUseCount,
    exactMatch,
    expectedSuccess,
    recalled,
    reciprocalRank: rank === null ? 0 : 1 / rank,
  };
}

function replayProjection(response: EvidenceSearchResponse): Omit<EvidenceSearchResponse, "runId"> {
  return {
    schemaVersion: response.schemaVersion,
    status: response.status,
    querySha256: response.querySha256,
    indexRelease: response.indexRelease,
    hits: response.hits,
    limitations: response.limitations,
    explanation: response.explanation,
  };
}

function scopeMetrics(
  scopeId: string,
  scope: SelfServiceScope,
  results: InternalResult[],
): RetrievalRagScopeMetrics {
  const successful = results.filter((result) => result.expectedSuccess);
  const degraded = results.filter((result) => !result.expectedSuccess);
  const rate = (items: InternalResult[], predicate: (item: InternalResult) => boolean) =>
    items.length === 0 ? 0 : items.filter(predicate).length / items.length;
  const metrics = {
    recallAt10: rate(successful, (result) => result.recalled),
    mrrAt10: successful.length === 0
      ? 0
      : successful.reduce((sum, result) => sum + result.reciprocalRank, 0) / successful.length,
    citationPrecision: rate(successful, (result) => result.citationIntegrityValid),
    structuredFilterAccuracy: rate(results, (result) => result.structuredFiltersValid),
    versionIsolationRate: rate(results, (result) => result.versionIsolationValid),
    repeatedRunExactMatchRate: rate(results, (result) => result.repeatedRunExactMatch),
    safeDegradationRate: rate(degraded, (result) => result.safeDegradationValid),
    nonNarrativeSafetyRate: rate(results, (result) => result.nonNarrativeSafe),
    unauthorizedAuthorityUseCount: results.reduce(
      (sum, result) => sum + result.unauthorizedAuthorityUseCount,
      0,
    ),
  };
  return {
    scopeId,
    jurisdictionCode: scope.jurisdictionCode,
    assetId: scope.assetId,
    playbookId: scope.playbookId,
    caseCount: results.length,
    successCaseCount: successful.length,
    ...metrics,
    retrievalRagGatePassed: results.length >= 8
      && successful.length >= 4
      && metrics.recallAt10 >= 0.95
      && metrics.mrrAt10 >= 0.9
      && metrics.citationPrecision === 1
      && metrics.structuredFilterAccuracy === 1
      && metrics.versionIsolationRate === 1
      && metrics.repeatedRunExactMatchRate === 1
      && metrics.safeDegradationRate === 1
      && metrics.nonNarrativeSafetyRate === 1
      && metrics.unauthorizedAuthorityUseCount === 0,
  };
}
