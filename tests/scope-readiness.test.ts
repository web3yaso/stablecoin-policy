import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import {
  assessScopeReadiness,
  contractReplayEvidenceForScope,
  deterministicRuleActionEvidenceForScope,
  monitoringEvidenceForScope,
  parseScopeReadinessInput,
  REQUIRED_SCOPE_GATES,
  retrievalRagEvidenceForScope,
  selfServiceScopeId,
  type ScopeGateEvidence,
  type ScopeReadinessInput,
  type SelfServiceScope,
} from "../lib/playbooks/scope-readiness";
import {
  parseMonitoringEvalCase,
  runMonitoringEval,
  type MonitoringEvalCase,
} from "../lib/monitoring/eval";
import { buildContractReplayEvalReport } from "../scripts/evals/run-phase5-contract-replay";
import { buildDeterministicRuleActionEvalReport } from "../scripts/evals/run-phase5-deterministic";
import { buildRetrievalRagEvalReport } from "../scripts/evals/run-phase5-retrieval-rag";

const AS_OF = "2026-08-25T12:00:00.000Z";
const SCOPE: SelfServiceScope = {
  jurisdictionCode: "EEA",
  assetId: "usdc",
  playbookId: "stablecoin-pre-listing",
};

test("scope readiness requires every current gate for the exact scope", () => {
  const input = passingInput();
  const report = assessScopeReadiness(input);

  assert.equal(report.scopeId, "eea:usdc:stablecoin-pre-listing");
  assert.deepEqual(report.requiredGateIds, REQUIRED_SCOPE_GATES);
  assert.equal(report.gateResults.length, REQUIRED_SCOPE_GATES.length);
  assert.equal(report.gateResults.every((result) => result.status === "PASSED"), true);
  assert.equal(report.gateResults.every((result) => result.reportSchemaVersion === "1.0.0"), true);
  assert.equal(report.gateResults.every((result) => /^[0-9a-f]{64}$/.test(
    result.artifactSha256 ?? "",
  )), true);
  assert.deepEqual(report.blockerCodes, []);
  assert.equal(report.outcome, "READY");
  assert.equal(report.readinessAssuranceTier, "MACHINE_ASSURED");
  assert.equal(report.activationState, "NOT_ACTIVATED");
});

test("all-human evidence may advertise human readiness without activating the scope", () => {
  const input = passingInput();
  input.gateEvidence = input.gateEvidence.map((evidence) => ({
    ...evidence,
    assuranceTier: "HUMAN_REVIEWED",
  }));

  const report = assessScopeReadiness(input);
  assert.equal(report.outcome, "READY");
  assert.equal(report.readinessAssuranceTier, "HUMAN_REVIEWED");
  assert.equal(report.activationState, "NOT_ACTIVATED");
});

test("missing, failed, duplicate, cross-scope, future, and expired gates fail closed", () => {
  const missing = passingInput();
  missing.gateEvidence = missing.gateEvidence.filter(
    (evidence) => evidence.gateId !== "PRIVACY",
  );
  assertGateBlock(missing, "PRIVACY", "MISSING");

  const failed = passingInput();
  failed.gateEvidence = failed.gateEvidence.map((evidence) =>
    evidence.gateId === "ASSURANCE_LABEL" ? { ...evidence, outcome: "FAILED" } : evidence);
  assertGateBlock(failed, "ASSURANCE_LABEL", "FAILED");

  const duplicate = passingInput();
  duplicate.gateEvidence.push({ ...duplicate.gateEvidence[0], reportId: "report:duplicate" });
  assertGateBlock(duplicate, "SOURCE_AND_GROUNDING", "DUPLICATE");

  const crossScope = passingInput();
  crossScope.gateEvidence = crossScope.gateEvidence.map((evidence) =>
    evidence.gateId === "RELEASE" ? { ...evidence, scopeId: "sg:usdc:stablecoin-pre-listing" } : evidence);
  assertGateBlock(crossScope, "RELEASE", "SCOPE_MISMATCH");

  const future = passingInput();
  future.gateEvidence = future.gateEvidence.map((evidence) =>
    evidence.gateId === "CONTRACT_AND_REPLAY"
      ? { ...evidence, evaluatedAt: "2026-08-26T00:00:00.000Z", validUntil: "2026-09-26T00:00:00.000Z" }
      : evidence);
  assertGateBlock(future, "CONTRACT_AND_REPLAY", "NOT_YET_VALID");

  const expired = passingInput();
  expired.gateEvidence = expired.gateEvidence.map((evidence) =>
    evidence.gateId === "RETRIEVAL_AND_RAG"
      ? { ...evidence, evaluatedAt: "2026-07-01T00:00:00.000Z", validUntil: "2026-08-24T23:59:59.000Z" }
      : evidence);
  assertGateBlock(expired, "RETRIEVAL_AND_RAG", "EXPIRED");
});

