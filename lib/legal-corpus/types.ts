export const LEGAL_CORPUS_SCHEMA_VERSION = "1.0.0" as const;

export type EvidenceLayer =
  | "OFFICIAL_SOURCE"
  | "RESEARCH_CONTEXT"
  | "NEWS_DISCOVERY";

export type EvidenceUse =
  | "LEGAL_AUTHORITY"
  | "SECONDARY_CONTEXT"
  | "DISCOVERY_ONLY";

export type ClaimReviewState =
  | "DRAFT"
  | "IN_REVIEW"
  | "REVIEWED"
  | "PUBLISHED"
  | "SUPERSEDED"
  | "RETRACTED";

export type ClaimLegalStatus =
  | "REQUIREMENT"
  | "PERMISSION"
  | "PROHIBITION"
  | "EXEMPTION"
  | "GUIDANCE"
  | "UNDETERMINED";

export type CitationSupport =
  | "DIRECT_SUPPORT"
  | "INDIRECT_SUPPORT"
  | "CONTRADICTS";

export type SourceDocumentCandidate = {
  candidateId: string;
  authorityName: string;
  officialDocumentId?: string;
  documentType: string;
  canonicalUrl: string;
  versionLabel?: string;
  publishedAt?: string;
  retrievedAt: string;
  evidenceLayer: EvidenceLayer;
  evidenceUse: EvidenceUse;
};

export type ProvisionEvidence = {
  provisionId: string;
  sourceVersionId: string;
  authorityId: string;
  locator: string;
  canonicalUrl: string;
  evidenceLayer: EvidenceLayer;
  evidenceUse: EvidenceUse;
  versionChecksumSha256: string;
};

export type ClaimCitation = {
  citationId: string;
  relation: CitationSupport;
  evidence: ProvisionEvidence;
};

export type LegalClaim = {
  claimId: string;
  jurisdictionCode: string;
  topic: string;
  proposition: string;
  legalStatus: ClaimLegalStatus;
  reviewState: ClaimReviewState;
  effectiveFrom: string;
  effectiveTo?: string;
  knowledgeCutoff: string;
  citations: ClaimCitation[];
};

export type PublicationDecision =
  | { publishable: true }
  | {
      publishable: false;
      reason:
        | "CLAIM_NOT_REVIEWED"
        | "NO_PROVISION_CITATION"
        | "CONFLICTING_EVIDENCE"
        | "NON_AUTHORITATIVE_PERMISSION_EVIDENCE"
        | "INVALID_EFFECTIVE_INTERVAL";
    };

