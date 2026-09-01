import { sha256, stableJson } from "../data/integrity";
import type { PlaybookPackage } from "./contracts";
import { verifyPlaybookPackageIntegrity } from "./runtime";
import {
  selfServiceScopeId,
  type SelfServiceScope,
} from "./scope-readiness";

const CASE_ID = /^[a-z0-9][a-z0-9._:-]{2,160}$/;

export type ContractReplayEvalCase = {
  caseId: string;
  scope: SelfServiceScope;
  committedRequestJson: string;
  committedResponseJson: string;
  replayedRequestJson: string;
  replayedResponseJson: string;
};

export type ContractReplayValidators = {
  request: (value: unknown) => boolean;
  response: (value: unknown) => boolean;
};

export type ContractReplayScopeMetrics = {
  scopeId: string;
  jurisdictionCode: string;
  assetId: string | null;
  playbookId: string;
  caseCount: number;
  requestContractPassRate: number;
  responseContractPassRate: number;
  replayExactMatchRate: number;
  packageIntegrityPassRate: number;
  referentialIntegrityPassRate: number;
  contractReplayGatePassed: boolean;
};

export type ContractReplayEvalReport = {
  schemaVersion: "1.0.0";
  datasetId: string;
  thresholds: {
    minimumCasesPerScope: 1;
    requestContractPassRate: 1;
    responseContractPassRate: 1;
    replayExactMatchRate: 1;
    packageIntegrityPassRate: 1;
    referentialIntegrityPassRate: 1;
  };
  caseCount: number;
  scopes: ContractReplayScopeMetrics[];
  results: Array<{
    caseId: string;
    scopeId: string;
    requestArtifactSha256: string;
    responseArtifactSha256: string;
    requestContractValid: boolean;
    responseContractValid: boolean;
    replayExactMatch: boolean;
    packageIntegrityValid: boolean;
    referentialIntegrityValid: boolean;
    exactMatch: boolean;
  }>;
  outcome: "PASSED" | "FAILED";
  limitations: string[];
};

export function runContractReplayEval(
  inputCases: ContractReplayEvalCase[],
  validators: ContractReplayValidators,
): ContractReplayEvalReport {
  if (inputCases.length === 0) throw new Error("contract replay eval dataset is empty");
  const cases = [...inputCases].sort((left, right) => left.caseId.localeCompare(right.caseId));
  if (new Set(cases.map((item) => item.caseId)).size !== cases.length
    || cases.some((item) => !CASE_ID.test(item.caseId))) {
    throw new Error("contract replay eval case IDs must be valid and unique");
  }

  const results = cases.map((evalCase) => evaluateCase(evalCase, validators));
  const scopes = [...new Set(cases.map((evalCase) => selfServiceScopeId(evalCase.scope)))]
    .sort()
    .map((scopeId) => {
      const scopeCases = cases.filter((item) => selfServiceScopeId(item.scope) === scopeId);
      const scopeResults = results.filter((item) => item.scopeId === scopeId);
      const exemplar = scopeCases[0].scope;
      return scopeMetrics(scopeId, exemplar, scopeResults);
    });

  const datasetProjection = cases.map((evalCase) => ({
    caseId: evalCase.caseId,
    scope: evalCase.scope,
    committedRequestSha256: hashText(evalCase.committedRequestJson),
    committedResponseSha256: hashText(evalCase.committedResponseJson),
    replayedRequestSha256: hashText(evalCase.replayedRequestJson),
    replayedResponseSha256: hashText(evalCase.replayedResponseJson),
  }));
  return {
    schemaVersion: "1.0.0",
    datasetId: `contract-replay-eval:${sha256(
      Buffer.from(stableJson(datasetProjection), "utf8"),
    ).slice(0, 32)}`,
    thresholds: {
      minimumCasesPerScope: 1,
      requestContractPassRate: 1,
      responseContractPassRate: 1,
      replayExactMatchRate: 1,
      packageIntegrityPassRate: 1,
      referentialIntegrityPassRate: 1,
    },
    caseCount: cases.length,
    scopes,
    results,
    outcome: scopes.every((scope) => scope.contractReplayGatePassed)
      ? "PASSED"
      : "FAILED",
    limitations: [
      "This sanitized regression report covers committed Citely consumer fixtures; production signed smoke remains a separate release checkpoint.",
      "The report contains artifact hashes and aggregate outcomes only; request profiles and package bodies are not copied into it.",
      "Passing this gate does not activate a self-service scope.",
    ],
  };
}

