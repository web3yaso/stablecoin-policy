import { createHash } from "node:crypto";
import { replayChecksum } from "../legal-corpus/machine-pipeline";
import type { QueryEmbeddingProvider } from "./contracts";

export type RetrievalCorpusKind = "PROVISIONAL" | "HUMAN_REVIEWED";

export type RetrievalIndexBuildSource = {
  claimId: string;
  citationId: string;
  provisionId: string;
  sourceVersionId: string;
  sourceVersionChecksumSha256: string;
  jurisdictionCode: string;
  languageCode: string;
  supportRelation: "DIRECT_SUPPORT" | "INDIRECT_SUPPORT" | "CONTRADICTS";
  locator: string;
  provisionText: string | null;
  storageRights: string;
  rightsReviewedAt: string | null;
  rightsBasis: string | null;
  excerptPermission: string;
  internalSearchAllowed: boolean;
};

export type RetrievalIndexBuildInput = {
  schemaVersion: "1.0.0";
  policyDomain: string;
  corpusReleaseId: string;
  corpusReleaseKind: RetrievalCorpusKind;
  assuranceTier: RetrievalCorpusKind;
  jurisdictionCode: string | null;
  asOf: string;
  knowledgeCutoff: string;
  releaseManifestSha256: string;
  claimIds: string[];
  sources: RetrievalIndexBuildSource[];
};

export type RetrievalIndexBuildConfig = {
  indexReleaseId: string;
  policyDomain: string;
  expectedJurisdictionCode: string;
  freshThrough: string;
  lexicalConfig: Record<string, unknown>;
  vectorConfig: Record<string, unknown>;
};

export type RetrievalIndexPlanChunk = {
  ordinal: number;
  chunkId: string;
  claimId: string;
  citationId: string;
  provisionId: string;
  sourceVersionId: string;
  languageCode: string;
  chunkText: string;
  chunkChecksumSha256: string;
  excerptPermission: "ALLOWED" | "LINK_ONLY";
  embeddingId: string;
  embeddingModel: string;
  embeddingModelVersion: string;
  embeddingDimensions: number;
  embedding: number[];
  embeddingChecksumSha256: string;
};

export type RetrievalIndexPlan = {
  schemaVersion: "1.0.0";
  indexReleaseId: string;
  policyDomain: string;
  corpusReleaseId: string;
  corpusReleaseKind: RetrievalCorpusKind;
  freshThrough: string;
  lexicalConfig: Record<string, unknown>;
  vectorConfig: Record<string, unknown>;
  embeddingModel: string;
  embeddingModelVersion: string;
  embeddingDimensions: number;
  chunks: RetrievalIndexPlanChunk[];
};

export type RetrievalIndexManifestPreview = {
  schemaVersion: "1.0.0";
  indexReleaseId: string;
  policyDomain: string;
  corpusReleaseId: string;
  corpusReleaseKind: RetrievalCorpusKind;
  assuranceTier: RetrievalCorpusKind;
  asOf: string;
  knowledgeCutoff: string;
  freshThrough: string;
  lexicalConfig: Record<string, unknown>;
  vectorConfig: Record<string, unknown>;
  embeddingModel: string;
  embeddingModelVersion: string;
  embeddingDimensions: number;
  chunks: Array<Omit<RetrievalIndexPlanChunk, "languageCode" | "chunkText" | "embeddingModel" | "embeddingModelVersion" | "embeddingDimensions" | "embedding">>;
};

const ID = /^[a-z0-9][a-z0-9._:-]{2,200}$/;
const SHA256 = /^[0-9a-f]{64}$/;

