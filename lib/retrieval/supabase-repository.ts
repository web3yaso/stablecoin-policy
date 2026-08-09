import { SupabaseHttpClient } from "../data/supabase-client";
import type {
  EvidenceRetrievalRepository,
  EvidenceSearchFilters,
  IndexedEvidenceChunk,
  RetrievalIndexRelease,
  RetrievalRunAudit,
} from "./contracts";

type RpcChunk = Omit<IndexedEvidenceChunk, "embedding"> & { embedding: string };

export class SupabaseEvidenceRetrievalRepository
  implements EvidenceRetrievalRepository
{
  constructor(
    private readonly client: SupabaseHttpClient,
    private readonly policyDomain = "stablecoin",
  ) {}

  async resolveIndex(filters: EvidenceSearchFilters): Promise<RetrievalIndexRelease | null> {
    const release = await this.client.rpc<RetrievalIndexRelease | null>(
      "resolve_retrieval_index_release",
      {
        p_policy_domain: this.policyDomain,
        p_requested_assurance_tier: filters.assuranceTier,
        p_corpus_release_id: filters.corpusReleaseId,
        p_index_release_id: filters.indexReleaseId,
      },
    );
    return release === null ? null : canonicalIndexRelease(release);
  }

  async listChunks(indexReleaseId: string): Promise<IndexedEvidenceChunk[]> {
    assertIdentifier(indexReleaseId, "indexReleaseId");
    const chunks = await this.client.rpc<RpcChunk[]>("list_retrieval_index_chunks", {
      p_index_release_id: indexReleaseId,
    });
    return chunks.map((chunk) => ({
      ...chunk,
      effectiveFrom: canonicalTime(chunk.effectiveFrom),
      effectiveTo: chunk.effectiveTo === null ? null : canonicalTime(chunk.effectiveTo),
      sourcePublishedAt:
        chunk.sourcePublishedAt === null ? null : canonicalTime(chunk.sourcePublishedAt),
      sourceRetrievedAt: canonicalTime(chunk.sourceRetrievedAt),
      embedding: parseVector(chunk.embedding),
    }));
  }

  async recordRun(run: RetrievalRunAudit): Promise<void> {
    await this.client.rpc("record_rag_retrieval_run", {
      p_run_id: run.runId,
      p_policy_domain: this.policyDomain,
      p_query_sha256: run.querySha256,
      p_filters: run.filters,
      p_requested_assurance_tier: run.filters.assuranceTier,
      p_index_release_id: run.indexReleaseId,
      p_corpus_release_id: run.corpusReleaseId,
      p_outcome: run.status,
      p_ranked_chunk_ids: run.rankedChunkIds,
      p_result_sha256: run.resultSha256,
      p_deterministic_decision_before_sha256: null,
      p_deterministic_decision_after_sha256: null,
    });
  }
}

function canonicalIndexRelease(release: RetrievalIndexRelease): RetrievalIndexRelease {
  return {
    ...release,
    asOf: canonicalTime(release.asOf),
    knowledgeCutoff: canonicalTime(release.knowledgeCutoff),
    generatedAt: canonicalTime(release.generatedAt),
    freshThrough: canonicalTime(release.freshThrough),
    embeddingDimensions: Number(release.embeddingDimensions),
  };
}

function canonicalTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error("invalid retrieval timestamp");
  return parsed.toISOString();
}

function parseVector(value: string): number[] {
  if (!/^\[(?:-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)(?:,-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)*\]$/i.test(value)) {
    throw new Error("invalid pgvector response");
  }
  const vector = value.slice(1, -1).split(",").map(Number);
  if (vector.length === 0 || vector.some((item) => !Number.isFinite(item))) {
    throw new Error("invalid pgvector response");
  }
  return vector;
}

function assertIdentifier(value: string, name: string): void {
  if (!/^[a-z0-9][a-z0-9._:-]{2,200}$/.test(value)) {
    throw new Error(`${name} is invalid`);
  }
}
