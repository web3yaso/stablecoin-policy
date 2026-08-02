/**
 * Presentation-safe mapping for provisional (machine-assured) public data.
 *
 * Every payload carries the mandatory envelope: assuranceLevel, reviewStatus,
 * confidence, asOf, source version + citations, limitations, counselTriggers.
 * `reviewStatus` can only become HUMAN_REVIEWED when the underlying view row
 * proves a named-human review record exists; the machine lane alone always
 * maps to PROVISIONAL. Rows come from the migration-0022 views, which expose
 * no reviewer identity, prompt text, or private rule data.
 */

export type ProvisionalClaimRow = {
  claim_id: string;
  jurisdiction_code: string;
  topic: string;
  proposition: string;
  legal_status: string;
  effective_from: string;
  effective_to: string | null;
  release_id: string;
  as_of: string;
  knowledge_cutoff: string;
  assurance_level: "PROVISIONAL_PUBLISHED";
  human_reviewed: boolean;
  confidence: number | null;
  limitations: string[];
  counsel_triggers: string[];
  source_version_id: string;
  source_checksum_sha256: string;
  source_retrieved_at: string;
  source_official_url: string;
  citations: Array<{ provisionId: string; locator: string }>;
};

export type ProvisionalClaimResponse = {
  schemaVersion: "1.0.0";
  claim: {
    claimId: string;
    jurisdictionCode: string;
    topic: string;
    proposition: string;
    legalStatus: string;
    effectiveFrom: string;
    effectiveTo: string | null;
  };
  releaseId: string;
  assuranceLevel: "PROVISIONAL_PUBLISHED";
  reviewStatus: "PROVISIONAL" | "HUMAN_REVIEWED";
  confidence: number | null;
  asOf: string;
  knowledgeCutoff: string;
  sourceVersion: {
    id: string;
    checksumSha256: string;
    retrievedAt: string;
    officialUrl: string;
  };
  citations: Array<{ provisionId: string; locator: string }>;
  limitations: string[];
  counselTriggers: string[];
};

export function toProvisionalClaimResponse(
  row: ProvisionalClaimRow,
): ProvisionalClaimResponse {
  return {
    schemaVersion: "1.0.0",
    claim: {
      claimId: row.claim_id,
      jurisdictionCode: row.jurisdiction_code,
      topic: row.topic,
      proposition: row.proposition,
      legalStatus: row.legal_status,
      effectiveFrom: row.effective_from,
      effectiveTo: row.effective_to,
    },
    releaseId: row.release_id,
    assuranceLevel: row.assurance_level,
    reviewStatus: row.human_reviewed ? "HUMAN_REVIEWED" : "PROVISIONAL",
    confidence: row.confidence,
    asOf: row.as_of,
    knowledgeCutoff: row.knowledge_cutoff,
    sourceVersion: {
      id: row.source_version_id,
      checksumSha256: row.source_checksum_sha256,
      retrievedAt: row.source_retrieved_at,
      officialUrl: row.source_official_url,
    },
    citations: row.citations,
    limitations: row.limitations,
    counselTriggers: row.counsel_triggers,
  };
}

export type ProvisionalCoverageRow = {
  jurisdiction_code: string;
  provisional_claim_count: number;
  latest_release_id: string;
  as_of: string;
  knowledge_cutoff: string;
  published_at: string;
};

export type ProvisionalCoverageResponse = {
  schemaVersion: "1.0.0";
  markets: Array<{
    jurisdictionCode: string;
    reviewStatus: "PROVISIONAL";
    provisionalClaimCount: number;
    latestReleaseId: string;
    asOf: string;
    knowledgeCutoff: string;
    publishedAt: string;
  }>;
};

/**
 * Provisional coverage deliberately has no completenessPercent: machine
 * publication can never claim reviewed completeness (that field belongs to
 * the named-human coverage workflow only).
 */
export function toProvisionalCoverageResponse(
  rows: ProvisionalCoverageRow[],
): ProvisionalCoverageResponse {
  return {
    schemaVersion: "1.0.0",
    markets: rows.map((row) => ({
      jurisdictionCode: row.jurisdiction_code,
      reviewStatus: "PROVISIONAL",
      provisionalClaimCount: row.provisional_claim_count,
      latestReleaseId: row.latest_release_id,
      asOf: row.as_of,
      knowledgeCutoff: row.knowledge_cutoff,
      publishedAt: row.published_at,
    })),
  };
}
