import type { DatasetRelease } from "./dataset-types";
import type { ReportMeta } from "./report-types";

export type StoredObject = {
  key: string;
  body: Uint8Array;
  contentType: string;
  byteSize: number;
  checksumSha256: string;
};

export type PutImmutableObjectInput = {
  key: string;
  body: Uint8Array;
  contentType: string;
  expectedChecksumSha256?: string;
};

export interface ImmutableObjectStore {
  getObject(key: string): Promise<StoredObject | null>;
  putObject(input: PutImmutableObjectInput): Promise<StoredObject>;
}

export interface ReportMetadataRepository {
  listReports(): Promise<ReportMeta[]>;
  findReportBySlug(slug: string): Promise<ReportMeta | null>;
}

export interface DatasetReleaseRepository {
  findActiveRelease(datasetId: string): Promise<DatasetRelease | null>;
  findRelease(
    datasetId: string,
    releaseId: string,
  ): Promise<DatasetRelease | null>;
}
