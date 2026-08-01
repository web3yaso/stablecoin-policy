import { SupabaseHttpClient } from "../data/supabase-client";
import type {
  ChangesResponse,
  CoverageMarket,
  CoverageResponse,
  PublicChange,
  PublicSourceEvidence,
  PublicSourceResponse,
} from "./public-contracts";
import type { PublicLegalCorpusRepository } from "./public-repository";
import { LEGAL_CORPUS_SCHEMA_VERSION } from "./types";

type CoverageRow = {
  jurisdiction_code: string;
  display_name: string;
  coverage_state: CoverageMarket["coverageState"];
  completeness_percent: number;
  freshness_state: CoverageMarket["freshnessState"];
  reviewed_at: string | null;
  public_note: string | null;
  release_id: string | null;
  as_of: string | null;
  knowledge_cutoff: string | null;
  reviewed_claim_count: number;
  source_document_count: number;
  last_verified_at: string | null;
};

type EvidenceRow = {
  release_id: string;
  claim_id: string;
  jurisdiction_code: string;
  topic: string;
  proposition: string;
  legal_status: string;
  effective_from: string;
  effective_to: string | null;
  citation_id: string;
  support_relation: string;
  exact_locator: string;
  allowed_excerpt: string | null;
  provision_id: string;
  version_id: string;
  version_checksum_sha256: string;
  published_at: string | null;
  retrieved_at: string;
  verified_at: string | null;
  document_id: string;
  document_title: string;
  document_type: string;
  canonical_url: string;
  authority_id: string;
  authority_name: string;
};

type ChangeRow = {
  event_id: string;
  event_type: string;
  title: string;
  observed_at: string;
  effective_at: string | null;
  before_version_id: string | null;
  after_version_id: string | null;
  authority_id: string;
  authority_name: string;
  claim_id: string;
  impact_type: string;
  jurisdiction_code: string;
  topic: string;
};

const CHANGE_PAGE_SIZE = 100;

export class SupabasePublicLegalCorpusRepository
  implements PublicLegalCorpusRepository
{
  constructor(private readonly client: SupabaseHttpClient) {}

  async getCoverage(): Promise<CoverageResponse> {
    const rows = await this.client.rest<CoverageRow[]>(
      "public_coverage?select=*&order=jurisdiction_code.asc",
    );
    const markets = rows.map(mapCoverage);
    const dataAsOf = latest(markets.map((market) => market.knowledgeCutoff));
    return { schemaVersion: LEGAL_CORPUS_SCHEMA_VERSION, dataAsOf, markets };
  }

  async findSource(documentId: string): Promise<PublicSourceResponse | null> {
    assertIdentifier(documentId, "documentId");
    const query = new URLSearchParams({
      select: "*",
      document_id: `eq.${documentId}`,
      order: "as_of.desc,release_knowledge_cutoff.desc,release_id.desc,effective_from.desc,citation_id.asc",
    });
    const rows = await this.client.rest<EvidenceRow[]>(
      `public_corpus_claims?${query.toString()}`,
    );
    if (rows.length === 0) return null;
    const first = rows[0];
    const releaseRows = rows.filter((row) => row.release_id === first.release_id);
    return {
      schemaVersion: LEGAL_CORPUS_SCHEMA_VERSION,
      corpusReleaseId: first.release_id,
      authority: {
        authorityId: first.authority_id,
        name: first.authority_name,
      },
      document: {
        documentId: first.document_id,
        title: first.document_title,
        documentType: first.document_type,
        canonicalUrl: first.canonical_url,
      },
      evidence: releaseRows.map(mapEvidence),
    };
  }

  async listChanges(afterCursor?: string): Promise<ChangesResponse> {
    const after = afterCursor ? decodeCursor(afterCursor) : null;
    const query = new URLSearchParams({
      select: "*",
      order: "observed_at.asc,event_id.asc",
      limit: String(CHANGE_PAGE_SIZE + 1),
      ...(after
        ? {
            or: `(observed_at.gt.${after.observedAt},and(observed_at.eq.${after.observedAt},event_id.gt.${after.eventId}))`,
          }
        : {}),
    });
    const rows = await this.client.rest<ChangeRow[]>(
      `public_regulatory_changes?${query.toString()}`,
    );
    const filtered = after
      ? rows.filter(
          (row) =>
            row.observed_at > after.observedAt ||
            (row.observed_at === after.observedAt && row.event_id > after.eventId),
        )
      : rows;
    const page = filtered.slice(0, CHANGE_PAGE_SIZE);
    const last = page.at(-1);
    return {
      schemaVersion: LEGAL_CORPUS_SCHEMA_VERSION,
      changes: page.map(mapChange),
      nextCursor:
        filtered.length > CHANGE_PAGE_SIZE && last
          ? encodeCursor(last.observed_at, last.event_id)
          : null,
    };
  }
}

