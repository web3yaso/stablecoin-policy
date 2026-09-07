export const LEGACY_LEXICAL_CONFIG_VERSIONS = new Set([
  "1",
  "websearch-en-v1",
]);

export const LEGACY_VECTOR_CONFIG_VERSIONS = new Set([
  "1",
  "cosine-rrf-v1",
]);

export const BM25_LEXICAL_CONFIG_V2 = {
  language: "english",
  method: "bm25",
  k1: 1.2,
  b: 0.75,
  weight: 0.1,
  version: "bm25-en-v2",
} as const;

export const WEIGHTED_VECTOR_CONFIG_V2 = {
  distance: "cosine",
  fusion: "weighted-rrf",
  rrfK: 60,
  weight: 1,
  version: "cosine-weighted-rrf-v2",
} as const;
