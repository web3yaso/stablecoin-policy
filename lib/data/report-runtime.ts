import path from "node:path";
import {
  CachedObjectStore,
  CachedReportMetadataRepository,
} from "./cached-adapters";
import {
  readCacheOptions,
  readDataBackend,
  readDualReadStrict,
} from "./data-backend-config";
import { DualReadReportService } from "./dual-read-report-service";
import { FileObjectStore } from "./file-object-store";
import { JsonReportRepository } from "./json-report-repository";
import { ReportService, type ReportReader } from "./report-service";
import { SupabaseHttpClient, readSupabaseConfig } from "./supabase-client";
import { SupabaseObjectStore } from "./supabase-object-store";
import { SupabaseReportRepository } from "./supabase-report-repository";

let reportService: ReportReader | undefined;

export function getReportService(): ReportReader {
  reportService ??= createReportService();
  return reportService;
}

function createReportService(): ReportReader {
  const backend = readDataBackend();
  const file = createFileReportService();
  if (backend === "file") return file;

  const config = readSupabaseConfig();
  const client = new SupabaseHttpClient(config);
  const cacheOptions = readCacheOptions();
  const external = new ReportService(
    new CachedReportMetadataRepository(
      new SupabaseReportRepository(client),
      cacheOptions,
    ),
    new CachedObjectStore(
      new SupabaseObjectStore(client, config.reportsBucket),
      cacheOptions,
    ),
  );

  return backend === "supabase"
    ? external
    : new DualReadReportService(file, external, {
        strict: readDualReadStrict(),
      });
}

function createFileReportService(): ReportService {
  const reportsDirectory = path.join(process.cwd(), "data", "reports");
  return new ReportService(
    new JsonReportRepository(path.join(reportsDirectory, "index.json")),
    new FileObjectStore(reportsDirectory),
  );
}