export function retrievalIndexBuildInputErrors(
  input: RetrievalIndexBuildInput,
  config: RetrievalIndexBuildConfig,
): string[] {
  const errors: string[] = [];
  if (input.schemaVersion !== "1.0.0") errors.push("SCHEMA_VERSION_UNSUPPORTED");
  if (!ID.test(input.corpusReleaseId) || !ID.test(config.indexReleaseId)) {
    errors.push("IDENTIFIER_INVALID");
  }
  if (input.policyDomain !== config.policyDomain || input.policyDomain !== "stablecoin") {
    errors.push("POLICY_DOMAIN_MISMATCH");
  }
  if (input.corpusReleaseKind !== input.assuranceTier) {
    errors.push("ASSURANCE_TIER_MISMATCH");
  }
  if (input.jurisdictionCode !== config.expectedJurisdictionCode) {
    errors.push("JURISDICTION_MISMATCH");
  }
  const asOf = Date.parse(input.asOf);
  const cutoff = Date.parse(input.knowledgeCutoff);
  const freshThrough = Date.parse(config.freshThrough);
  if (![asOf, cutoff, freshThrough].every(Number.isFinite)) {
    errors.push("TIMESTAMP_INVALID");
  } else {
    if (cutoff < asOf) errors.push("KNOWLEDGE_CUTOFF_INVALID");
    if (freshThrough < asOf) errors.push("FRESH_THROUGH_INVALID");
  }
  if (!SHA256.test(input.releaseManifestSha256)) {
    errors.push("CORPUS_MANIFEST_INVALID");
  }
  if (input.claimIds.length === 0) errors.push("CORPUS_MEMBERSHIP_EMPTY");
  if (new Set(input.claimIds).size !== input.claimIds.length) {
    errors.push("CORPUS_MEMBERSHIP_DUPLICATE");
  }
  if (input.sources.length === 0) errors.push("CITATION_MEMBERSHIP_EMPTY");

  const claimIds = new Set(input.claimIds);
  const coveredClaims = new Set<string>();
  const citationIds = new Set<string>();
  for (const source of input.sources) {
    if (!claimIds.has(source.claimId)) errors.push("CROSS_RELEASE_CLAIM");
    coveredClaims.add(source.claimId);
    if (citationIds.has(source.citationId)) errors.push("CITATION_DUPLICATE");
    citationIds.add(source.citationId);
    if (
      !ID.test(source.claimId) ||
      !ID.test(source.citationId) ||
      !ID.test(source.provisionId) ||
      !ID.test(source.sourceVersionId) ||
      !SHA256.test(source.sourceVersionChecksumSha256)
    ) errors.push("SOURCE_IDENTITY_INVALID");
    if (source.jurisdictionCode !== config.expectedJurisdictionCode) {
      errors.push("JURISDICTION_MISMATCH");
    }
    if (
      source.storageRights !== "ALLOWED" ||
      source.rightsReviewedAt === null ||
      !source.rightsBasis?.trim() ||
      !source.internalSearchAllowed
    ) errors.push("INTERNAL_SEARCH_RIGHTS_BLOCKED");
    if (source.excerptPermission !== "ALLOWED" && source.excerptPermission !== "LINK_ONLY") {
      errors.push("EXCERPT_PERMISSION_BLOCKED");
    }
    if (!source.provisionText?.trim()) errors.push("PROVISION_TEXT_MISSING");
    if (!source.languageCode.trim() || !source.locator.trim()) {
      errors.push("CITATION_METADATA_INCOMPLETE");
    }
  }
  if (input.claimIds.some((claimId) => !coveredClaims.has(claimId))) {
    errors.push("CLAIM_WITHOUT_CITATION");
  }
  return [...new Set(errors)].sort();
}

