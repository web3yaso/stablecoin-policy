import { sha256, stableJson } from "../data/integrity";

const CASE_ID = /^[a-z0-9][a-z0-9._:-]{2,160}$/;
const CLAIM_ID = /^[a-z0-9][a-z0-9._:-]{2,160}$/;
const PACKAGE_ID = /^package:([a-z0-9-]+):[0-9a-f]{16}$/;
const PLAYBOOK_ID = /^[a-z0-9][a-z0-9-]{2,80}$/;
const JURISDICTION_CODE = /^[A-Z][A-Z0-9-]{1,15}$/;

export type MonitoringImpactType =
  | "MAY_AFFECT"
  | "INVALIDATES"
  | "SUPERSEDES"
  | "DEADLINE";

export type MonitoringEvalCase = {
  schemaVersion: "1.0.0";
  caseId: string;
  scope: {
    jurisdictionCode: string;
    assetId: string | null;
    playbookId: string;
  };
  severity: "CONTROL" | "MATERIAL" | "CRITICAL";
  event: {
    state: "CANDIDATE" | "REVIEWED" | "PUBLISHED";
    impacts: Array<{
      claimId: string;
      impactType: MonitoringImpactType;
      reviewState: "PENDING" | "REVIEWED" | "DISMISSED";
    }>;
  };
  watchlists: Array<{
    packageId: string;
    state: "ACTIVE" | "SUPERSEDED";
    dependencyClaimIds: string[];
  }>;
  expectedAffectedPackageIds: string[];
};

export type MonitoringEvalScopeMetrics = {
  scopeId: string;
  jurisdictionCode: string;
  assetId: string | null;
  playbookId: string;
  caseCount: number;
  knownAffectedPackageCount: number;
  recalledPackageCount: number;
  monitoringRecall: number;
  criticalMissCount: number;
  falsePositiveCount: number;
  exactCaseAccuracy: number;
  monitoringGatePassed: boolean;
};

export type MonitoringEvalReport = {
  schemaVersion: "1.0.0";
  datasetId: string;
  thresholds: {
    minimumKnownAffectedPackages: 1;
    minimumMonitoringRecall: 0.95;
    maximumCriticalMisses: 0;
    maximumFalsePositives: 0;
  };
  caseCount: number;
  knownAffectedPackageCount: number;
  recalledPackageCount: number;
  monitoringRecall: number;
  criticalMissCount: number;
  falsePositiveCount: number;
  exactCaseAccuracy: number;
  scopes: MonitoringEvalScopeMetrics[];
  results: Array<{
    caseId: string;
    scopeId: string;
    expectedAffectedPackageIds: string[];
    actualAffectedPackageIds: string[];
    missedPackageIds: string[];
    falsePositivePackageIds: string[];
    exactMatch: boolean;
  }>;
  outcome: "PASSED" | "FAILED";
  limitations: string[];
};

export function parseMonitoringEvalCase(value: unknown): MonitoringEvalCase {
  if (!isExactRecord(value, [
    "schemaVersion", "caseId", "scope", "severity", "event", "watchlists",
    "expectedAffectedPackageIds",
  ])) throw new Error("invalid monitoring eval case shape");
  if (
    value.schemaVersion !== "1.0.0"
    || typeof value.caseId !== "string"
    || !CASE_ID.test(value.caseId)
    || !isExactRecord(value.scope, ["jurisdictionCode", "assetId", "playbookId"])
    || typeof value.scope.jurisdictionCode !== "string"
    || !JURISDICTION_CODE.test(value.scope.jurisdictionCode)
    || (value.scope.assetId !== null
      && (typeof value.scope.assetId !== "string" || value.scope.assetId.length === 0))
    || typeof value.scope.playbookId !== "string"
    || !PLAYBOOK_ID.test(value.scope.playbookId)
    || !isSeverity(value.severity)
    || !isExactRecord(value.event, ["state", "impacts"])
    || !isEventState(value.event.state)
    || !Array.isArray(value.event.impacts)
    || !Array.isArray(value.watchlists)
    || !Array.isArray(value.expectedAffectedPackageIds)
  ) throw new Error("invalid monitoring eval case metadata");

  const scope = value.scope;
  const jurisdictionCode = scope.jurisdictionCode as string;
  const assetId = scope.assetId as string | null;
  const playbookId = scope.playbookId as string;
  const impacts = value.event.impacts.map(parseImpact);
  assertCanonicalUnique(impacts.map((impact) => impact.claimId), "monitoring impacts");
  const watchlists = value.watchlists.map((watchlist) =>
    parseWatchlist(watchlist, playbookId));
  assertCanonicalUnique(
    watchlists.map((watchlist) => watchlist.packageId),
    "monitoring watchlists",
  );
  const expectedAffectedPackageIds = value.expectedAffectedPackageIds.map(
    (packageId) => parsePackageId(packageId, playbookId),
  );
  assertCanonicalUnique(expectedAffectedPackageIds, "expected affected packages");
  if (
    expectedAffectedPackageIds.some((packageId) =>
      !watchlists.some((watchlist) => watchlist.packageId === packageId))
    || (value.severity === "CRITICAL" && expectedAffectedPackageIds.length === 0)
  ) throw new Error("invalid expected affected package set");

  return {
    schemaVersion: "1.0.0",
    caseId: value.caseId,
    scope: {
      jurisdictionCode,
      assetId,
      playbookId,
    },
    severity: value.severity,
    event: { state: value.event.state, impacts },
    watchlists,
    expectedAffectedPackageIds,
  };
}

