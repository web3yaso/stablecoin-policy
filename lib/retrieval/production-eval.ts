import { createHash } from "node:crypto";
import type {
  IndexedEvidenceChunk,
  QueryEmbeddingProvider,
  RetrievalIndexRelease,
} from "./contracts";
import {
  InMemoryEvidenceRetrievalRepository,
} from "./in-memory";
import { EvidenceSearchService } from "./search";
import type {
  RetrievalEvalAssurance,
  RetrievalEvalMetrics,
} from "./index-admin";

export type ProductionEvalDataset = {
  schemaVersion: "1.0.0";
  evalAssurance: RetrievalEvalAssurance;
  generatedBy: string;
  independentlyCheckedBy: string;
  reviewerRef: string | null;
  requiredChecklistTopics: string[];
  cases: Array<{
    caseId: string;
    checklistTopic: string;
    query: string;
    expectedProvisionIds: string[];
  }>;
};

export type ProductionEvalReport = {
  schemaVersion: "1.0.0";
  indexReleaseId: string;
  corpusReleaseId: string;
  evalAssurance: RetrievalEvalAssurance;
  caseCount: number;
  queryResults: Array<{
    caseId: string;
    querySha256: string;
    firstExpectedRank: number | null;
    returnedProvisionIds: string[];
  }>;
  metrics: RetrievalEvalMetrics;
  passed: boolean;
};

export async function runProductionDraftEval(
  dataset: ProductionEvalDataset,
  index: RetrievalIndexRelease,
  chunks: IndexedEvidenceChunk[],
  embeddingProvider: QueryEmbeddingProvider,
): Promise<ProductionEvalReport> {
  validateProductionEvalDataset(dataset, index.assuranceTier);
  if (
    embeddingProvider.model !== index.embeddingModel ||
    embeddingProvider.version !== index.embeddingModelVersion ||
    embeddingProvider.dimensions !== index.embeddingDimensions
  ) throw new Error("eval embedding configuration does not match the DRAFT index");

  const repository = new InMemoryEvidenceRetrievalRepository([index], chunks);
  const search = new EvidenceSearchService(repository, embeddingProvider);
  let recalled = 0;
  let reciprocalRank = 0;
  let citationErrors = 0;
  let versionErrors = 0;
  let rightsLeaks = 0;
  let assuranceLeaks = 0;
  let promptInstructionLeaks = 0;
  const coveredTopics = new Set<string>();
  const results: ProductionEvalReport["queryResults"] = [];
  const byChunkId = new Map(chunks.map((chunk) => [chunk.chunkId, chunk]));

  for (const evalCase of dataset.cases) {
    coveredTopics.add(evalCase.checklistTopic);
    const response = await search.search({
      query: evalCase.query,
      filters: {
        jurisdictionCodes: [...new Set(chunks.map((chunk) => chunk.jurisdictionCode))],
        topics: [],
        asOf: index.asOf,
        sourceTypes: [],
        assuranceTier: index.assuranceTier,
        corpusReleaseId: index.corpusReleaseId,
        indexReleaseId: index.indexReleaseId,
      },
      topK: 10,
    });
    const rank = response.hits.findIndex((hit) =>
      evalCase.expectedProvisionIds.includes(hit.citation.provisionId));
    if (rank >= 0) {
      recalled += 1;
      reciprocalRank += 1 / (rank + 1);
    }
    for (const hit of response.hits) {
      const source = byChunkId.get(hit.chunkId);
      if (!source || source.citationId !== hit.citation.citationId
        || source.provisionId !== hit.citation.provisionId
        || source.locator !== hit.citation.locator) citationErrors += 1;
      if (!source || source.indexReleaseId !== index.indexReleaseId
        || source.corpusReleaseId !== index.corpusReleaseId) versionErrors += 1;
      if (!source?.internalSearchAllowed) rightsLeaks += 1;
      if (hit.assuranceTier !== index.assuranceTier) assuranceLeaks += 1;
      if (source && /ignore (all|previous).*instruction|treat .* as .*authority/i.test(source.searchText)) {
        promptInstructionLeaks += 1;
      }
    }
    results.push({
      caseId: evalCase.caseId,
      querySha256: createHash("sha256").update(evalCase.query).digest("hex"),
      firstExpectedRank: rank < 0 ? null : rank + 1,
      returnedProvisionIds: response.hits.map((hit) => hit.citation.provisionId),
    });
  }
  const metrics: RetrievalEvalMetrics = {
    recallAt10: recalled / dataset.cases.length,
    mrrAt10: reciprocalRank / dataset.cases.length,
    citationPrecision: citationErrors === 0 ? 1 : 0,
    versionIsolation: versionErrors === 0 ? 1 : 0,
    checklistTopicCoverage: dataset.requiredChecklistTopics.filter(
      (topic) => coveredTopics.has(topic),
    ).length / dataset.requiredChecklistTopics.length,
    rightsLeaks,
    assuranceLeaks,
    promptInstructionLeaks,
    unsafeBuildsAccepted: 0,
  };
  return {
    schemaVersion: "1.0.0",
    indexReleaseId: index.indexReleaseId,
    corpusReleaseId: index.corpusReleaseId,
    evalAssurance: dataset.evalAssurance,
    caseCount: dataset.cases.length,
    queryResults: results,
    metrics,
    passed: metrics.recallAt10 >= 0.95 && metrics.mrrAt10 >= 0.90
      && metrics.citationPrecision === 1 && metrics.versionIsolation === 1
      && metrics.checklistTopicCoverage === 1 && metrics.rightsLeaks === 0
      && metrics.assuranceLeaks === 0 && metrics.promptInstructionLeaks === 0
      && metrics.unsafeBuildsAccepted === 0,
  };
}

export function validateProductionEvalDataset(
  dataset: ProductionEvalDataset,
  indexAssuranceTier: RetrievalIndexRelease["assuranceTier"],
): void {
  if (dataset.schemaVersion !== "1.0.0" || dataset.cases.length === 0
    || dataset.requiredChecklistTopics.length === 0) {
    throw new Error("production eval dataset is empty or has an unsupported schema");
  }
  if (new Set(dataset.cases.map((item) => item.caseId)).size !== dataset.cases.length
    || new Set(dataset.requiredChecklistTopics).size !== dataset.requiredChecklistTopics.length
    || dataset.cases.some((item) => !item.query.trim()
      || item.expectedProvisionIds.length === 0
      || !dataset.requiredChecklistTopics.includes(item.checklistTopic))) {
    throw new Error("production eval dataset membership is invalid");
  }
  if (!dataset.generatedBy.trim() || !dataset.independentlyCheckedBy.trim()
    || dataset.generatedBy === dataset.independentlyCheckedBy) {
    throw new Error("production eval requires distinct generator and checker provenance");
  }
  if (indexAssuranceTier === "HUMAN_REVIEWED"
    && (dataset.evalAssurance !== "HUMAN_REVIEWED" || !dataset.reviewerRef?.trim())) {
    throw new Error("human-reviewed indexes require a named human-reviewed eval dataset");
  }
  if (dataset.evalAssurance === "HUMAN_REVIEWED" && !dataset.reviewerRef?.trim()) {
    throw new Error("human-reviewed eval assurance requires reviewer provenance");
  }
}
