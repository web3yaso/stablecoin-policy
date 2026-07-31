import path from "node:path";
import { FileObjectStore } from "./file-object-store";
import { JsonReportRepository } from "./json-report-repository";
import { ReportService } from "./report-service";

const FILE_BACKEND = "file";
let reportService: ReportService | undefined;

export function getReportService(): ReportService {
  reportService ??= createReportService();
  return reportService;
}

function createReportService(): ReportService {
  const backend =
    process.env.STABLECOIN_POLICY_DATA_BACKEND?.trim() || FILE_BACKEND;

  if (backend !== FILE_BACKEND) {
    throw new Error(
      `unsupported STABLECOIN_POLICY_DATA_BACKEND: ${backend}; only file is available before Phase 1`,
    );
  }

  const reportsDirectory = path.join(process.cwd(), "data", "reports");
  return new ReportService(
    new JsonReportRepository(path.join(reportsDirectory, "index.json")),
    new FileObjectStore(reportsDirectory),
  );
}
