import { createHash, randomBytes } from "node:crypto";
import type {
  AssuranceTier,
  EvidenceRetrievalRepository,
  EvidenceSearchFilters,
  EvidenceSearchRequest,
  EvidenceSearchResponse,
  EvidenceSearchStatus,
  IndexedEvidenceChunk,
  QueryEmbeddingProvider,
  RankedEvidenceHit,
  RetrievalIndexRelease,
  RetrievalRunAudit,
} from "./contracts";
import { EVIDENCE_SEARCH_SCHEMA_VERSION } from "./contracts";

const RRF_K = 60;
const MIN_HYBRID_SCORE = 1 / (RRF_K + 25);
const MAX_QUERY_LENGTH = 2_000;
const MAX_TOP_K = 10;

type Candidate = {
  chunk: IndexedEvidenceChunk;
  lexicalRank: number | null;
  vectorRank: number | null;
  score: number;
};

export class EvidenceSearchService {
  constructor(
    private readonly repository: EvidenceRetrievalRepository,
    private readonly embeddingProvider: QueryEmbeddingProvider,
  ) {}

  async search(input: EvidenceSearchRequest): Promise<EvidenceSearchResponse> {
    const request = validateSearchRequest(input);
    const querySha256 = sha256(request.query);
    let index: RetrievalIndexRelease | null = null;

    try {
      index = await this.repository.resolveIndex(request.filters);
      if (index === null) {
        return await this.finish(
          request.filters,
          querySha256,
          null,
          "INSUFFICIENT_EVIDENCE",
          [],
          ["No retrieval index matches the requested release and assurance tier."],
        );
      }
      if (!tierAuthorized(index.assuranceTier, request.filters.assuranceTier)) {
        return await this.finish(
          request.filters,
          querySha256,
          index,
          "UNAUTHORIZED_EVIDENCE",
          [],
          ["The selected index does not satisfy the requested assurance tier."],
        );
      }
      if (Date.parse(request.filters.asOf) > Date.parse(index.freshThrough)) {
        return await this.finish(
          request.filters,
          querySha256,
          index,
          "STALE_INDEX",
          [],
          ["The pinned retrieval index is stale for the requested as-of time."],
        );
      }
      if (
        index.embeddingModel !== this.embeddingProvider.model ||
        index.embeddingModelVersion !== this.embeddingProvider.version ||
        index.embeddingDimensions !== this.embeddingProvider.dimensions
      ) {
        return await this.finish(
          request.filters,
          querySha256,
          index,
          "RETRIEVAL_UNAVAILABLE",
          [],
          ["The query embedding configuration does not match the pinned index."],
        );
      }

      const [chunks, queryEmbedding] = await Promise.all([
        this.repository.listChunks(index.indexReleaseId),
        this.embeddingProvider.embed(request.query),
      ]);
      const eligible = chunks.filter((chunk) =>
        chunkEligible(chunk, index!, request.filters),
      );
      const candidates = hybridRank(request.query, queryEmbedding, eligible);
      const hits = candidates
        .filter((candidate) => candidate.score >= MIN_HYBRID_SCORE)
        .slice(0, request.topK)
        .map((candidate, position) => toHit(candidate, position + 1));
      if (hits.length === 0) {
        return await this.finish(
          request.filters,
          querySha256,
          index,
          "INSUFFICIENT_EVIDENCE",
          [],
          ["No authorized evidence met the minimum hybrid retrieval threshold."],
        );
      }
      const status: EvidenceSearchStatus = hasMaterialConflict(hits)
        ? "CONFLICTING_EVIDENCE"
        : "SUCCESS";
      return await this.finish(
        request.filters,
        querySha256,
        index,
        status,
        hits,
        status === "SUCCESS"
          ? assuranceLimitations(index.assuranceTier)
          : ["Conflicting evidence requires deterministic review; no explanation was generated."],
      );
    } catch {
      return await this.finish(
        request.filters,
        querySha256,
        index,
        "RETRIEVAL_UNAVAILABLE",
        [],
        ["Evidence retrieval is unavailable; deterministic decisions remain unchanged."],
      );
    }
  }