export function affectedPackagesForMonitoringCase(
  evalCase: MonitoringEvalCase,
): string[] {
  if (evalCase.event.state !== "PUBLISHED") return [];
  const reviewedClaimIds = new Set(evalCase.event.impacts
    .filter((impact) => impact.reviewState === "REVIEWED")
    .map((impact) => impact.claimId));
  return evalCase.watchlists
    .filter((watchlist) =>
      watchlist.state === "ACTIVE"
      && watchlist.dependencyClaimIds.some((claimId) => reviewedClaimIds.has(claimId)))
    .map((watchlist) => watchlist.packageId)
    .sort();
}

export function runMonitoringEval(
  inputCases: MonitoringEvalCase[],
): MonitoringEvalReport {
  if (inputCases.length === 0) throw new Error("monitoring eval dataset is empty");
  const cases = inputCases.map((evalCase) => parseMonitoringEvalCase(evalCase));
  assertCanonicalUnique(cases.map((evalCase) => evalCase.caseId), "monitoring cases");

  const results = cases.map((evalCase) => {
    const actual = affectedPackagesForMonitoringCase(evalCase);
    const expected = evalCase.expectedAffectedPackageIds;
    const actualSet = new Set(actual);
    const expectedSet = new Set(expected);
    const missed = expected.filter((packageId) => !actualSet.has(packageId));
    const falsePositives = actual.filter((packageId) => !expectedSet.has(packageId));
    return {
      caseId: evalCase.caseId,
      scopeId: scopeId(evalCase),
      expectedAffectedPackageIds: expected,
      actualAffectedPackageIds: actual,
      missedPackageIds: missed,
      falsePositivePackageIds: falsePositives,
      exactMatch: missed.length === 0 && falsePositives.length === 0,
    };
  });

  const scopes = [...new Set(cases.map(scopeId))].sort().map((id) => {
    const scopeCases = cases.filter((evalCase) => scopeId(evalCase) === id);
    const scopeResults = results.filter((result) => result.scopeId === id);
    const exemplar = scopeCases[0];
    return metricsForScope(id, exemplar, scopeCases, scopeResults);
  });
  const totals = aggregateMetrics(cases, results);
  const outcome = scopes.every((scope) => scope.monitoringGatePassed)
    ? "PASSED"
    : "FAILED";
  return {
    schemaVersion: "1.0.0",
    datasetId: `monitoring-eval:${sha256(Buffer.from(stableJson(cases), "utf8")).slice(0, 32)}`,
    thresholds: {
      minimumKnownAffectedPackages: 1,
      minimumMonitoringRecall: 0.95,
      maximumCriticalMisses: 0,
      maximumFalsePositives: 0,
    },
    ...totals,
    scopes,
    results,
    outcome,
    limitations: [
      "This sanitized regression dataset measures monitoring behavior only; it does not authorize broad self-service.",
      "Production errors, newly supported scopes, and material human corrections must be added as versioned regression cases.",
      "A passing report does not replace source, retrieval, deterministic-rule, privacy, assurance, or release gates.",
    ],
  };
}

type EvalResult = MonitoringEvalReport["results"][number];

function metricsForScope(
  id: string,
  exemplar: MonitoringEvalCase,
  cases: MonitoringEvalCase[],
  results: EvalResult[],
): MonitoringEvalScopeMetrics {
  const metrics = aggregateMetrics(cases, results);
  return {
    scopeId: id,
    jurisdictionCode: exemplar.scope.jurisdictionCode,
    assetId: exemplar.scope.assetId,
    playbookId: exemplar.scope.playbookId,
    ...metrics,
    monitoringGatePassed: metrics.knownAffectedPackageCount >= 1
      && metrics.monitoringRecall >= 0.95
      && metrics.criticalMissCount === 0
      && metrics.falsePositiveCount === 0,
  };
}

