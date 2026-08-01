import type {
  LegalClaim,
  PublicationDecision,
  SourceDocumentCandidate,
} from "./types";

type DiscoveryItem = {
  id: string;
  source: string;
  date: string;
  url: string;
  sourceId?: string;
  sourceType?: "official-api" | "official-feed";
  sourceAuthority?: string;
  officialDocumentId?: string;
  sourceVersion?: string;
  documentType?: string;
  retrievedAt?: string;
};

/**
 * The existing news pipeline is a discovery queue, even when its upstream is
 * an official API. A candidate is not legal evidence until the immutable raw
 * source and an addressable provision have been captured and reviewed.
 */
export function toSourceDocumentCandidate(
  item: DiscoveryItem,
): SourceDocumentCandidate {
  const retrievedAt = item.retrievedAt ?? item.date;
  assertDateTime(retrievedAt, "retrievedAt");

  const canonicalUrl = new URL(item.url).toString();
  return {
    candidateId: item.id,
    authorityName: item.sourceAuthority ?? item.source,
    ...(item.officialDocumentId
      ? { officialDocumentId: item.officialDocumentId }
      : {}),
    documentType: item.documentType ?? "official-document-candidate",
    canonicalUrl,
    ...(item.sourceVersion ? { versionLabel: item.sourceVersion } : {}),
    ...(isDateTime(item.date) ? { publishedAt: item.date } : {}),
    retrievedAt,
    evidenceLayer: "NEWS_DISCOVERY",
    evidenceUse: "DISCOVERY_ONLY",
  };
}

export function evaluateClaimPublication(
  claim: LegalClaim,
): PublicationDecision {
  if (claim.reviewState !== "REVIEWED" && claim.reviewState !== "PUBLISHED") {
    return { publishable: false, reason: "CLAIM_NOT_REVIEWED" };
  }

  const start = Date.parse(claim.effectiveFrom);
  const end = claim.effectiveTo ? Date.parse(claim.effectiveTo) : undefined;
  if (!Number.isFinite(start) || (end !== undefined && (!Number.isFinite(end) || end <= start))) {
    return { publishable: false, reason: "INVALID_EFFECTIVE_INTERVAL" };
  }

  if (claim.citations.length === 0) {
    return { publishable: false, reason: "NO_PROVISION_CITATION" };
  }
  if (claim.citations.some((citation) => citation.relation === "CONTRADICTS")) {
    return { publishable: false, reason: "CONFLICTING_EVIDENCE" };
  }
  if (
    claim.legalStatus === "PERMISSION" &&
    !claim.citations.some(
      ({ relation, evidence }) =>
        relation === "DIRECT_SUPPORT" &&
        evidence.evidenceLayer === "OFFICIAL_SOURCE" &&
        evidence.evidenceUse === "LEGAL_AUTHORITY" &&
        evidence.locator.trim().length > 0,
    )
  ) {
    return {
      publishable: false,
      reason: "NON_AUTHORITATIVE_PERMISSION_EVIDENCE",
    };
  }

  return { publishable: true };
}

export function claimAppliesAsOf(claim: LegalClaim, asOf: string): boolean {
  const at = dateOnlyTimestamp(asOf);
  const from = dateOnlyTimestamp(claim.effectiveFrom);
  const to = claim.effectiveTo
    ? dateOnlyTimestamp(claim.effectiveTo)
    : Number.POSITIVE_INFINITY;
  return at >= from && at < to;
}

function dateOnlyTimestamp(value: string): number {
  const parsed = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value);
  if (!Number.isFinite(parsed)) throw new Error(`invalid date: ${value}`);
  return parsed;
}

function isDateTime(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function assertDateTime(value: string, field: string): void {
  if (!isDateTime(value)) throw new Error(`${field} must be a valid date-time`);
}
