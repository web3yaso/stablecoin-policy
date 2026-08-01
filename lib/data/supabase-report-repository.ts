import type { ReportMetadataRepository } from "./contracts";
import { canonicalIsoTimestamp } from "./integrity";
import { parseReportMeta, type ReportMeta } from "./report-types";
import { SupabaseHttpClient } from "./supabase-client";

type ReportCatalogRow = {
  slug: string;
  title: string;
  title_en: string | null;
  summary: string;
  category: string;
  jurisdictions: unknown;
  published_at: string;
  word_count: number;
  price_usd: number | string;
  encrypted_content_file: string;
  artifact_key: string;
  artifact_checksum_sha256: string;
  source_url: string | null;
};

export class SupabaseReportRepository implements ReportMetadataRepository {
  constructor(private readonly client: SupabaseHttpClient) {}

  async listReports(): Promise<ReportMeta[]> {
    const query = new URLSearchParams({
      select: "*",
      order: "published_at.desc",
    });
    const rows = await this.client.rest<unknown>(
      `active_report_catalog?${query}`,
    );
    if (!Array.isArray(rows)) {
      throw new Error("Supabase active_report_catalog must return an array");
    }
    return rows.map((row) => parseReportCatalogRow(row));
  }

  async findReportBySlug(slug: string): Promise<ReportMeta | null> {
    const query = new URLSearchParams({
      select: "*",
      slug: `eq.${slug}`,
      limit: "1",
    });
    const rows = await this.client.rest<unknown>(
      `active_report_catalog?${query}`,
    );
    if (!Array.isArray(rows)) {
      throw new Error("Supabase active_report_catalog must return an array");
    }
    return rows.length === 0 ? null : parseReportCatalogRow(rows[0]);
  }
}

function parseReportCatalogRow(value: unknown): ReportMeta {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("invalid active_report_catalog row");
  }
  const row = value as Partial<ReportCatalogRow>;
  const priceUSD =
    typeof row.price_usd === "string" ? Number(row.price_usd) : row.price_usd;

  return parseReportMeta({
    slug: row.slug,
    title: row.title,
    ...(row.title_en ? { title_en: row.title_en } : {}),
    summary: row.summary,
    category: row.category,
    jurisdiction: row.jurisdictions,
    publishedAt: canonicalIsoTimestamp(row.published_at, "published_at"),
    wordCount: row.word_count,
    priceUSD,
    encryptedContentFile: row.encrypted_content_file,
    artifactKey: row.artifact_key,
    artifactChecksumSha256: row.artifact_checksum_sha256,
    ...(row.source_url ? { sourceUrl: row.source_url } : {}),
  });
}
