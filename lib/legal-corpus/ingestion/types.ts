export type OfficialSourceRegistryEntry = {
  sourceId: string;
  provider: "eur-lex";
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
  redistributionRights: "FULL_TEXT" | "EXCERPT" | "LINK_ONLY" | "UNKNOWN";
  licenceIdentifier: string | null;
  minimumProvisionCount: number;
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
};
