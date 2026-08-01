import { getReportService } from "./data/report-runtime";

export {
  LATEST_REPORT_SLUG,
  ReportArtifactMissingError,
  ReportContentKeyMissingError,
} from "./data/report-service";
export {
  REPORT_CATEGORIES,
  type Report,
  type ReportCategory,
  type ReportMeta,
} from "./data/report-types";

/**
 * Compatibility facade for existing report routes and scripts.
 *
 * Phase 0 keeps the public API stable while the implementation moves behind
 * provider-neutral repository and object-storage interfaces. Phase 1 can swap
 * the runtime factory to PostgreSQL and Supabase Storage without changing
 * callers.
 */
export function listReports() {
  return getReportService().listReports();
}

export function getReportMetaBySlug(slug: string) {
  return getReportService().getReportMetaBySlug(slug);
}

export function getReportBySlug(slug: string) {
  return getReportService().getReportBySlug(slug);
}
