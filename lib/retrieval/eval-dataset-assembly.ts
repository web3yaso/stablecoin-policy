import { replayChecksum } from "../legal-corpus/machine-pipeline";
import type { ProductionEvalDataset } from "./production-eval";

export type EvalAgentProvenance = {
  agentId: string;
  model: string;
  promptTemplateId: string;
  promptTemplateVersion: string;
  parametersVersion: string;
};

export type ProductionEvalProposal = {
  schemaVersion: "1.0.0";
  proposalId: string;
  snapshotId: string;
  snapshotManifestSha256: string;
  generator: EvalAgentProvenance;
  requiredChecklistTopics: string[];
  cases: Array<{
    caseId: string;
    checklistTopic: string;
    query: string;
    expectedProvisionIds: string[];
  }>;
};

export type ProductionEvalIndependentCheck = {
  schemaVersion: "1.0.0";
  checkId: string;
  proposalSha256: string;
  snapshotId: string;
  snapshotManifestSha256: string;
  checker: EvalAgentProvenance;
  cases: Array<{
    caseId: string;
    outcome: "AGREE" | "BLOCK";
    independentlyDerivedProvisionIds: string[];
    blockers: string[];
  }>;
};

export type ProductionEvalDatasetAssembly = {
  dataset: ProductionEvalDataset;
  datasetSha256: string;
  proposalSha256: string;
  independentCheckSha256: string;
  acceptedCaseCount: number;
  blockedCaseCount: number;
};

const ID = /^[a-z0-9][a-z0-9._:-]{2,200}$/;
const SHA256 = /^[0-9a-f]{64}$/;

export function assembleProductionEvalDataset(
  proposal: ProductionEvalProposal,
  independentCheck: ProductionEvalIndependentCheck,
): ProductionEvalDatasetAssembly {
  validateProposal(proposal);
  validateIndependentCheck(independentCheck);
  const proposalSha256 = replayChecksum(proposal);
  const independentCheckSha256 = replayChecksum(independentCheck);
  if (independentCheck.proposalSha256 !== proposalSha256) {
    throw new Error("independent check is not pinned to the exact proposal");
  }
  if (independentCheck.snapshotId !== proposal.snapshotId
    || independentCheck.snapshotManifestSha256 !== proposal.snapshotManifestSha256) {
    throw new Error("independent check snapshot does not match the proposal");
  }
  if (independentCheck.checker.agentId === proposal.generator.agentId) {
    throw new Error("eval generator and independent checker must be different agents");
  }
  const proposalIds = proposal.cases.map((item) => item.caseId).sort();
  const checkIds = independentCheck.cases.map((item) => item.caseId).sort();
  if (JSON.stringify(proposalIds) !== JSON.stringify(checkIds)) {
    throw new Error("independent check must cover every proposed case exactly once");
  }
  const checks = new Map(independentCheck.cases.map((item) => [item.caseId, item]));
  const accepted = proposal.cases.filter((item) => {
    const check = checks.get(item.caseId) as ProductionEvalIndependentCheck["cases"][number];
    if (check.outcome === "BLOCK") {
      if (check.blockers.length === 0) {
        throw new Error(`blocked eval case ${item.caseId} requires a blocker`);
      }
      return false;
    }
    if (check.blockers.length !== 0
      || !sameStringSet(item.expectedProvisionIds, check.independentlyDerivedProvisionIds)) {
      throw new Error(`agreed eval case ${item.caseId} does not match independent derivation`);
    }
    return true;
  });
  const acceptedTopics = new Set(accepted.map((item) => item.checklistTopic));
  const missingTopics = proposal.requiredChecklistTopics.filter(
    (topic) => !acceptedTopics.has(topic),
  );
  if (missingTopics.length > 0) {
    throw new Error(`accepted eval cases do not cover checklist topics: ${missingTopics.join(", ")}`);
  }
  const datasetBase = {
    schemaVersion: "1.1.0" as const,
    evalAssurance: "MACHINE_ASSURED" as const,
    reviewerRef: null,
    sourceSnapshot: {
      snapshotId: proposal.snapshotId,
      manifestSha256: proposal.snapshotManifestSha256,
    },
    generation: {
      ...proposal.generator,
      artifactSha256: proposalSha256,
    },
    independentCheck: {
      ...independentCheck.checker,
      artifactSha256: independentCheckSha256,
    },
    requiredChecklistTopics: [...proposal.requiredChecklistTopics].sort(),
    cases: accepted.map((item) => ({
      ...item,
      expectedProvisionIds: [...item.expectedProvisionIds].sort(),
    })).sort((left, right) => left.caseId.localeCompare(right.caseId)),
  };
  const datasetId = `eval-dataset:${replayChecksum(datasetBase).slice(0, 40)}`;
  const dataset: ProductionEvalDataset = { ...datasetBase, datasetId };
  return {
    dataset,
    datasetSha256: replayChecksum(dataset),
    proposalSha256,
    independentCheckSha256,
    acceptedCaseCount: accepted.length,
    blockedCaseCount: proposal.cases.length - accepted.length,
  };
}

function validateProposal(proposal: ProductionEvalProposal): void {
  if (proposal.schemaVersion !== "1.0.0" || !ID.test(proposal.proposalId)
    || !ID.test(proposal.snapshotId) || !SHA256.test(proposal.snapshotManifestSha256)
    || proposal.requiredChecklistTopics.length === 0 || proposal.cases.length === 0) {
    throw new Error("production eval proposal shape is invalid");
  }
  validateAgent(proposal.generator, "generator");
  if (new Set(proposal.requiredChecklistTopics).size !== proposal.requiredChecklistTopics.length
    || new Set(proposal.cases.map((item) => item.caseId)).size !== proposal.cases.length
    || proposal.cases.some((item) => !ID.test(item.caseId) || !item.query.trim()
      || !proposal.requiredChecklistTopics.includes(item.checklistTopic)
      || item.expectedProvisionIds.length === 0
      || new Set(item.expectedProvisionIds).size !== item.expectedProvisionIds.length
      || item.expectedProvisionIds.some((id) => !ID.test(id)))) {
    throw new Error("production eval proposal membership is invalid");
  }
}

function validateIndependentCheck(check: ProductionEvalIndependentCheck): void {
  if (check.schemaVersion !== "1.0.0" || !ID.test(check.checkId)
    || !ID.test(check.snapshotId) || !SHA256.test(check.snapshotManifestSha256)
    || !SHA256.test(check.proposalSha256) || check.cases.length === 0) {
    throw new Error("production eval independent check shape is invalid");
  }
  validateAgent(check.checker, "checker");
  if (new Set(check.cases.map((item) => item.caseId)).size !== check.cases.length
    || check.cases.some((item) => !ID.test(item.caseId)
      || !["AGREE", "BLOCK"].includes(item.outcome)
      || new Set(item.independentlyDerivedProvisionIds).size
        !== item.independentlyDerivedProvisionIds.length
      || item.independentlyDerivedProvisionIds.some((id) => !ID.test(id)))) {
    throw new Error("production eval independent check membership is invalid");
  }
}

function validateAgent(agent: EvalAgentProvenance, label: string): void {
  if (!ID.test(agent.agentId) || [agent.model, agent.promptTemplateId,
    agent.promptTemplateVersion, agent.parametersVersion].some((item) => !item.trim())) {
    throw new Error(`production eval ${label} provenance is incomplete`);
  }
}

function sameStringSet(left: string[], right: string[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}
