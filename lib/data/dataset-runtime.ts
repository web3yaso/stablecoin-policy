import path from "node:path";
import {
  readCacheOptions,
  readDataBackend,
  readDualReadStrict,
} from "./data-backend-config";
import {
  DatasetService,
  DualReadDatasetService,
  type DatasetReader,
} from "./dataset-service";
import { FileDatasetReleaseRepository } from "./file-dataset-repository";
import { FileObjectStore } from "./file-object-store";
import { SupabaseHttpClient, readSupabaseConfig } from "./supabase-client";
import { SupabaseDatasetReleaseRepository } from "./supabase-dataset-repository";
import { SupabaseObjectStore } from "./supabase-object-store";

let datasetService: DatasetReader | undefined;

export function getDatasetService(): DatasetReader {
  datasetService ??= createDatasetService();
  return datasetService;
}

function createDatasetService(): DatasetReader {
  const backend = readDataBackend();
  const cacheOptions = readCacheOptions();
  const dataDirectory = path.join(process.cwd(), "data");
  const file = new DatasetService(
    new FileDatasetReleaseRepository(dataDirectory, {
      "news-summaries": {
        objectKey: "news/summaries.json",
        contentType: "application/json",
        schemaVersion: "1.0.0",
      },
      "news-source-health": {
        objectKey: "news/source-health.json",
        contentType: "application/json",
        schemaVersion: "1.0.0",
      },
      "daily-report": {
        objectKey: "reports/daily/latest.json",
        contentType: "application/json",
        schemaVersion: "1.0.0",
      },
    }),
    new FileObjectStore(dataDirectory),
    cacheOptions,
  );
  if (backend === "file") return file;

  const config = readSupabaseConfig();
  const client = new SupabaseHttpClient(config);
  const external = new DatasetService(
    new SupabaseDatasetReleaseRepository(client),
    new SupabaseObjectStore(client, config.datasetsBucket),
    cacheOptions,
  );
  return backend === "supabase"
    ? external
    : new DualReadDatasetService(
        file,
        external,
        readDualReadStrict(),
      );
}
