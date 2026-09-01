import { sha256, stableJson } from "../data/integrity";
import type { MonitoringEvalReport } from "../monitoring/eval";
import type { ContractReplayEvalReport } from "./contract-replay-eval";
import type { DeterministicRuleActionEvalReport } from "./deterministic-rule-action-eval";

export const SCOPE_READINESS_POLICY_VERSION = "1.0.0" as const;

export const REQUIRED_SCOPE_GATES = [
  "SOURCE_AND_GROUNDING",
  "RETRIEVAL_AND_RAG",
  "DETERMINISTIC_RULE_AND_ACTION",
  "PRIVACY",
  "ASSURANCE_LABEL",
  "CONTRACT_AND_REPLAY",
  "RELEASE",
  "MONITORING",
] as const;

export type ScopeGateId = typeof REQUIRED_SCOPE_GATES[number];
export type EvidenceAssuranceTier = "MACHINE_ASSURED" | "HUMAN_REVIEWED";

export type SelfServiceScope = {
  jurisdictionCode: string;
  assetId: string | null;
  playbookId: string;
};

export type ScopeGateEvidence = {
  gateId: ScopeGateId;
  scopeId: string;
  reportId: string;
  reportSchemaVersion: string;
  artifactSha256: string;
  outcome: "PASSED" | "FAILED";
  assuranceTier: EvidenceAssuranceTier;
  evaluatedAt: string;
  validUntil: string;
};

export type ScopeReadinessInput = {
  schemaVersion: "1.0.0";
  policyVersion: typeof SCOPE_READINESS_POLICY_VERSION;
  asOf: string;
  scope: SelfServiceScope;
  gateEvidence: ScopeGateEvidence[];
};

export type ScopeGateResultStatus =
  | "PASSED"
  | "FAILED"
  | "MISSING"
  | "DUPLICATE"
  | "SCOPE_MISMATCH"
  | "NOT_YET_VALID"
  | "EXPIRED";

export type ScopeGateResult = {
  gateId: ScopeGateId;
  status: ScopeGateResultStatus;
  reportId: string | null;
  reportSchemaVersion: string | null;
  artifactSha256: string | null;
  assuranceTier: EvidenceAssuranceTier | null;
  evaluatedAt: string | null;
  validUntil: string | null;
  blockerCode: string | null;
};

export type ScopeReadinessReport = {
  schemaVersion: "1.0.0";
  policyVersion: typeof SCOPE_READINESS_POLICY_VERSION;
  readinessReportId: string;
  asOf: string;
  scopeId: string;
  scope: SelfServiceScope;
  requiredGateIds: ScopeGateId[];
  gateResults: ScopeGateResult[];
  blockerCodes: string[];
  outcome: "READY" | "BLOCKED";
  readinessAssuranceTier: EvidenceAssuranceTier | null;
  activationState: "NOT_ACTIVATED";
  limitations: string[];
};

const IDENTIFIER = /^[a-z0-9][a-z0-9._:-]{2,200}$/;
const PLAYBOOK_ID = /^[a-z0-9][a-z0-9-]{2,80}$/;
const JURISDICTION_CODE = /^[A-Z][A-Z0-9-]{1,15}$/;
const ASSET_ID = /^[a-z0-9][a-z0-9._:-]{1,100}$/;
const SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const SHA256 = /^[0-9a-f]{64}$/;

export function parseScopeReadinessInput(value: unknown): ScopeReadinessInput {
  if (!isExactRecord(value, [
    "schemaVersion", "policyVersion", "asOf", "scope", "gateEvidence",
  ])) throw new Error("invalid scope readiness input shape");
  if (value.schemaVersion !== "1.0.0"
    || value.policyVersion !== SCOPE_READINESS_POLICY_VERSION
    || !Array.isArray(value.gateEvidence)) {
    throw new Error("unsupported scope readiness input version");
  }
  const scope = parseScope(value.scope);
  return {
    schemaVersion: "1.0.0",
    policyVersion: SCOPE_READINESS_POLICY_VERSION,
    asOf: parseTimestamp(value.asOf, "scope readiness asOf"),
    scope,
    gateEvidence: value.gateEvidence.map(parseGateEvidence),
  };
}

