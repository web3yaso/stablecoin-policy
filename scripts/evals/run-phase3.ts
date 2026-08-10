import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  DeterministicTokenEmbedding,
  InMemoryEvidenceRetrievalRepository,
} from "../../lib/retrieval/in-memory";
import { EvidenceSearchService } from "../../lib/retrieval/search";
import {
  retrievalIndexBuildInputErrors,
  type RetrievalIndexBuildInput,
} from "../../lib/retrieval/index-builder";
import {
  RAG_EVAL_CHUNKS,
  RAG_EVAL_INDEX,
  RIGHTS_POISON_CHUNK,
  WRONG_RELEASE_CHUNK,
} from "./phase3-rag-fixture";

type GoldCase = {
  caseId: string;
  query: string;
  expectedProvisionId: string;
};

type BuilderCase = {
  caseId: string;
  mutation:
    | "NONE"
    | "STORAGE_RIGHTS_UNKNOWN"
    | "RIGHTS_REVIEW_MISSING"
    | "EXCERPT_PERMISSION_UNKNOWN"
    | "PROVISION_TEXT_MISSING"
    | "CLAIM_WITHOUT_CITATION"
    | "CROSS_RELEASE_CLAIM"
    | "ASSURANCE_TIER_MISMATCH"
    | "JURISDICTION_MISMATCH"
    | "PROVISIONAL_CUTOFF_BEFORE_AS_OF"
    | "REVIEWED_CUTOFF_BEFORE_AS_OF"
    | "FRESH_BEFORE_KNOWLEDGE_CUTOFF";
  expected: "PASS" | "BLOCK";
};

async function main() {
  const cases = (await readFile(
    path.join(process.cwd(), "evals", "phase3-rag-gold.jsonl"),
    "utf8",
  ))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as GoldCase);
  const repository = new InMemoryEvidenceRetrievalRepository(
    [RAG_EVAL_INDEX],
    [...RAG_EVAL_CHUNKS, RIGHTS_POISON_CHUNK, WRONG_RELEASE_CHUNK],
  );
  const service = new EvidenceSearchService(
    repository,
    new DeterministicTokenEmbedding(64),
  );

  let recalled = 0;
  let reciprocalRankTotal = 0;
  let citationErrors = 0;
  let isolationErrors = 0;
  let rightsLeaks = 0;
  for (const evalCase of cases) {
    const response = await service.search({
      query: evalCase.query,
      filters: {
        jurisdictionCodes: ["EEA"],
        topics: [],
        asOf: "2026-08-09T00:00:00.000Z",
        sourceTypes: ["REGULATION"],
        assuranceTier: "PROVISIONAL",
        corpusReleaseId: RAG_EVAL_INDEX.corpusReleaseId,
        indexReleaseId: RAG_EVAL_INDEX.indexReleaseId,
      },
      topK: 10,
    });
    const rank = response.hits.findIndex(
      (hit) => hit.citation.provisionId === evalCase.expectedProvisionId,
    );
    if (rank >= 0) {
      recalled += 1;
      reciprocalRankTotal += 1 / (rank + 1);
    }
    for (const hit of response.hits) {
      const source = RAG_EVAL_CHUNKS.find((chunk) => chunk.chunkId === hit.chunkId);
      if (
        source === undefined ||
        source.citationId !== hit.citation.citationId ||
        source.provisionId !== hit.citation.provisionId ||
        source.locator !== hit.citation.locator
      ) citationErrors += 1;
      if (
        source?.indexReleaseId !== RAG_EVAL_INDEX.indexReleaseId ||
        source?.corpusReleaseId !== RAG_EVAL_INDEX.corpusReleaseId ||
        source?.sourceVersionId !== "version:rag-eval:mica:1"
      ) isolationErrors += 1;
      if (hit.chunkId === RIGHTS_POISON_CHUNK.chunkId) rightsLeaks += 1;
    }
  }

  const unauthorized = await service.search({
    query: "issuer authorization",
    filters: {
      jurisdictionCodes: ["EEA"],
      topics: [],
      asOf: "2026-08-09T00:00:00.000Z",
      sourceTypes: [],
      assuranceTier: "HUMAN_REVIEWED",
      corpusReleaseId: null,
      indexReleaseId: null,
    },
    topK: 10,
  });

  const builderCases = await readJsonLines<BuilderCase>(
    "evals/phase3-index-builder-cases.jsonl",
  );
  let builderCorrect = 0;
  let unsafeBuildsAccepted = 0;
  for (const evalCase of builderCases) {
    const input = builderInput(evalCase.mutation);
    const outcome = retrievalIndexBuildInputErrors(input, BUILDER_CONFIG).length === 0
      ? "PASS"
      : "BLOCK";
    if (outcome === evalCase.expected) builderCorrect += 1;
    if (evalCase.expected === "BLOCK" && outcome === "PASS") {
      unsafeBuildsAccepted += 1;
    }
  }

  const recallAt10 = recalled / cases.length;
  const mrrAt10 = reciprocalRankTotal / cases.length;
  const report = {
    schemaVersion: "1.0.0",
    caseCount: cases.length,
    recallAt10,
    mrrAt10,
    citationPrecision: citationErrors === 0 ? 1 : 0,
    versionIsolation: isolationErrors === 0 ? 1 : 0,
    unauthorizedEvidenceLeaks: unauthorized.hits.length,
    rightsLeaks,
    promptInjectedInstructionsUsedAsAuthority: rightsLeaks,
    indexBuildCaseCount: builderCases.length,
    indexBuildGateAccuracy: builderCorrect / builderCases.length,
    unsafeBuildsAccepted,
  };
  console.log(JSON.stringify(report, null, 2));
  if (
    recallAt10 < 0.95 ||
    mrrAt10 < 0.9 ||
    citationErrors > 0 ||
    isolationErrors > 0 ||
    unauthorized.hits.length > 0 ||
    rightsLeaks > 0 ||
    builderCorrect !== builderCases.length ||
    unsafeBuildsAccepted > 0
  ) {
    throw new Error("Phase 3 Evidence RAG eval gates failed");
  }
}