test("an empty evidence set exposes every missing blocker and cannot pass vacuously", () => {
  const input = passingInput();
  input.gateEvidence = [];
  const report = assessScopeReadiness(input);

  assert.equal(report.outcome, "BLOCKED");
  assert.equal(report.readinessAssuranceTier, null);
  assert.equal(report.blockerCodes.length, REQUIRED_SCOPE_GATES.length);
  assert.equal(report.gateResults.every((result) => result.status === "MISSING"), true);
});

test("readiness identity is deterministic and independent of evidence ordering", () => {
  const input = passingInput();
  const reordered = structuredClone(input);
  reordered.gateEvidence.reverse();

  assert.equal(
    assessScopeReadiness(input).readinessReportId,
    assessScopeReadiness(reordered).readinessReportId,
  );
  assert.equal(selfServiceScopeId(SCOPE), "eea:usdc:stablecoin-pre-listing");
});

test("strict parsing rejects expansion, private profile fields, and invalid evidence", () => {
  const input = passingInput();
  assert.throws(
    () => parseScopeReadinessInput({ ...input, businessProfile: { customerId: "private" } }),
    /input shape/,
  );
  assert.throws(
    () => parseScopeReadinessInput({
      ...input,
      gateEvidence: [{ ...input.gateEvidence[0], rawRules: ["private"] }],
    }),
    /gate evidence/,
  );
  assert.throws(
    () => parseScopeReadinessInput({
      ...input,
      gateEvidence: [{ ...input.gateEvidence[0], artifactSha256: "not-a-hash" }],
    }),
    /gate evidence/,
  );
  assert.throws(
    () => parseScopeReadinessInput({
      ...input,
      gateEvidence: [{
        ...input.gateEvidence[0],
        evaluatedAt: "2026-08-26T00:00:00.000Z",
        validUntil: "2026-08-25T00:00:00.000Z",
      }],
    }),
    /validity ends before evaluation/,
  );
});