export function assessScopeReadiness(value: unknown): ScopeReadinessReport {
  const input = parseScopeReadinessInput(value);
  const expectedScopeId = selfServiceScopeId(input.scope);
  const asOf = Date.parse(input.asOf);
  const gateResults = REQUIRED_SCOPE_GATES.map((gateId) => {
    const matches = input.gateEvidence.filter((evidence) => evidence.gateId === gateId);
    if (matches.length === 0) return missingGateResult(gateId);
    if (matches.length > 1) return blockedGateResult(gateId, "DUPLICATE", null);
    const evidence = matches[0];
    if (evidence.scopeId !== expectedScopeId) {
      return blockedGateResult(gateId, "SCOPE_MISMATCH", evidence);
    }
    if (Date.parse(evidence.evaluatedAt) > asOf) {
      return blockedGateResult(gateId, "NOT_YET_VALID", evidence);
    }
    if (Date.parse(evidence.validUntil) < asOf) {
      return blockedGateResult(gateId, "EXPIRED", evidence);
    }
    if (evidence.outcome === "FAILED") {
      return blockedGateResult(gateId, "FAILED", evidence);
    }
    return {
      gateId,
      status: "PASSED" as const,
      reportId: evidence.reportId,
      reportSchemaVersion: evidence.reportSchemaVersion,
      artifactSha256: evidence.artifactSha256,
      assuranceTier: evidence.assuranceTier,
      evaluatedAt: evidence.evaluatedAt,
      validUntil: evidence.validUntil,
      blockerCode: null,
    };
  });
  const blockerCodes = gateResults.flatMap((result) =>
    result.blockerCode === null ? [] : [result.blockerCode]);
  const outcome = blockerCodes.length === 0 ? "READY" : "BLOCKED";
  const readinessAssuranceTier = outcome === "READY"
    ? gateResults.every((result) => result.assuranceTier === "HUMAN_REVIEWED")
      ? "HUMAN_REVIEWED"
      : "MACHINE_ASSURED"
    : null;
  const canonicalInput = {
    ...input,
    gateEvidence: [...input.gateEvidence].sort(compareGateEvidence),
  };
  return {
    schemaVersion: "1.0.0",
    policyVersion: SCOPE_READINESS_POLICY_VERSION,
    readinessReportId: `scope-readiness:${sha256(
      Buffer.from(stableJson(canonicalInput), "utf8"),
    )}`,
    asOf: input.asOf,
    scopeId: expectedScopeId,
    scope: input.scope,
    requiredGateIds: [...REQUIRED_SCOPE_GATES],
    gateResults,
    blockerCodes,
    outcome,
    readinessAssuranceTier,
    activationState: "NOT_ACTIVATED",
    limitations: [
      "This report measures readiness for one exact scope and never activates self-service.",
      "Production activation requires a separate explicit, versioned, and reversible scope registry.",
      "Operational rollout checks such as receiver configuration, scheduler activation, and signed production smoke remain separate blockers.",
    ],
  };
}

export function monitoringEvidenceForScope(
  report: MonitoringEvalReport,
  scope: SelfServiceScope,
  validity: { evaluatedAt: string; validUntil: string },
): ScopeGateEvidence {
  const expectedScopeId = selfServiceScopeId(parseScope(scope));
  if (report.schemaVersion !== "1.0.0") {
    throw new Error("unsupported monitoring report version");
  }
  const matchingMetrics = report.scopes.filter((candidate) =>
    candidate.scopeId === expectedScopeId
    && candidate.jurisdictionCode.toLowerCase() === scope.jurisdictionCode.toLowerCase()
    && (candidate.assetId?.toLowerCase() ?? null) === (scope.assetId?.toLowerCase() ?? null)
    && candidate.playbookId === scope.playbookId);
  if (matchingMetrics.length !== 1) {
    throw new Error("monitoring report does not contain exactly one requested scope");
  }
  const metric = matchingMetrics[0];
  const evaluatedAt = parseTimestamp(validity.evaluatedAt, "monitoring evaluatedAt");
  const validUntil = parseTimestamp(validity.validUntil, "monitoring validUntil");
  if (Date.parse(validUntil) < Date.parse(evaluatedAt)) {
    throw new Error("monitoring evidence validity ends before evaluation");
  }
  return {
    gateId: "MONITORING",
    scopeId: expectedScopeId,
    reportId: report.datasetId,
    reportSchemaVersion: report.schemaVersion,
    artifactSha256: sha256(Buffer.from(stableJson(report), "utf8")),
    outcome: metric.monitoringGatePassed ? "PASSED" : "FAILED",
    assuranceTier: "MACHINE_ASSURED",
    evaluatedAt,
    validUntil,
  };
}

