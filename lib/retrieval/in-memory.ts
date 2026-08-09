import type {
  EvidenceRetrievalRepository,
  EvidenceSearchFilters,
  IndexedEvidenceChunk,
  QueryEmbeddingProvider,
  RetrievalIndexRelease,
  RetrievalRunAudit,
} from "./contracts";

export class InMemoryEvidenceRetrievalRepository
  implements EvidenceRetrievalRepository
{
  readonly runs: RetrievalRunAudit[] = [];

  constructor(
    private readonly indexes: RetrievalIndexRelease[],
    private readonly chunks: IndexedEvidenceChunk[],
  ) {}

  async resolveIndex(filters: EvidenceSearchFilters): Promise<RetrievalIndexRelease | null> {
    const candidates = this.indexes
      .filter(
        (index) =>
          (filters.indexReleaseId === null ||
            index.indexReleaseId === filters.indexReleaseId) &&
          (filters.corpusReleaseId === null ||
            index.corpusReleaseId === filters.corpusReleaseId),
      )
      .sort(
        (left, right) =>
          Date.parse(right.generatedAt) - Date.parse(left.generatedAt) ||
          left.indexReleaseId.localeCompare(right.indexReleaseId),
      );
    return candidates[0] ?? null;
  }

  async listChunks(indexReleaseId: string): Promise<IndexedEvidenceChunk[]> {
    return this.chunks.filter((chunk) => chunk.indexReleaseId === indexReleaseId);
  }

  async recordRun(run: RetrievalRunAudit): Promise<void> {
    this.runs.push(structuredClone(run));
  }
}

/**
 * Deterministic local embedding used only by tests/evals. Production adapters
 * must pin a real provider/model/version in RetrievalIndexRelease.
 */
export class DeterministicTokenEmbedding implements QueryEmbeddingProvider {
  readonly model = "deterministic-token-v1";
  readonly version = "1";

  constructor(readonly dimensions = 64) {}

  async embed(text: string): Promise<number[]> {
    return deterministicEmbedding(text, this.dimensions);
  }
}

export function deterministicEmbedding(text: string, dimensions: number): number[] {
  const vector = Array.from({ length: dimensions }, () => 0);
  for (const token of text
    .toLocaleLowerCase("en")
    .normalize("NFKC")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((item) => item.length > 1)) {
    let hash = 2166136261;
    for (const character of token) {
      hash ^= character.codePointAt(0) ?? 0;
      hash = Math.imul(hash, 16777619);
    }
    vector[(hash >>> 0) % dimensions] += 1;
  }
  const norm = Math.sqrt(vector.reduce((sum, item) => sum + item ** 2, 0));
  return norm === 0 ? vector : vector.map((item) => item / norm);
}