test("monitoring evidence is derived from the exact monitoring report scope", async () => {
  const monitoringReport = runMonitoringEval(await loadMonitoringCases());
  const evidence = monitoringEvidenceForScope(monitoringReport, SCOPE, {
    evaluatedAt: "2026-08-24T12:00:00.000Z",
    validUntil: "2026-09-24T12:00:00.000Z",
  });

  assert.equal(evidence.gateId, "MONITORING");
  assert.equal(evidence.scopeId, "eea:usdc:stablecoin-pre-listing");
  assert.equal(evidence.reportId, monitoringReport.datasetId);
  assert.equal(evidence.outcome, "PASSED");
  assert.match(evidence.artifactSha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(
    evidence,
    monitoringEvidenceForScope(monitoringReport, SCOPE, {
      evaluatedAt: "2026-08-24T12:00:00.000Z",
      validUntil: "2026-09-24T12:00:00.000Z",
    }),
  );
  assert.throws(
    () => monitoringEvidenceForScope(
      monitoringReport,
      { ...SCOPE, jurisdictionCode: "SG" },
      { evaluatedAt: AS_OF, validUntil: "2026-09-25T12:00:00.000Z" },
    ),
    /does not contain exactly one/,
  );

  const otherScopeFailed = structuredClone(monitoringReport);
  const otherScope = otherScopeFailed.scopes.find((candidate) =>
    candidate.scopeId !== "eea:usdc:stablecoin-pre-listing");
  assert.ok(otherScope);
  otherScope.monitoringGatePassed = false;
  otherScopeFailed.outcome = "FAILED";
  assert.equal(
    monitoringEvidenceForScope(otherScopeFailed, SCOPE, {
      evaluatedAt: "2026-08-24T12:00:00.000Z",
      validUntil: "2026-09-24T12:00:00.000Z",
    }).outcome,
    "PASSED",
  );
});

test("contract and replay evidence is derived from the exact fixture report scope", async () => {
  const contractReport = await buildContractReplayEvalReport();
  const evidence = contractReplayEvidenceForScope(contractReport, SCOPE, {
    evaluatedAt: "2026-08-28T12:00:00.000Z",
    validUntil: "2026-09-28T12:00:00.000Z",
  });

  assert.equal(evidence.gateId, "CONTRACT_AND_REPLAY");
  assert.equal(evidence.scopeId, "eea:usdc:stablecoin-pre-listing");
  assert.equal(evidence.reportId, contractReport.datasetId);
  assert.equal(evidence.outcome, "PASSED");
  assert.match(evidence.artifactSha256, /^[0-9a-f]{64}$/);
  assert.throws(
    () => contractReplayEvidenceForScope(
      contractReport,
      { ...SCOPE, assetId: "usdt" },
      {
        evaluatedAt: "2026-08-28T12:00:00.000Z",
        validUntil: "2026-09-28T12:00:00.000Z",
      },
    ),
    /does not contain exactly one/,
  );
});

test("deterministic rule/action evidence is derived from the exact eval scope", async () => {
  const evalReport = await buildDeterministicRuleActionEvalReport();
  const evidence = deterministicRuleActionEvidenceForScope(evalReport, SCOPE, {
    evaluatedAt: "2026-08-31T12:00:00.000Z",
    validUntil: "2026-09-30T12:00:00.000Z",
  });

  assert.equal(evidence.gateId, "DETERMINISTIC_RULE_AND_ACTION");
  assert.equal(evidence.scopeId, "eea:usdc:stablecoin-pre-listing");
  assert.equal(evidence.reportId, evalReport.datasetId);
  assert.equal(evidence.outcome, "PASSED");
  assert.match(evidence.artifactSha256, /^[0-9a-f]{64}$/);
  assert.throws(
    () => deterministicRuleActionEvidenceForScope(
      evalReport,
      { ...SCOPE, assetId: "usdt" },
      {
        evaluatedAt: "2026-08-31T12:00:00.000Z",
        validUntil: "2026-09-30T12:00:00.000Z",
      },
    ),
    /does not contain exactly one/,
  );

  const failedScope = structuredClone(evalReport);
  const scope = failedScope.scopes.find((candidate) =>
    candidate.scopeId === "eea:usdc:stablecoin-pre-listing");
  assert.ok(scope);
  scope.deterministicRuleActionGatePassed = false;
  assert.equal(
    deterministicRuleActionEvidenceForScope(failedScope, SCOPE, {
      evaluatedAt: "2026-08-31T12:00:00.000Z",
      validUntil: "2026-09-30T12:00:00.000Z",
    }).outcome,
    "FAILED",
  );
});

test("retrieval/RAG evidence is derived from the exact eval scope", async () => {
  const evalReport = await buildRetrievalRagEvalReport();
  const evidence = retrievalRagEvidenceForScope(evalReport, SCOPE, {
    evaluatedAt: "2026-09-03T12:00:00.000Z",
    validUntil: "2026-10-03T12:00:00.000Z",
  });

  assert.equal(evidence.gateId, "RETRIEVAL_AND_RAG");
  assert.equal(evidence.scopeId, "eea:usdc:stablecoin-pre-listing");
  assert.equal(evidence.reportId, evalReport.datasetId);
  assert.equal(evidence.outcome, "PASSED");
  assert.match(evidence.artifactSha256, /^[0-9a-f]{64}$/);
  assert.throws(
    () => retrievalRagEvidenceForScope(
      evalReport,
      { ...SCOPE, assetId: "usdt" },
      {
        evaluatedAt: "2026-09-03T12:00:00.000Z",
        validUntil: "2026-10-03T12:00:00.000Z",
      },
    ),
    /does not contain exactly one/,
  );

  const failedScope = structuredClone(evalReport);
  const scope = failedScope.scopes.find((candidate) =>
    candidate.scopeId === "eea:usdc:stablecoin-pre-listing");
  assert.ok(scope);
  scope.retrievalRagGatePassed = false;
  assert.equal(
    retrievalRagEvidenceForScope(failedScope, SCOPE, {
      evaluatedAt: "2026-09-03T12:00:00.000Z",
      validUntil: "2026-10-03T12:00:00.000Z",
    }).outcome,
    "FAILED",
  );
});

test("readiness input and report satisfy strict versioned schemas", async () => {
  const inputSchema = JSON.parse(await readFile(
    path.join(process.cwd(), "contracts/v1/self-service-scope-readiness-input.schema.json"),
    "utf8",
  )) as object;
  const reportSchema = JSON.parse(await readFile(
    path.join(process.cwd(), "contracts/v1/self-service-scope-readiness-report.schema.json"),
    "utf8",
  )) as object;
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  ajv.addSchema(inputSchema);
  const validateInput = ajv.getSchema(
    "https://policy.citely.info/contracts/v1/self-service-scope-readiness-input.schema.json",
  );
  const validateReport = ajv.compile(reportSchema);
  assert.ok(validateInput);

  const input = passingInput();
  const report = assessScopeReadiness(input);
  assert.equal(validateInput(input), true, JSON.stringify(validateInput.errors));
  assert.equal(validateReport(report), true, JSON.stringify(validateReport.errors));
  assert.equal(validateReport({ ...report, activationAuthorized: true }), false);
});

function passingInput(): ScopeReadinessInput {
  const scopeId = selfServiceScopeId(SCOPE);
  return {
    schemaVersion: "1.0.0",
    policyVersion: "1.0.0",
    asOf: AS_OF,
    scope: structuredClone(SCOPE),
    gateEvidence: REQUIRED_SCOPE_GATES.map((gateId, index): ScopeGateEvidence => ({
      gateId,
      scopeId,
      reportId: `report:scope-gate-${index}`,
      reportSchemaVersion: "1.0.0",
      artifactSha256: index.toString(16).padStart(64, "0"),
      outcome: "PASSED",
      assuranceTier: index === 0 ? "MACHINE_ASSURED" : "HUMAN_REVIEWED",
      evaluatedAt: "2026-08-24T12:00:00.000Z",
      validUntil: "2026-09-24T12:00:00.000Z",
    })),
  };
}

function assertGateBlock(
  input: ScopeReadinessInput,
  gateId: ScopeGateEvidence["gateId"],
  status: string,
): void {
  const report = assessScopeReadiness(input);
  assert.equal(report.outcome, "BLOCKED");
  assert.equal(report.readinessAssuranceTier, null);
  const gate = report.gateResults.find((candidate) => candidate.gateId === gateId);
  assert.equal(gate?.status, status);
  assert.equal(gate?.blockerCode, `SCOPE_GATE_${status}:${gateId}`);
}

async function loadMonitoringCases(): Promise<MonitoringEvalCase[]> {
  return (await readFile(
    path.join(process.cwd(), "evals/monitoring-events.jsonl"),
    "utf8",
  )).split("\n").filter(Boolean).map((line) =>
    parseMonitoringEvalCase(JSON.parse(line) as unknown));
}