export function contractReplayEvidenceForScope(
  report: ContractReplayEvalReport,
  scope: SelfServiceScope,
  validity: { evaluatedAt: string; validUntil: string },
): ScopeGateEvidence {
  if (report.schemaVersion !== "1.0.0") {
    throw new Error("unsupported contract replay report version");
  }
  const expectedScopeId = selfServiceScopeId(parseScope(scope));
  const matchingMetrics = report.scopes.filter((candidate) =>
    candidate.scopeId === expectedScopeId
    && candidate.jurisdictionCode.toLowerCase() === scope.jurisdictionCode.toLowerCase()
    && (candidate.assetId?.toLowerCase() ?? null) === (scope.assetId?.toLowerCase() ?? null)
    && candidate.playbookId === scope.playbookId);
  if (matchingMetrics.length !== 1) {
    throw new Error("contract replay report does not contain exactly one requested scope");
  }
  const evaluatedAt = parseTimestamp(validity.evaluatedAt, "contract replay evaluatedAt");
  const validUntil = parseTimestamp(validity.validUntil, "contract replay validUntil");
  if (Date.parse(validUntil) < Date.parse(evaluatedAt)) {
    throw new Error("contract replay evidence validity ends before evaluation");
  }
  return {
    gateId: "CONTRACT_AND_REPLAY",
    scopeId: expectedScopeId,
    reportId: report.datasetId,
    reportSchemaVersion: report.schemaVersion,
    artifactSha256: sha256(Buffer.from(stableJson(report), "utf8")),
    outcome: matchingMetrics[0].contractReplayGatePassed ? "PASSED" : "FAILED",
    assuranceTier: "MACHINE_ASSURED",
    evaluatedAt,
    validUntil,
  };
}

export function deterministicRuleActionEvidenceForScope(
  report: DeterministicRuleActionEvalReport,
  scope: SelfServiceScope,
  validity: { evaluatedAt: string; validUntil: string },
): ScopeGateEvidence {
  if (report.schemaVersion !== "1.0.0") {
    throw new Error("unsupported deterministic rule/action report version");
  }
  const expectedScopeId = selfServiceScopeId(parseScope(scope));
  const matchingMetrics = report.scopes.filter((candidate) =>
    candidate.scopeId === expectedScopeId
    && candidate.jurisdictionCode.toLowerCase() === scope.jurisdictionCode.toLowerCase()
    && (candidate.assetId?.toLowerCase() ?? null) === (scope.assetId?.toLowerCase() ?? null)
    && candidate.playbookId === scope.playbookId);
  if (matchingMetrics.length !== 1) {
    throw new Error("deterministic rule/action report does not contain exactly one requested scope");
  }
  const evaluatedAt = parseTimestamp(validity.evaluatedAt, "deterministic rule/action evaluatedAt");
  const validUntil = parseTimestamp(validity.validUntil, "deterministic rule/action validUntil");
  if (Date.parse(validUntil) < Date.parse(evaluatedAt)) {
    throw new Error("deterministic rule/action evidence validity ends before evaluation");
  }
  return {
    gateId: "DETERMINISTIC_RULE_AND_ACTION",
    scopeId: expectedScopeId,
    reportId: report.datasetId,
    reportSchemaVersion: report.schemaVersion,
    artifactSha256: sha256(Buffer.from(stableJson(report), "utf8")),
    outcome: matchingMetrics[0].deterministicRuleActionGatePassed ? "PASSED" : "FAILED",
    assuranceTier: "MACHINE_ASSURED",
    evaluatedAt,
    validUntil,
  };
}

export function selfServiceScopeId(scope: SelfServiceScope): string {
  const parsed = parseScope(scope);
  return [
    parsed.jurisdictionCode.toLowerCase(),
    (parsed.assetId ?? "generic").toLowerCase(),
    parsed.playbookId,
  ].join(":");
}

