import { LEGAL_CORPUS_SCHEMA_VERSION } from "./types";

export type CoverageMarket = {
  jurisdictionCode: string;
  displayName: string;
  coverageState: "UNSUPPORTED" | "IN_PROGRESS" | "REVIEWED";
  completenessPercent: number;
  freshnessState: "CURRENT" | "STALE" | "UNKNOWN";
  reviewedAt: string | null;
  publicNote: string | null;
  corpusReleaseId: string | null;
  asOf: string | null;
  knowledgeCutoff: string | null;
  reviewedClaimCount: number;
  sourceDocumentCount: number;
  lastVerifiedAt: string | null;
};

export type CoverageResponse = {
  schemaVersion: typeof LEGAL_CORPUS_SCHEMA_VERSION;
  dataAsOf: string | null;
  markets: CoverageMarket[];
};

export type PublicSourceEvidence = {
  claimId: string;
  jurisdictionCode: string;
  topic: string;
  proposition: string;
  legalStatus: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  citationId: string;
  supportRelation: string;
  exactLocator: string;
  allowedExcerpt: string | null;
  provisionId: string;
  sourceVersionId: string;
  versionChecksumSha256: string;
  publishedAt: string | null;
  retrievedAt: string;
  verifiedAt: string | null;
};

export type PublicSourceResponse = {
  schemaVersion: typeof LEGAL_CORPUS_SCHEMA_VERSION;
  corpusReleaseId: string;
  authority: { authorityId: string; name: string };
  document: {
    documentId: string;
    title: string;
    documentType: string;
    canonicalUrl: string;
  };
  evidence: PublicSourceEvidence[];
};

export type PublicChange = {
  eventId: string;
  eventType: string;
  title: string;
  observedAt: string;
  effectiveAt: string | null;
  beforeVersionId: string | null;
  afterVersionId: string | null;
  authorityId: string;
  authorityName: string;
  claimId: string;
  impactType: string;
  jurisdictionCode: string;
  topic: string;
};

export type ChangesResponse = {
  schemaVersion: typeof LEGAL_CORPUS_SCHEMA_VERSION;
  changes: PublicChange[];
  nextCursor: string | null;
};
