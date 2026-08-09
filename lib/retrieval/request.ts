import type { AssuranceTier, EvidenceSearchRequest } from "./contracts";

const REQUEST_KEYS = new Set(["query", "filters", "topK"]);
const FILTER_KEYS = new Set([
  "jurisdictionCodes",
  "topics",
  "asOf",
  "sourceTypes",
  "assuranceTier",
  "corpusReleaseId",
  "indexReleaseId",
]);

export function parseEvidenceSearchRequest(input: unknown): EvidenceSearchRequest | null {
  if (!isRecord(input) || hasUnknownKeys(input, REQUEST_KEYS)) return null;
  if (typeof input.query !== "string" || !isRecord(input.filters)) return null;
  const query = input.query.trim();
  if (query.length < 1 || query.length > 2_000) return null;
  if (hasUnknownKeys(input.filters, FILTER_KEYS)) return null;
  const filters = input.filters;
  if (
    !isStringArray(filters.jurisdictionCodes) ||
    !isStringArray(filters.topics) ||
    typeof filters.asOf !== "string" ||
    Number.isNaN(Date.parse(filters.asOf)) ||
    !isStringArray(filters.sourceTypes) ||
    !isAssuranceTier(filters.assuranceTier) ||
    !isNullableString(filters.corpusReleaseId) ||
    !isNullableString(filters.indexReleaseId)
  ) return null;
  const topK = input.topK === undefined ? 10 : input.topK;
  if (
    typeof topK !== "number" ||
    !Number.isInteger(topK) ||
    topK < 1 ||
    topK > 10
  ) return null;
  return {
    query,
    filters: {
      jurisdictionCodes: filters.jurisdictionCodes,
      topics: filters.topics,
      asOf: filters.asOf,
      sourceTypes: filters.sourceTypes,
      assuranceTier: filters.assuranceTier,
      corpusReleaseId: filters.corpusReleaseId,
      indexReleaseId: filters.indexReleaseId,
    },
    topK,
  };
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

function hasUnknownKeys(input: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(input).some((key) => !allowed.has(key));
}

function isStringArray(input: unknown): input is string[] {
  return Array.isArray(input) && input.every((item) => typeof item === "string");
}

function isNullableString(input: unknown): input is string | null {
  return input === null || typeof input === "string";
}

function isAssuranceTier(input: unknown): input is AssuranceTier {
  return input === "PROVISIONAL" || input === "HUMAN_REVIEWED";
}