function mapCoverage(row: CoverageRow): CoverageMarket {
  return {
    jurisdictionCode: row.jurisdiction_code,
    displayName: row.display_name,
    coverageState: row.coverage_state,
    completenessPercent: Number(row.completeness_percent),
    freshnessState: row.freshness_state,
    reviewedAt: canonicalTime(row.reviewed_at),
    publicNote: row.public_note,
    corpusReleaseId: row.release_id,
    asOf: canonicalTime(row.as_of),
    knowledgeCutoff: canonicalTime(row.knowledge_cutoff),
    reviewedClaimCount: Number(row.reviewed_claim_count),
    sourceDocumentCount: Number(row.source_document_count),
    lastVerifiedAt: canonicalTime(row.last_verified_at),
  };
}

function mapEvidence(row: EvidenceRow): PublicSourceEvidence {
  return {
    claimId: row.claim_id,
    jurisdictionCode: row.jurisdiction_code,
    topic: row.topic,
    proposition: row.proposition,
    legalStatus: row.legal_status,
    effectiveFrom: canonicalTime(row.effective_from)!,
    effectiveTo: canonicalTime(row.effective_to),
    citationId: row.citation_id,
    supportRelation: row.support_relation,
    exactLocator: row.exact_locator,
    allowedExcerpt: row.allowed_excerpt,
    provisionId: row.provision_id,
    sourceVersionId: row.version_id,
    versionChecksumSha256: row.version_checksum_sha256,
    publishedAt: canonicalTime(row.published_at),
    retrievedAt: canonicalTime(row.retrieved_at)!,
    verifiedAt: canonicalTime(row.verified_at),
  };
}

function mapChange(row: ChangeRow): PublicChange {
  return {
    eventId: row.event_id,
    eventType: row.event_type,
    title: row.title,
    observedAt: canonicalTime(row.observed_at)!,
    effectiveAt: canonicalTime(row.effective_at),
    beforeVersionId: row.before_version_id,
    afterVersionId: row.after_version_id,
    authorityId: row.authority_id,
    authorityName: row.authority_name,
    claimId: row.claim_id,
    impactType: row.impact_type,
    jurisdictionCode: row.jurisdiction_code,
    topic: row.topic,
  };
}

function latest(values: Array<string | null>): string | null {
  return values.filter((value): value is string => value !== null).sort().at(-1) ?? null;
}

function canonicalTime(value: string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

function assertIdentifier(value: string, name: string): void {
  if (!/^[a-z0-9][a-z0-9._:-]{2,160}$/.test(value)) {
    throw new Error(`${name} is invalid`);
  }
}

function encodeCursor(observedAt: string, eventId: string): string {
  return Buffer.from(JSON.stringify({ observedAt, eventId }), "utf8").toString("base64url");
}

function decodeCursor(cursor: string): { observedAt: string; eventId: string } {
  if (cursor.length > 512) throw new Error("after_cursor is invalid");
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      observedAt?: unknown;
      eventId?: unknown;
    };
    if (
      typeof parsed.observedAt !== "string" ||
      !Number.isFinite(Date.parse(parsed.observedAt)) ||
      typeof parsed.eventId !== "string"
    ) {
      throw new Error("invalid payload");
    }
    assertIdentifier(parsed.eventId, "eventId");
    return { observedAt: new Date(parsed.observedAt).toISOString(), eventId: parsed.eventId };
  } catch {
    throw new Error("after_cursor is invalid");
  }
}