  private async finish(
    filters: EvidenceSearchFilters,
    querySha256: string,
    index: RetrievalIndexRelease | null,
    status: EvidenceSearchStatus,
    hits: RankedEvidenceHit[],
    limitations: string[],
  ): Promise<EvidenceSearchResponse> {
    const runId = `rag-run:${querySha256.slice(0, 16)}:${randomBytes(8).toString("hex")}`;
    const response: EvidenceSearchResponse = {
      schemaVersion: EVIDENCE_SEARCH_SCHEMA_VERSION,
      runId,
      status,
      querySha256,
      indexRelease: index,
      hits: status === "CONFLICTING_EVIDENCE" ? [] : hits,
      limitations,
      explanation: null,
    };
    const audit: RetrievalRunAudit = {
      runId,
      querySha256,
      filters,
      indexReleaseId: index?.indexReleaseId ?? null,
      corpusReleaseId: index?.corpusReleaseId ?? null,
      status,
      rankedChunkIds: response.hits.map((hit) => hit.chunkId),
      resultSha256: sha256(stableStringify({ ...response, runId: null })),
    };
    try {
      await this.repository.recordRun(audit);
    } catch (error: unknown) {
      if (status !== "RETRIEVAL_UNAVAILABLE") throw error;
    }
    return response;
  }
}

export function validateSearchRequest(input: EvidenceSearchRequest): EvidenceSearchRequest {
  if (typeof input.query !== "string") throw new Error("query must be a string");
  const query = input.query.trim();
  if (query.length === 0 || query.length > MAX_QUERY_LENGTH) {
    throw new Error(`query must contain 1-${MAX_QUERY_LENGTH} characters`);
  }
  if (!Number.isInteger(input.topK) || input.topK < 1 || input.topK > MAX_TOP_K) {
    throw new Error(`topK must be an integer between 1 and ${MAX_TOP_K}`);
  }
  assertStringArray(input.filters.jurisdictionCodes, "jurisdictionCodes");
  assertStringArray(input.filters.topics, "topics");
  assertStringArray(input.filters.sourceTypes, "sourceTypes");
  if (Number.isNaN(Date.parse(input.filters.asOf))) {
    throw new Error("filters.asOf must be an ISO date-time");
  }
  if (!(["PROVISIONAL", "HUMAN_REVIEWED"] as const).includes(input.filters.assuranceTier)) {
    throw new Error("filters.assuranceTier is invalid");
  }
  return { ...input, query, filters: { ...input.filters } };
}

export function hybridRank(
  query: string,
  queryEmbedding: number[],
  chunks: IndexedEvidenceChunk[],
): Candidate[] {
  const lexical = chunks
    .map((chunk) => ({ chunk, score: lexicalScore(query, chunk.searchText) }))
    .filter((candidate) => candidate.score > 0)
    .sort(compareRawScores);
  const vector = chunks
    .map((chunk) => ({ chunk, score: cosineSimilarity(queryEmbedding, chunk.embedding) }))
    .sort(compareRawScores);
  const lexicalRanks = rankMap(lexical);
  const vectorRanks = rankMap(vector);
  const candidates = new Map<string, Candidate>();
  for (const chunk of chunks) {
    const lexicalRank = lexicalRanks.get(chunk.chunkId) ?? null;
    const vectorRank = vectorRanks.get(chunk.chunkId) ?? null;
    if (lexicalRank === null && vectorRank === null) continue;
    const score =
      (lexicalRank === null ? 0 : 1 / (RRF_K + lexicalRank)) +
      (vectorRank === null ? 0 : 1 / (RRF_K + vectorRank));
    candidates.set(chunk.chunkId, { chunk, lexicalRank, vectorRank, score });
  }
  const deduped = new Map<string, Candidate>();
  for (const candidate of [...candidates.values()].sort(compareCandidates)) {
    const key = `${candidate.chunk.claimId}:${candidate.chunk.provisionId}`;
    if (!deduped.has(key)) deduped.set(key, candidate);
  }
  return [...deduped.values()].sort(compareCandidates);
}

export function tierAuthorized(
  indexTier: AssuranceTier,
  requestedTier: AssuranceTier,
): boolean {
  return requestedTier === "PROVISIONAL" || indexTier === "HUMAN_REVIEWED";
}

