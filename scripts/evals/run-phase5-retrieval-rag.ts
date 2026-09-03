import { readFile } from "node:fs/promises";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020";
import type {
  EvidenceRetrievalRepository,
  EvidenceSearchResponse,
  IndexedEvidenceChunk,
  RetrievalRunAudit,
} from "../../lib/retrieval/contracts";
import {
  DeterministicTokenEmbedding,
  InMemoryEvidenceRetrievalRepository,
} from "../../lib/retrieval/in-memory";
import { EvidenceSearchService } from "../../lib/retrieval/search";
import {
  runRetrievalRagEval,
  type RetrievalRagEvalCase,
  type RetrievalRagEvalReport,
} from "../../lib/playbooks/retrieval-rag-eval";
import {
  RAG_EVAL_CHUNKS,
  RAG_EVAL_INDEX,
  RIGHTS_POISON_CHUNK,
  WRONG_RELEASE_CHUNK,
} from "./phase3-rag-fixture";

const DATASET_PATH = path.join(process.cwd(), "evals", "playbook-retrieval-rag.jsonl");

type EvalCaseRecord = RetrievalRagEvalCase & { schemaVersion: "1.0.0" };

export async function buildRetrievalRagEvalCases(): Promise<RetrievalRagEvalCase[]> {
  const schema = JSON.parse(await readFile(
    path.join(process.cwd(), "contracts/v1/retrieval-rag-eval-case.schema.json"),
    "utf8",
  )) as object;
  const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);
  const records = (await readFile(DATASET_PATH, "utf8"))
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        throw new Error(`invalid retrieval/RAG eval JSON on line ${index + 1}`);
      }
      if (!validate(value)) {
        throw new Error(
          `invalid retrieval/RAG eval case on line ${index + 1}: ${JSON.stringify(validate.errors)}`,
        );
      }
      return value as EvalCaseRecord;
    });
  if (records.length === 0) throw new Error("retrieval/RAG eval dataset is empty");
  return records.map((record) => ({
    caseId: record.caseId,
    scope: record.scope,
    scenario: record.scenario,
    query: record.query,
    topic: record.topic,
    expectedStatus: record.expectedStatus,
    expectedProvisionId: record.expectedProvisionId,
  }));
}

export async function executeRetrievalRagEvalCase(
  evalCase: RetrievalRagEvalCase,
): Promise<EvidenceSearchResponse> {
  const chunks = fixtureChunks(evalCase);
  const repository = evalCase.scenario === "RETRIEVAL_UNAVAILABLE"
    ? outageRepository()
    : new InMemoryEvidenceRetrievalRepository([RAG_EVAL_INDEX], chunks);
  const service = new EvidenceSearchService(
    repository,
    new DeterministicTokenEmbedding(RAG_EVAL_INDEX.embeddingDimensions),
  );
  return service.search({
    query: evalCase.query,
    filters: {
      jurisdictionCodes: [evalCase.scope.jurisdictionCode],
      topics: [evalCase.topic],
      asOf: evalCase.scenario === "STALE_INDEX"
        ? "2027-01-01T00:00:00.000Z"
        : RAG_EVAL_INDEX.asOf,
      sourceTypes: ["REGULATION"],
      assuranceTier: evalCase.scenario === "UNAUTHORIZED_EVIDENCE"
        ? "HUMAN_REVIEWED"
        : "PROVISIONAL",
      corpusReleaseId: RAG_EVAL_INDEX.corpusReleaseId,
      indexReleaseId: RAG_EVAL_INDEX.indexReleaseId,
    },
    topK: 10,
  });
}

export async function buildRetrievalRagEvalReport(): Promise<RetrievalRagEvalReport> {
  const report = await runRetrievalRagEval(
    await buildRetrievalRagEvalCases(),
    {
      index: RAG_EVAL_INDEX,
      chunks: [...RAG_EVAL_CHUNKS, RIGHTS_POISON_CHUNK, WRONG_RELEASE_CHUNK],
      searchCase: executeRetrievalRagEvalCase,
    },
  );
  const schema = JSON.parse(await readFile(
    path.join(process.cwd(), "contracts/v1/retrieval-rag-eval-report.schema.json"),
    "utf8",
  )) as object;
  const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);
  if (!validate(report)) {
    throw new Error(`retrieval/RAG eval report schema failed: ${JSON.stringify(validate.errors)}`);
  }
  return report;
}

function fixtureChunks(evalCase: RetrievalRagEvalCase): IndexedEvidenceChunk[] {
  const chunks = [...RAG_EVAL_CHUNKS, RIGHTS_POISON_CHUNK, WRONG_RELEASE_CHUNK];
  if (evalCase.scenario !== "CONFLICTING_EVIDENCE") return chunks;
  const direct = RAG_EVAL_CHUNKS.find((chunk) => chunk.topic === evalCase.topic);
  if (direct === undefined) throw new Error(`missing conflict fixture topic: ${evalCase.topic}`);
  return [...chunks, {
    ...direct,
    chunkId: `${direct.chunkId}:conflict`,
    claimId: `${direct.claimId}:conflict`,
    citationId: `${direct.citationId}:conflict`,
    provisionId: `${direct.provisionId}:conflict`,
    supportRelation: "CONTRADICTS",
  }];
}

function outageRepository(): EvidenceRetrievalRepository {
  const runs: RetrievalRunAudit[] = [];
  return {
    async resolveIndex() {
      throw new Error("sanitized retrieval outage fixture");
    },
    async listChunks() {
      return [];
    },
    async recordRun(run) {
      runs.push(run);
    },
  };
}

async function main(): Promise<void> {
  const report = await buildRetrievalRagEvalReport();
  console.log(JSON.stringify(report, null, 2));
  if (report.outcome !== "PASSED") {
    throw new Error("Phase 5 retrieval/RAG eval gates failed");
  }
}

if (process.argv[1]?.endsWith("run-phase5-retrieval-rag.ts")) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
