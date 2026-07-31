import type { ReportMeta } from "../data/report-types";

export type PublicReport = {
  slug: string;
  title: string;
  title_en?: string;
  summary: string;
  category: string;
  jurisdiction: string[];
  publishedAt: string;
  wordCount: number;
  priceUSD: number;
  fullContentUrl: string;
};

export type ReportListResponse = {
  schemaVersion: "1.0.0";
  reports: PublicReport[];
  total: number;
  lastUpdated: string;
};

export function createReportListResponse(
  reports: ReportMeta[],
  origin: string,
  fallbackTime = new Date(),
): ReportListResponse {
  const baseUrl = new URL(origin);
  const publicReports = reports.map((report) => toPublicReport(report, baseUrl));
  const lastUpdated =
    reports
      .map((report) => Date.parse(report.publishedAt))
      .filter(Number.isFinite)
      .sort((a, b) => b - a)[0] ?? fallbackTime.getTime();

  return {
    schemaVersion: "1.0.0",
    reports: publicReports,
    total: publicReports.length,
    lastUpdated: new Date(lastUpdated).toISOString(),
  };
}

function toPublicReport(report: ReportMeta, baseUrl: URL): PublicReport {
  return {
    slug: report.slug,
    title: report.title,
    ...(report.title_en ? { title_en: report.title_en } : {}),
    summary: report.summary,
    category: report.category,
    jurisdiction: [...report.jurisdiction],
    publishedAt: report.publishedAt,
    wordCount: report.wordCount,
    priceUSD: report.priceUSD,
    fullContentUrl: new URL(`/api/reports/${report.slug}`, baseUrl).toString(),
  };
}
