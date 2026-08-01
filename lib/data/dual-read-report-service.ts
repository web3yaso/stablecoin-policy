import { DataParityError } from "./external-storage-errors";
import { stableJson } from "./integrity";
import type { ReportReader } from "./report-service";
import type { Report, ReportMeta } from "./report-types";

type DualReadOptions = {
  strict?: boolean;
  onIssue?: (error: Error) => void;
};

export class DualReadReportService implements ReportReader {
  private readonly strict: boolean;
  private readonly onIssue: (error: Error) => void;

  constructor(
    private readonly primary: ReportReader,
    private readonly secondary: ReportReader,
    options: DualReadOptions = {},
  ) {
    this.strict = options.strict ?? false;
    this.onIssue = options.onIssue ?? ((error) => console.warn(error.message));
  }

  async listReports(): Promise<ReportMeta[]> {
    return this.compare(
      "report catalog",
      () => this.primary.listReports(),
      () => this.secondary.listReports(),
      normalizeReportList,
    );
  }

  async getReportMetaBySlug(slug: string): Promise<ReportMeta | null> {
    return this.compare(
      `report metadata ${slug}`,
      () => this.primary.getReportMetaBySlug(slug),
      () => this.secondary.getReportMetaBySlug(slug),
      normalizeReportMeta,
    );
  }

  async getReportBySlug(slug: string): Promise<Report | null> {
    return this.compare(
      `report content ${slug}`,
      () => this.primary.getReportBySlug(slug),
      () => this.secondary.getReportBySlug(slug),
      (report) =>
        report
          ? { meta: normalizeReportMeta(report.meta), content: report.content }
          : null,
    );
  }

  private async compare<T, C>(
    resource: string,
    readPrimary: () => Promise<T>,
    readSecondary: () => Promise<T>,
    normalize: (value: T) => C,
  ): Promise<T> {
    const primary = await readPrimary();
    try {
      const secondary = await readSecondary();
      if (stableJson(normalize(primary)) !== stableJson(normalize(secondary))) {
        throw new DataParityError(resource);
      }
    } catch (error: unknown) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      if (this.strict) throw normalized;
      this.onIssue(normalized);
    }
    return primary;
  }
}

function normalizeReportList(reports: ReportMeta[]) {
  return reports
    .map(normalizeExistingReportMeta)
    .sort((left, right) => left.slug.localeCompare(right.slug));
}

function normalizeReportMeta(meta: ReportMeta | null) {
  if (!meta) return null;
  return normalizeExistingReportMeta(meta);
}

function normalizeExistingReportMeta(meta: ReportMeta) {
  const portable = { ...meta };
  delete portable.artifactKey;
  delete portable.artifactChecksumSha256;
  return { ...portable, jurisdiction: [...portable.jurisdiction].sort() };
}