function parseScope(value: unknown): SelfServiceScope {
  if (!isExactRecord(value, ["jurisdictionCode", "assetId", "playbookId"])
    || typeof value.jurisdictionCode !== "string"
    || !JURISDICTION_CODE.test(value.jurisdictionCode)
    || (value.assetId !== null
      && (typeof value.assetId !== "string" || !ASSET_ID.test(value.assetId)))
    || typeof value.playbookId !== "string"
    || !PLAYBOOK_ID.test(value.playbookId)) {
    throw new Error("invalid self-service scope");
  }
  return {
    jurisdictionCode: value.jurisdictionCode,
    assetId: value.assetId,
    playbookId: value.playbookId,
  };
}

function parseGateEvidence(value: unknown): ScopeGateEvidence {
  if (!isExactRecord(value, [
    "gateId", "scopeId", "reportId", "reportSchemaVersion", "artifactSha256",
    "outcome", "assuranceTier", "evaluatedAt", "validUntil",
  ])
    || !isScopeGateId(value.gateId)
    || typeof value.scopeId !== "string" || !IDENTIFIER.test(value.scopeId)
    || typeof value.reportId !== "string" || !IDENTIFIER.test(value.reportId)
    || typeof value.reportSchemaVersion !== "string" || !SEMVER.test(value.reportSchemaVersion)
    || typeof value.artifactSha256 !== "string" || !SHA256.test(value.artifactSha256)
    || (value.outcome !== "PASSED" && value.outcome !== "FAILED")
    || (value.assuranceTier !== "MACHINE_ASSURED"
      && value.assuranceTier !== "HUMAN_REVIEWED")) {
    throw new Error("invalid scope gate evidence");
  }
  const evaluatedAt = parseTimestamp(value.evaluatedAt, "gate evaluatedAt");
  const validUntil = parseTimestamp(value.validUntil, "gate validUntil");
  if (Date.parse(validUntil) < Date.parse(evaluatedAt)) {
    throw new Error("scope gate evidence validity ends before evaluation");
  }
  return {
    gateId: value.gateId,
    scopeId: value.scopeId,
    reportId: value.reportId,
    reportSchemaVersion: value.reportSchemaVersion,
    artifactSha256: value.artifactSha256,
    outcome: value.outcome,
    assuranceTier: value.assuranceTier,
    evaluatedAt,
    validUntil,
  };
}

function missingGateResult(gateId: ScopeGateId): ScopeGateResult {
  return {
    gateId,
    status: "MISSING",
    reportId: null,
    reportSchemaVersion: null,
    artifactSha256: null,
    assuranceTier: null,
    evaluatedAt: null,
    validUntil: null,
    blockerCode: `SCOPE_GATE_MISSING:${gateId}`,
  };
}

function blockedGateResult(
  gateId: ScopeGateId,
  status: Exclude<ScopeGateResultStatus, "PASSED" | "MISSING">,
  evidence: ScopeGateEvidence | null,
): ScopeGateResult {
  return {
    gateId,
    status,
    reportId: evidence?.reportId ?? null,
    reportSchemaVersion: evidence?.reportSchemaVersion ?? null,
    artifactSha256: evidence?.artifactSha256 ?? null,
    assuranceTier: evidence?.assuranceTier ?? null,
    evaluatedAt: evidence?.evaluatedAt ?? null,
    validUntil: evidence?.validUntil ?? null,
    blockerCode: `SCOPE_GATE_${status}:${gateId}`,
  };
}

function compareGateEvidence(left: ScopeGateEvidence, right: ScopeGateEvidence): number {
  return left.gateId.localeCompare(right.gateId)
    || left.reportId.localeCompare(right.reportId)
    || left.artifactSha256.localeCompare(right.artifactSha256)
    || stableJson(left).localeCompare(stableJson(right));
}

function parseTimestamp(value: unknown, field: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${field} must be a valid timestamp`);
  }
  return new Date(value).toISOString();
}

function isScopeGateId(value: unknown): value is ScopeGateId {
  return typeof value === "string"
    && (REQUIRED_SCOPE_GATES as readonly string[]).includes(value);
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
