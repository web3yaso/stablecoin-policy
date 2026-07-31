import { readFile } from "node:fs/promises";
import type { ReportMetadataRepository } from "./contracts";
import { parseReportMeta, type ReportMeta } from "./report-types";

export class JsonReportRepository implements ReportMetadataRepository {
  constructor(private readonly indexPath: string) {}

  async listReports(): Promise<ReportMeta[]> {
    const raw = await readFile(this.indexPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;

    if (!Array.isArray(parsed)) {
      throw new Error("reports index must be an array");
    }

    return parsed.map(parseReportMeta);
  }

  async findReportBySlug(slug: string): Promise<ReportMeta | null> {
    const reports = await this.listReports();
    return reports.find((report) => report.slug === slug) ?? null;
  }
}