const BUILDER_CONFIG = {
  indexReleaseId: "index:rag-eval:builder:1",
  policyDomain: "stablecoin",
  expectedJurisdictionCode: "EEA",
  freshThrough: "2026-12-31T00:00:00.000Z",
  lexicalConfig: { language: "english", version: "1" },
  vectorConfig: { distance: "cosine", fusion: "rrf", version: "1" },
};

function builderInput(mutation: BuilderCase["mutation"]): RetrievalIndexBuildInput {
  const input: RetrievalIndexBuildInput = {
    schemaVersion: "1.0.0",
    policyDomain: "stablecoin",
    corpusReleaseId: "provisional:rag-eval:eea:1",
    corpusReleaseKind: "PROVISIONAL",
    assuranceTier: "PROVISIONAL",
    jurisdictionCode: "EEA",
    asOf: "2026-08-01T00:00:00.000Z",
    knowledgeCutoff: "2026-08-02T00:00:00.000Z",
    releaseManifestSha256: "a".repeat(64),
    claimIds: ["claim:rag-eval:builder"],
    sources: [{
      claimId: "claim:rag-eval:builder",
      citationId: "citation:rag-eval:builder",
      provisionId: "provision:rag-eval:builder",
      sourceVersionId: "version:rag-eval:builder",
      sourceVersionChecksumSha256: "b".repeat(64),
      jurisdictionCode: "EEA",
      languageCode: "en",
      supportRelation: "DIRECT_SUPPORT",
      locator: "Article 1",
      provisionText: "Sanitized provision text.",
      storageRights: "ALLOWED",
      rightsReviewedAt: "2026-07-31T00:00:00.000Z",
      rightsBasis: "Sanitized internal-search basis",
      excerptPermission: "ALLOWED",
      internalSearchAllowed: true,
    }],
  };
  const source = input.sources[0];
  switch (mutation) {
    case "STORAGE_RIGHTS_UNKNOWN":
      source.storageRights = "UNKNOWN";
      source.internalSearchAllowed = false;
      break;
    case "RIGHTS_REVIEW_MISSING":
      source.rightsReviewedAt = null;
      source.rightsBasis = null;
      break;
    case "EXCERPT_PERMISSION_UNKNOWN":
      source.excerptPermission = "UNKNOWN";
      break;
    case "PROVISION_TEXT_MISSING":
      source.provisionText = null;
      break;
    case "CLAIM_WITHOUT_CITATION":
      input.sources = [];
      break;
    case "CROSS_RELEASE_CLAIM":
      source.claimId = "claim:rag-eval:not-a-member";
      break;
    case "ASSURANCE_TIER_MISMATCH":
      input.assuranceTier = "HUMAN_REVIEWED";
      break;
    case "JURISDICTION_MISMATCH":
      source.jurisdictionCode = "SG";
      break;
    case "PROVISIONAL_CUTOFF_BEFORE_AS_OF":
      input.asOf = "2026-08-02T00:00:00.000Z";
      input.knowledgeCutoff = "2026-08-01T00:00:00.000Z";
      break;
    case "REVIEWED_CUTOFF_BEFORE_AS_OF":
      input.corpusReleaseKind = "HUMAN_REVIEWED";
      input.assuranceTier = "HUMAN_REVIEWED";
      input.asOf = "2026-08-02T00:00:00.000Z";
      input.knowledgeCutoff = "2026-08-01T00:00:00.000Z";
      break;
    case "FRESH_BEFORE_KNOWLEDGE_CUTOFF":
      input.knowledgeCutoff = "2027-01-01T00:00:00.000Z";
      break;
    case "NONE":
      break;
  }
  return input;
}

async function readJsonLines<T>(relativePath: string): Promise<T[]> {
  return (await readFile(path.join(process.cwd(), relativePath), "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