function evaluateCase(
  evalCase: ContractReplayEvalCase,
  validators: ContractReplayValidators,
): ContractReplayEvalReport["results"][number] {
  const scopeId = selfServiceScopeId(evalCase.scope);
  const committedRequest = parseJson(evalCase.committedRequestJson);
  const committedResponse = parseJson(evalCase.committedResponseJson);
  const requestContractValid = committedRequest.ok
    && safeValidate(validators.request, committedRequest.value);
  const responseContractValid = committedResponse.ok
    && safeValidate(validators.response, committedResponse.value);
  const replayExactMatch = evalCase.committedRequestJson === evalCase.replayedRequestJson
    && evalCase.committedResponseJson === evalCase.replayedResponseJson;
  const packageIntegrityValid = committedResponse.ok
    && validPackageIntegrity(committedResponse.value);
  const referentialIntegrityValid = committedRequest.ok && committedResponse.ok
    && validReferences(evalCase.scope, committedRequest.value, committedResponse.value);
  const exactMatch = requestContractValid && responseContractValid
    && replayExactMatch && packageIntegrityValid && referentialIntegrityValid;
  return {
    caseId: evalCase.caseId,
    scopeId,
    requestArtifactSha256: hashText(evalCase.committedRequestJson),
    responseArtifactSha256: hashText(evalCase.committedResponseJson),
    requestContractValid,
    responseContractValid,
    replayExactMatch,
    packageIntegrityValid,
    referentialIntegrityValid,
    exactMatch,
  };
}

function scopeMetrics(
  scopeId: string,
  scope: SelfServiceScope,
  results: ContractReplayEvalReport["results"],
): ContractReplayScopeMetrics {
  const caseCount = results.length;
  const rate = (key: keyof Pick<
    ContractReplayEvalReport["results"][number],
    | "requestContractValid"
    | "responseContractValid"
    | "replayExactMatch"
    | "packageIntegrityValid"
    | "referentialIntegrityValid"
  >) => results.filter((result) => result[key]).length / caseCount;
  const metrics = {
    requestContractPassRate: rate("requestContractValid"),
    responseContractPassRate: rate("responseContractValid"),
    replayExactMatchRate: rate("replayExactMatch"),
    packageIntegrityPassRate: rate("packageIntegrityValid"),
    referentialIntegrityPassRate: rate("referentialIntegrityValid"),
  };
  return {
    scopeId,
    jurisdictionCode: scope.jurisdictionCode,
    assetId: scope.assetId,
    playbookId: scope.playbookId,
    caseCount,
    ...metrics,
    contractReplayGatePassed: caseCount >= 1
      && Object.values(metrics).every((value) => value === 1),
  };
}

function validReferences(
  scope: SelfServiceScope,
  requestValue: unknown,
  responseValue: unknown,
): boolean {
  if (!isRecord(requestValue) || !isRecord(requestValue.profile)
    || !isRecord(responseValue) || !isRecord(responseValue.package)
    || !isRecord(responseValue.evidenceBundle)
    || !Array.isArray(responseValue.package.conclusions)
    || !Array.isArray(responseValue.evidenceBundle.claims)) return false;
  const requestAsset = requestValue.profile.asset;
  const requestAssetId = requestAsset === null
    ? null
    : isRecord(requestAsset) && typeof requestAsset.symbol === "string"
      ? requestAsset.symbol.toLowerCase()
      : undefined;
  const bundleClaimIds = responseValue.evidenceBundle.claims.map((claim) =>
    isRecord(claim) && typeof claim.claimId === "string" ? claim.claimId : null);
  if (bundleClaimIds.some((claimId) => claimId === null)
    || new Set(bundleClaimIds).size !== bundleClaimIds.length) return false;
  const referencedClaimsResolve = responseValue.package.conclusions.every((conclusion) =>
    isRecord(conclusion) && Array.isArray(conclusion.evidenceClaimIds)
    && conclusion.evidenceClaimIds.every((claimId) =>
      typeof claimId === "string" && bundleClaimIds.includes(claimId)));
  const expectedProfileFingerprint = sha256(Buffer.from(
    stableJson(requestValue.profile), "utf8",
  ));
  return requestValue.playbookId === scope.playbookId
    && requestValue.profile.targetJurisdiction === scope.jurisdictionCode
    && requestAssetId === scope.assetId
    && responseValue.package.playbookId === scope.playbookId
    && typeof responseValue.package.packageId === "string"
    && responseValue.evidenceBundle.packageId === responseValue.package.packageId
    && responseValue.package.profileFingerprint === expectedProfileFingerprint
    && referencedClaimsResolve;
}

function validPackageIntegrity(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.package)) return false;
  try {
    return verifyPlaybookPackageIntegrity(value.package as PlaybookPackage);
  } catch {
    return false;
  }
}

function safeValidate(validator: (value: unknown) => boolean, value: unknown): boolean {
  try {
    return validator(value);
  } catch {
    return false;
  }
}

function parseJson(body: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(body) as unknown };
  } catch {
    return { ok: false };
  }
}

function hashText(value: string): string {
  return sha256(Buffer.from(value, "utf8"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