export async function buildRetrievalIndexPlan(
  input: RetrievalIndexBuildInput,
  config: RetrievalIndexBuildConfig,
  embeddingProvider: QueryEmbeddingProvider,
): Promise<RetrievalIndexPlan> {
  const errors = retrievalIndexBuildInputErrors(input, config);
  if (errors.length > 0) {
    throw new Error(`retrieval index build input invalid: ${errors.join(", ")}`);
  }
  const sources = [...input.sources].sort(compareSources);
  const chunks: RetrievalIndexPlanChunk[] = [];
  for (const [ordinal, source] of sources.entries()) {
    const chunkText = normalizeProvisionText(source.provisionText as string);
    const identity = replayChecksum({
      policyDomain: input.policyDomain,
      corpusReleaseId: input.corpusReleaseId,
      claimId: source.claimId,
      citationId: source.citationId,
      provisionId: source.provisionId,
      sourceVersionId: source.sourceVersionId,
      chunkText,
    });
    const chunkId = `chunk:${identity.slice(0, 40)}`;
    const embedding = await embeddingProvider.embed(chunkText);
    if (
      embedding.length !== embeddingProvider.dimensions ||
      embedding.some((value) => !Number.isFinite(value))
    ) throw new Error(`embedding invalid for ${source.citationId}`);
    const embeddingChecksumSha256 = replayChecksum(embedding);
    chunks.push({
      ordinal,
      chunkId,
      claimId: source.claimId,
      citationId: source.citationId,
      provisionId: source.provisionId,
      sourceVersionId: source.sourceVersionId,
      languageCode: source.languageCode,
      chunkText,
      chunkChecksumSha256: sha256Text(chunkText),
      excerptPermission: source.excerptPermission as "ALLOWED" | "LINK_ONLY",
      embeddingId: `embedding:${replayChecksum({
        chunkId,
        model: embeddingProvider.model,
        version: embeddingProvider.version,
        dimensions: embeddingProvider.dimensions,
        embeddingChecksumSha256,
      }).slice(0, 40)}`,
      embeddingModel: embeddingProvider.model,
      embeddingModelVersion: embeddingProvider.version,
      embeddingDimensions: embeddingProvider.dimensions,
      embedding,
      embeddingChecksumSha256,
    });
  }
  return {
    schemaVersion: "1.0.0",
    indexReleaseId: config.indexReleaseId,
    policyDomain: config.policyDomain,
    corpusReleaseId: input.corpusReleaseId,
    corpusReleaseKind: input.corpusReleaseKind,
    freshThrough: new Date(config.freshThrough).toISOString(),
    lexicalConfig: config.lexicalConfig,
    vectorConfig: config.vectorConfig,
    embeddingModel: embeddingProvider.model,
    embeddingModelVersion: embeddingProvider.version,
    embeddingDimensions: embeddingProvider.dimensions,
    chunks,
  };
}

export function previewRetrievalIndexManifest(
  input: RetrievalIndexBuildInput,
  plan: RetrievalIndexPlan,
): RetrievalIndexManifestPreview {
  return {
    schemaVersion: "1.0.0",
    indexReleaseId: plan.indexReleaseId,
    policyDomain: plan.policyDomain,
    corpusReleaseId: plan.corpusReleaseId,
    corpusReleaseKind: plan.corpusReleaseKind,
    assuranceTier: input.assuranceTier,
    asOf: new Date(input.asOf).toISOString(),
    knowledgeCutoff: new Date(input.knowledgeCutoff).toISOString(),
    freshThrough: plan.freshThrough,
    lexicalConfig: plan.lexicalConfig,
    vectorConfig: plan.vectorConfig,
    embeddingModel: plan.embeddingModel,
    embeddingModelVersion: plan.embeddingModelVersion,
    embeddingDimensions: plan.embeddingDimensions,
    chunks: plan.chunks.map((chunk) => ({
      ordinal: chunk.ordinal,
      chunkId: chunk.chunkId,
      claimId: chunk.claimId,
      citationId: chunk.citationId,
      provisionId: chunk.provisionId,
      sourceVersionId: chunk.sourceVersionId,
      chunkChecksumSha256: chunk.chunkChecksumSha256,
      excerptPermission: chunk.excerptPermission,
      embeddingId: chunk.embeddingId,
      embeddingChecksumSha256: chunk.embeddingChecksumSha256,
    })),
  };
}

export function retrievalIndexPlanSha256(plan: RetrievalIndexPlan): string {
  return replayChecksum(plan);
}

function normalizeProvisionText(text: string): string {
  return text.replace(/\r\n?/g, "\n").trim();
}

function sha256Text(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function compareSources(a: RetrievalIndexBuildSource, b: RetrievalIndexBuildSource): number {
  return a.claimId.localeCompare(b.claimId)
    || a.citationId.localeCompare(b.citationId)
    || a.provisionId.localeCompare(b.provisionId)
    || a.sourceVersionId.localeCompare(b.sourceVersionId);
}
