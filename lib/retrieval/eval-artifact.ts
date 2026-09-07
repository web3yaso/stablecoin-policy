import { createHash } from "node:crypto";
import { replayChecksum } from "../legal-corpus/machine-pipeline";
import type { RetrievalEvalMetrics } from "./index-admin";
import type { RetrievalIndexRelease } from "./contracts";
import {
  productionEvalMetricsPass,
  validateProductionEvalDataset,
  type EvalDatasetAgentProvenance,
  type ProductionEvalDataset,
  type ProductionEvalReport,
} from "./production-eval";

const SHA256 = /^[0-9a-f]{64}$/;
const IDENTIFIER = /^[a-z0-9][a-z0-9._:-]{2,200}$/;

export type ProductionEvalArtifact = ProductionEvalReport & {
  evaluatedAt: string;
  manifestSha256: string;
  datasetSha256: string;
  datasetId: string;
  sourceSnapshot: ProductionEvalDataset["sourceSnapshot"];
  generation: EvalDatasetAgentProvenance;
  independentCheck: EvalDatasetAgentProvenance;
};

export function inspectProductionEvalArtifact(
  value: unknown,
  dataset: ProductionEvalDataset,
  index: RetrievalIndexRelease,
  currentManifestSha256: string,
): { artifact: ProductionEvalArtifact; artifactSha256: string } {
  validateProductionEvalDataset(dataset, index.assuranceTier);
  if (!isRecord(value)) throw new Error("production eval artifact must be an object");
  const artifact = value as ProductionEvalArtifact;
  if (artifact.schemaVersion !== "1.0.0"
    || artifact.indexReleaseId !== index.indexReleaseId
    || artifact.corpusReleaseId !== index.corpusReleaseId
    || artifact.evalAssurance !== dataset.evalAssurance
    || artifact.caseCount !== dataset.cases.length
    || artifact.datasetId !== dataset.datasetId) {
    throw new Error("production eval artifact identity does not match the dataset and index");
  }
  if (!SHA256.test(artifact.manifestSha256)
    || artifact.manifestSha256 !== currentManifestSha256
    || artifact.datasetSha256 !== replayChecksum(dataset)
    || !Number.isFinite(Date.parse(artifact.evaluatedAt))) {
    throw new Error("production eval artifact checksum or manifest pin is invalid");
  }
  if (replayChecksum(artifact.sourceSnapshot) !== replayChecksum(dataset.sourceSnapshot)
    || replayChecksum(artifact.generation) !== replayChecksum(dataset.generation)
    || replayChecksum(artifact.independentCheck) !== replayChecksum(dataset.independentCheck)) {
    throw new Error("production eval artifact provenance does not match the dataset");
  }
  validateMetrics(artifact.metrics);
  validateQueryResults(artifact, dataset);
  if (artifact.passed !== productionEvalMetricsPass(artifact.metrics)) {
    throw new Error("production eval artifact pass state does not match its metrics");
  }
  return { artifact, artifactSha256: replayChecksum(artifact) };
}

function validateMetrics(metrics: RetrievalEvalMetrics): void {
  const ratios = [
    metrics.recallAt10,
    metrics.mrrAt10,
    metrics.citationPrecision,
    metrics.versionIsolation,
    metrics.checklistTopicCoverage,
  ];
  const leaks = [
    metrics.rightsLeaks,
    metrics.assuranceLeaks,
    metrics.promptInstructionLeaks,
    metrics.unsafeBuildsAccepted,
  ];
  if (ratios.some((item) => !Number.isFinite(item) || item < 0 || item > 1)
    || leaks.some((item) => !Number.isSafeInteger(item) || item < 0)) {
    throw new Error("production eval artifact metrics are invalid");
  }
}

function validateQueryResults(
  artifact: ProductionEvalArtifact,
  dataset: ProductionEvalDataset,
): void {
  if (!Array.isArray(artifact.queryResults)
    || artifact.queryResults.length !== dataset.cases.length
    || new Set(artifact.queryResults.map((item) => item.caseId)).size !== dataset.cases.length) {
    throw new Error("production eval artifact query membership is invalid");
  }
  const byCase = new Map(artifact.queryResults.map((item) => [item.caseId, item]));
  let recalled = 0;
  let reciprocalRank = 0;
  for (const evalCase of dataset.cases) {
    const result = byCase.get(evalCase.caseId);
    const querySha256 = createHash("sha256").update(evalCase.query).digest("hex");
    if (!result || result.querySha256 !== querySha256
      || !Array.isArray(result.returnedProvisionIds)
      || result.returnedProvisionIds.length > 10
      || (result.firstExpectedRank !== null
        && (!Number.isSafeInteger(result.firstExpectedRank)
          || result.firstExpectedRank < 1 || result.firstExpectedRank > 10))
      || result.returnedProvisionIds.some((item) => !IDENTIFIER.test(item))) {
      throw new Error("production eval artifact query result does not match the dataset");
    }
    const actualRank = result.returnedProvisionIds.findIndex((item) =>
      evalCase.expectedProvisionIds.includes(item));
    const reportedRank = result.firstExpectedRank === null
      ? -1
      : result.firstExpectedRank - 1;
    if (reportedRank !== actualRank) {
      throw new Error("production eval artifact rank does not match returned provisions");
    }
    if (actualRank >= 0) {
      recalled += 1;
      reciprocalRank += 1 / (actualRank + 1);
    }
  }
  const expectedRecall = recalled / dataset.cases.length;
  const expectedMrr = reciprocalRank / dataset.cases.length;
  const coveredTopics = new Set(dataset.cases.map((item) => item.checklistTopic));
  const expectedCoverage = dataset.requiredChecklistTopics.filter(
    (topic) => coveredTopics.has(topic),
  ).length / dataset.requiredChecklistTopics.length;
  if (!approximatelyEqual(artifact.metrics.recallAt10, expectedRecall)
    || !approximatelyEqual(artifact.metrics.mrrAt10, expectedMrr)
    || !approximatelyEqual(artifact.metrics.checklistTopicCoverage, expectedCoverage)) {
    throw new Error("production eval artifact aggregate metrics do not match query results");
  }
}

function approximatelyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= Number.EPSILON * 8;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
