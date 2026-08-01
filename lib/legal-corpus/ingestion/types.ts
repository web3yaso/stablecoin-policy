export type OfficialSourceRegistryEntry = {
  sourceId: string;
  provider: "eur-lex" | "hkel" | "sso";
  ingestionState?: "ACTIVE" | "BLOCKED";
  blocker?: string;
  authorityId: string;
  authorityName: string;
  authorityType:
    | "LEGISLATURE"
    | "REGULATOR"
    | "COURT"
    | "GOVERNMENT"
    | "OFFICIAL_REGISTER";
  jurisdictionCode: string;
  officialDomains: string[];
  documentId: string;
  officialDocumentId: string;
  documentType: string;
  title: string;
  canonicalUrl: string;
  fetchUrl: string;
  languageCode: string;
  versionLabel: string;
  publishedAt?: string;
  effectiveFrom?: string;
  redistributionRights: "FULL_TEXT" | "EXCERPT" | "LINK_ONLY" | "UNKNOWN";
  licenceIdentifier: string | null;
  minimumProvisionCount: number;
  archiveEntry?: string;
  expectedEmbeddedDocumentId?: string;
  expectedEmbeddedIdentifier?: string;
  ssoDocumentType?: "Act" | "SL";
  ssoDocumentNumber?: string;
  ssoProvisionKind?: "section" | "regulation" | "paragraph";
  ssoValidDate?: string;
  ssoPdfUrl?: string;
  ssoExpectedPdfChecksumSha256?: string;
};

export type ProvisionCandidate = {
  provisionId: string;
  locator: string;
  heading: string | null;
  languageCode: string;
  provisionText: string;
  textChecksumSha256: string;
  ordinal: number;
  excerptPermission: "ALLOWED" | "LINK_ONLY" | "UNKNOWN";
};

export type OfficialSourceSnapshot = {
  source: OfficialSourceRegistryEntry;
  body: Uint8Array;
  contentType: string;
  checksumSha256: string;
  retrievedAt: string;
  objectKey: string;
  objectId: string;
  versionId: string;
  provisions: ProvisionCandidate[];
  retrievalMetadata: Record<string, unknown>;
};