function aggregateMetrics(cases: MonitoringEvalCase[], results: EvalResult[]) {
  const knownAffectedPackageCount = results.reduce(
    (total, result) => total + result.expectedAffectedPackageIds.length,
    0,
  );
  const missedPackageCount = results.reduce(
    (total, result) => total + result.missedPackageIds.length,
    0,
  );
  const recalledPackageCount = knownAffectedPackageCount - missedPackageCount;
  const criticalCaseIds = new Set(cases
    .filter((evalCase) => evalCase.severity === "CRITICAL")
    .map((evalCase) => evalCase.caseId));
  const criticalMissCount = results
    .filter((result) => criticalCaseIds.has(result.caseId))
    .reduce((total, result) => total + result.missedPackageIds.length, 0);
  const falsePositiveCount = results.reduce(
    (total, result) => total + result.falsePositivePackageIds.length,
    0,
  );
  const exactMatches = results.filter((result) => result.exactMatch).length;
  return {
    caseCount: cases.length,
    knownAffectedPackageCount,
    recalledPackageCount,
    monitoringRecall: knownAffectedPackageCount === 0
      ? 1
      : recalledPackageCount / knownAffectedPackageCount,
    criticalMissCount,
    falsePositiveCount,
    exactCaseAccuracy: exactMatches / cases.length,
  };
}

function scopeId(evalCase: MonitoringEvalCase): string {
  return [
    evalCase.scope.jurisdictionCode.toLowerCase(),
    (evalCase.scope.assetId ?? "generic").toLowerCase(),
    evalCase.scope.playbookId,
  ].join(":");
}

function parseImpact(value: unknown): MonitoringEvalCase["event"]["impacts"][number] {
  if (!isExactRecord(value, ["claimId", "impactType", "reviewState"])
    || typeof value.claimId !== "string"
    || !CLAIM_ID.test(value.claimId)
    || !isImpactType(value.impactType)
    || !isImpactReviewState(value.reviewState)) {
    throw new Error("invalid monitoring impact");
  }
  return {
    claimId: value.claimId,
    impactType: value.impactType,
    reviewState: value.reviewState,
  };
}

function parseWatchlist(
  value: unknown,
  playbookId: string,
): MonitoringEvalCase["watchlists"][number] {
  if (!isExactRecord(value, ["packageId", "state", "dependencyClaimIds"])
    || (value.state !== "ACTIVE" && value.state !== "SUPERSEDED")
    || !Array.isArray(value.dependencyClaimIds)
    || value.dependencyClaimIds.length === 0) {
    throw new Error("invalid monitoring watchlist");
  }
  const packageId = parsePackageId(value.packageId, playbookId);
  const dependencyClaimIds = value.dependencyClaimIds.map((claimId) => {
    if (typeof claimId !== "string" || !CLAIM_ID.test(claimId)) {
      throw new Error("invalid monitoring dependency claim");
    }
    return claimId;
  });
  assertCanonicalUnique(dependencyClaimIds, "monitoring dependency claims");
  return { packageId, state: value.state, dependencyClaimIds };
}

function parsePackageId(value: unknown, playbookId: string): string {
  if (typeof value !== "string" || PACKAGE_ID.exec(value)?.[1] !== playbookId) {
    throw new Error("invalid monitoring package ID");
  }
  return value;
}

function assertCanonicalUnique(values: string[], label: string): void {
  if (new Set(values).size !== values.length
    || values.some((value, index) => index > 0 && values[index - 1].localeCompare(value) >= 0)) {
    throw new Error(`${label} must be unique and canonical`);
  }
}

function isSeverity(value: unknown): value is MonitoringEvalCase["severity"] {
  return value === "CONTROL" || value === "MATERIAL" || value === "CRITICAL";
}

function isEventState(value: unknown): value is MonitoringEvalCase["event"]["state"] {
  return value === "CANDIDATE" || value === "REVIEWED" || value === "PUBLISHED";
}

function isImpactType(value: unknown): value is MonitoringImpactType {
  return value === "MAY_AFFECT" || value === "INVALIDATES"
    || value === "SUPERSEDES" || value === "DEADLINE";
}

function isImpactReviewState(
  value: unknown,
): value is MonitoringEvalCase["event"]["impacts"][number]["reviewState"] {
  return value === "PENDING" || value === "REVIEWED" || value === "DISMISSED";
}

function isExactRecord(
  value: unknown,
  expectedKeys: string[],
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}
