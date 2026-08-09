export const EVIDENCE_SEARCH_SCHEMA_VERSION = "1.0.0" as const;

export type AssuranceTier = "PROVISIONAL" | "HUMAN_REVIEWED";

export type EvidenceSearchStatus =
  | "SUCCESS"
  | "INSUFFICIENT_EVIDENCE"
  | "CONFLICTING_EVIDENCE"
  | "UNAUTHORIZED_EVIDENCE"
  | "STALE_INDEX"
  | "RETRIEVAL_UNAVAILABLE";

export type EvidenceSearchFilters = {
  jurisdictionCodes: string[];
  topics: string[];
  asOf: string;
  sourceTypes: string[];
  assuranceTier: AssuranceTier;
  corpusReleaseId: string | null;
  indexReleaseId: string | null;
};

export type EvidenceSearchRequest = {
  query: string;
  filters: EvidenceSearchFilters;
  topK: number;
};

export type RetrievalIndexRelease = {
  indexReleaseId: string;
  corpusReleaseId: string;
  assuranceTier: AssuranceTier;
  asOf: string;
  knowledgeCutoff: string;
  generatedAt: string;
  freshThrough: string;
  embeddingModel: string;
  embeddingModelVersion: string;
  embeddingDimensions: number;
  lexicalConfigVersion: string;
  vectorConfigVersion: string;
};

export type IndexedEvidenceChunk = {
  chunkId: string;
  indexReleaseId: string;
  corpusReleaseId: string;
  claimId: string;
  citationId: string;
  provisionId: string;
  sourceVersionId: string;
  sourceVersionChecksumSha256: string;
  sourceDocumentId: string;
  documentTitle: string;
  sourceType: string;
  authorityId: string;
  authorityName: string;
  jurisdictionCode: string;
  topic: string;
  supportRelation: "DIRECT_SUPPORT" | "INDIRECT_SUPPORT" | "CONTRADICTS";
  legalStatus: string;
  proposition: string;
  locator: string;
  canonicalUrl: string;
  languageCode: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  sourcePublishedAt: string | null;
  sourceRetrievedAt: string;
  assuranceTier: AssuranceTier;
  reviewStatus: "PROVISIONAL" | "HUMAN_REVIEWED";
  internalSearchAllowed: boolean;
  excerptPermission: "ALLOWED" | "LINK_ONLY";
  excerpt: string | null;
  searchText: string;
  embedding: number[];
};

export type RankedEvidenceHit = {
  rank: number;
  score: number;
  lexicalRank: number | null;
  vectorRank: number | null;
  chunkId: string;
  claim: {
    claimId: string;
    topic: string;
    legalStatus: string;
    proposition: string;
    supportRelation: IndexedEvidenceChunk["supportRelation"];
  };
  citation: {
    citationId: string;
    provisionId: string;
    sourceVersionId: string;
    sourceVersionChecksumSha256: string;
    sourceDocumentId: string;
    documentTitle: string;
    sourceType: string;
    authorityId: string;
    authorityName: string;
    locator: string;
    canonicalUrl: string;
    excerpt: string | null;
    excerptPermission: IndexedEvidenceChunk["excerptPermission"];
    sourcePublishedAt: string | null;
    sourceRetrievedAt: string;
  };
  jurisdictionCode: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  assuranceTier: AssuranceTier;
  reviewStatus: IndexedEvidenceChunk["reviewStatus"];
};

export type EvidenceSearchResponse = {
  schemaVersion: typeof EVIDENCE_SEARCH_SCHEMA_VERSION;
  runId: string;
  status: EvidenceSearchStatus;
  querySha256: string;
  indexRelease: RetrievalIndexRelease | null;
  hits: RankedEvidenceHit[];
  limitations: string[];
  explanation: null;
};

export type RetrievalRunAudit = {
  runId: string;
  querySha256: string;
  filters: EvidenceSearchFilters;
  indexReleaseId: string | null;
  corpusReleaseId: string | null;
  status: EvidenceSearchStatus;
  rankedChunkIds: string[];
  resultSha256: string;
};

export interface EvidenceRetrievalRepository {
  resolveIndex(filters: EvidenceSearchFilters): Promise<RetrievalIndexRelease | null>;
  listChunks(indexReleaseId: string): Promise<IndexedEvidenceChunk[]>;
  recordRun(run: RetrievalRunAudit): Promise<void>;
}

export interface QueryEmbeddingProvider {
  readonly model: string;
  readonly version: string;
  readonly dimensions: number;
  embed(text: string): Promise<number[]>;
}