function chunkEligible(
  chunk: IndexedEvidenceChunk,
  index: RetrievalIndexRelease,
  filters: EvidenceSearchFilters,
): boolean {
  return (
    chunk.indexReleaseId === index.indexReleaseId &&
    chunk.corpusReleaseId === index.corpusReleaseId &&
    chunk.assuranceTier === index.assuranceTier &&
    chunk.internalSearchAllowed &&
    (filters.jurisdictionCodes.length === 0 ||
      filters.jurisdictionCodes.includes(chunk.jurisdictionCode)) &&
    (filters.topics.length === 0 || filters.topics.includes(chunk.topic)) &&
    (filters.sourceTypes.length === 0 || filters.sourceTypes.includes(chunk.sourceType)) &&
    Date.parse(chunk.effectiveFrom) <= Date.parse(filters.asOf) &&
    (chunk.effectiveTo === null || Date.parse(chunk.effectiveTo) > Date.parse(filters.asOf))
  );
}

function lexicalScore(query: string, text: string): number {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return 0;
  const textTokens = tokenize(text);
  const frequencies = new Map<string, number>();
  textTokens.forEach((token) => frequencies.set(token, (frequencies.get(token) ?? 0) + 1));
  return queryTokens.reduce((score, token) => score + (frequencies.get(token) ?? 0), 0) /
    Math.sqrt(Math.max(textTokens.length, 1));
}

function tokenize(input: string): string[] {
  return input
    .toLocaleLowerCase("en")
    .normalize("NFKC")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 1);
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || left.length !== right.length) return -1;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  if (leftNorm === 0 || rightNorm === 0) return -1;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function rankMap(candidates: Array<{ chunk: IndexedEvidenceChunk; score: number }>) {
  return new Map(candidates.map((candidate, index) => [candidate.chunk.chunkId, index + 1]));
}

function compareRawScores(
  left: { chunk: IndexedEvidenceChunk; score: number },
  right: { chunk: IndexedEvidenceChunk; score: number },
): number {
  return right.score - left.score || left.chunk.chunkId.localeCompare(right.chunk.chunkId);
}

function compareCandidates(left: Candidate, right: Candidate): number {
  return right.score - left.score || left.chunk.chunkId.localeCompare(right.chunk.chunkId);
}

function toHit(candidate: Candidate, rank: number): RankedEvidenceHit {
  const chunk = candidate.chunk;
  return {
    rank,
    score: Number(candidate.score.toFixed(8)),
    lexicalRank: candidate.lexicalRank,
    vectorRank: candidate.vectorRank,
    chunkId: chunk.chunkId,
    claim: {
      claimId: chunk.claimId,
      topic: chunk.topic,
      legalStatus: chunk.legalStatus,
      proposition: chunk.proposition,
      supportRelation: chunk.supportRelation,
    },
    citation: {
      citationId: chunk.citationId,
      provisionId: chunk.provisionId,
      sourceVersionId: chunk.sourceVersionId,
      sourceVersionChecksumSha256: chunk.sourceVersionChecksumSha256,
      sourceDocumentId: chunk.sourceDocumentId,
      documentTitle: chunk.documentTitle,
      sourceType: chunk.sourceType,
      authorityId: chunk.authorityId,
      authorityName: chunk.authorityName,
      locator: chunk.locator,
      canonicalUrl: chunk.canonicalUrl,
      excerpt: chunk.excerptPermission === "ALLOWED" ? chunk.excerpt : null,
      excerptPermission: chunk.excerptPermission,
      sourcePublishedAt: chunk.sourcePublishedAt,
      sourceRetrievedAt: chunk.sourceRetrievedAt,
    },
    jurisdictionCode: chunk.jurisdictionCode,
    effectiveFrom: chunk.effectiveFrom,
    effectiveTo: chunk.effectiveTo,
    assuranceTier: chunk.assuranceTier,
    reviewStatus: chunk.reviewStatus,
  };
}

function hasMaterialConflict(hits: RankedEvidenceHit[]): boolean {
  const directTopics = new Set(
    hits
      .filter((hit) => hit.claim.supportRelation === "DIRECT_SUPPORT")
      .map((hit) => hit.claim.topic),
  );
  return hits.some(
    (hit) =>
      hit.claim.supportRelation === "CONTRADICTS" && directTopics.has(hit.claim.topic),
  );
}

function assuranceLimitations(tier: AssuranceTier): string[] {
  return tier === "PROVISIONAL"
    ? ["Provisional machine-assured evidence; not human-reviewed legal advice."]
    : ["Human-reviewed evidence retrieval; not legal advice."];
}

function assertStringArray(value: string[], name: string): void {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`filters.${name} must be a string array`);
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
