import type { SupabaseHttpClient } from "../data/supabase-client";

export type ClaimDraftBundle = {
  schemaVersion: "1.0.0";
  batchId: string;
  jurisdictionCode: string;
  claims: Array<Record<string, unknown> & { citations: Array<Record<string, unknown>> }>;
};

export type ClaimDraftPreflightEnvelope = {
  schemaVersion: "1.0.0";
  batchId: string;
  jurisdictionCode: string;
  manifestSha256: string;
  claimCount: number;
  citationCount: number;
  importReady: boolean;
  idempotentReplay: boolean;
  bundleErrors: string[];
  reviewEvidenceReady: boolean;
  legalValidityAssessed: false;
  claims: Array<{
    claimId: string;
    importReady: boolean;
    reviewEvidenceReady: boolean;
    importErrors: string[];
    reviewReadinessErrors: string[];
  }>;
};

export type ClaimDraftImportReadinessInput = {
  duplicateClaimIdCount: number;
  existingClaimIdCount: number;
  missingSupersedesCount: number;
  duplicateCitationIdCount: number;
  existingCitationIdCount: number;
  missingProvisionCount: number;
  unauthorizedExcerptCount: number;
};

export type ClaimDraftReviewReadinessInput = {
  missingProvisionCount: number;
  contradictionCount: number;
  unverifiedSourceCount: number;
  unknownPermissionCount: number;
  unauthorizedExcerptCount: number;
  directOfficialSupportCount: number;
};

export type ClaimDraftBundleReadinessInput = {
  batchManifestConflictCount: number;
};

const ID = /^[a-z0-9][a-z0-9._:-]{2,160}$/;
const PROVISION_ID = /^[a-z0-9][a-z0-9._:-]{2,200}$/;
const JURISDICTION = /^[A-Z][A-Z0-9-]{1,15}$/;
const STATUSES = new Set(["REQUIREMENT", "PERMISSION", "PROHIBITION", "EXEMPTION", "GUIDANCE", "UNDETERMINED"]);
const RELATIONS = new Set(["DIRECT_SUPPORT", "INDIRECT_SUPPORT", "CONTRADICTS"]);

export function assertClaimDraftBundle(input: unknown): asserts input is ClaimDraftBundle {
  if (!input || typeof input !== "object") throw new Error("claim draft bundle must be an object");
  const bundle = input as Record<string, unknown>;
  if (bundle.schemaVersion !== "1.0.0" || typeof bundle.batchId !== "string" || !ID.test(bundle.batchId)) throw new Error("claim draft bundle identity is invalid");
  if (typeof bundle.jurisdictionCode !== "string" || !JURISDICTION.test(bundle.jurisdictionCode)) throw new Error("claim draft jurisdiction is invalid");
  if (!Array.isArray(bundle.claims) || bundle.claims.length === 0) throw new Error("claim draft bundle requires claims");
  const claimIds = new Set<string>();
  const citationIds = new Set<string>();
  for (const claim of bundle.claims as Array<Record<string, unknown>>) {
    if (!claim || typeof claim !== "object" || "reviewState" in claim || "reviewedAt" in claim || "publishedAt" in claim) throw new Error("claim draft cannot set review or publication state");
    if (typeof claim.claimId !== "string" || !ID.test(claim.claimId) || claimIds.has(claim.claimId)) throw new Error("claim draft ID is invalid or duplicated");
    claimIds.add(claim.claimId);
    if (typeof claim.topic !== "string" || !claim.topic.trim() || typeof claim.proposition !== "string" || !claim.proposition.trim() || typeof claim.legalStatus !== "string" || !STATUSES.has(claim.legalStatus)) throw new Error("claim draft content is invalid");
    if (typeof claim.effectiveFrom !== "string" || !Number.isFinite(Date.parse(claim.effectiveFrom)) || typeof claim.knowledgeCutoff !== "string" || !Number.isFinite(Date.parse(claim.knowledgeCutoff))) throw new Error("claim draft dates are invalid");
    if (claim.effectiveTo !== null && (typeof claim.effectiveTo !== "string" || !Number.isFinite(Date.parse(claim.effectiveTo)))) throw new Error("claim draft effectiveTo is invalid");
    if (claim.supersedesClaimId !== null && (typeof claim.supersedesClaimId !== "string" || !ID.test(claim.supersedesClaimId))) throw new Error("claim draft supersedesClaimId is invalid");
    if (!Array.isArray(claim.actorTypes) || !claim.actorTypes.every(isString) || !Array.isArray(claim.activityCodes) || !claim.activityCodes.every(isString) || !Array.isArray(claim.citations) || claim.citations.length === 0) throw new Error("claim draft arrays are invalid");
    for (const citation of claim.citations as Array<Record<string, unknown>>) {
      if (typeof citation.citationId !== "string" || !ID.test(citation.citationId) || citationIds.has(citation.citationId)) throw new Error("claim draft citation ID is invalid or duplicated");
      citationIds.add(citation.citationId);
      if (typeof citation.provisionId !== "string" || !PROVISION_ID.test(citation.provisionId) || typeof citation.supportRelation !== "string" || !RELATIONS.has(citation.supportRelation) || typeof citation.exactLocator !== "string" || !citation.exactLocator.trim()) throw new Error("claim draft citation is invalid");
      if (citation.allowedExcerpt !== null && typeof citation.allowedExcerpt !== "string") throw new Error("claim draft allowedExcerpt is invalid");
    }
  }
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function claimDraftImportErrors(input: ClaimDraftImportReadinessInput): string[] {
  const errors: string[] = [];
  if (input.duplicateClaimIdCount > 0) errors.push("duplicate_claim_id");
  if (input.existingClaimIdCount > 0) errors.push("claim_id_exists");
  if (input.missingSupersedesCount > 0) errors.push("supersedes_claim_missing");
  if (input.duplicateCitationIdCount > 0) errors.push("duplicate_citation_id");
  if (input.existingCitationIdCount > 0) errors.push("citation_id_exists");
  if (input.missingProvisionCount > 0) errors.push("provision_missing");
  if (input.unauthorizedExcerptCount > 0) errors.push("unauthorized_excerpt");
  return errors;
}

export function claimDraftBundleErrors(input: ClaimDraftBundleReadinessInput): string[] {
  return input.batchManifestConflictCount > 0 ? ["batch_manifest_conflict"] : [];
}

export function claimDraftReviewReadinessErrors(
  input: ClaimDraftReviewReadinessInput,
): string[] {
  const errors: string[] = [];
  if (input.missingProvisionCount > 0) errors.push("provision_missing");
  if (input.contradictionCount > 0) errors.push("contradictory_evidence");
  if (input.unverifiedSourceCount > 0) errors.push("unverified_source");
  if (input.unknownPermissionCount > 0) errors.push("unknown_excerpt_permission");
  if (input.unauthorizedExcerptCount > 0) errors.push("unauthorized_excerpt");
  if (input.directOfficialSupportCount === 0) errors.push("direct_official_support_missing");
  return errors;
}

export class ClaimDraftImportClient {
  constructor(private readonly client: SupabaseHttpClient) {}
  async preflight(bundle: unknown): Promise<ClaimDraftPreflightEnvelope> {
    assertClaimDraftBundle(bundle);
    return this.client.rpc("preflight_legal_claim_draft_bundle", { p_bundle: bundle });
  }
  async import(bundle: unknown): Promise<Record<string, unknown>> {
    assertClaimDraftBundle(bundle);
    return this.client.rpc("import_legal_claim_draft_bundle", { p_bundle: bundle });
  }
}
