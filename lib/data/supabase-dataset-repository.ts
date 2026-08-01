import type { DatasetReleaseRepository } from "./contracts";
import type { DatasetRelease } from "./dataset-types";
import { canonicalIsoTimestamp } from "./integrity";
import { SupabaseHttpClient } from "./supabase-client";

type DatasetCatalogRow = {
  dataset_id: string;
  release_id: string;
  object_key: string;
  checksum_sha256: string;
  byte_size: number | string;
  content_type: string;
  schema_version: string;
  generated_at: string;
  published_at: string;
};

export class SupabaseDatasetReleaseRepository
  implements DatasetReleaseRepository
{
  constructor(private readonly client: SupabaseHttpClient) {}

  findActiveRelease(datasetId: string): Promise<DatasetRelease | null> {
    return this.findInView("active_dataset_catalog", datasetId);
  }

  findRelease(
    datasetId: string,
    releaseId: string,
  ): Promise<DatasetRelease | null> {
    return this.findInView("dataset_release_catalog", datasetId, releaseId);
  }

  private async findInView(
    view: string,
    datasetId: string,
    releaseId?: string,
  ): Promise<DatasetRelease | null> {
    const query = new URLSearchParams({
      select: "*",
      dataset_id: `eq.${datasetId}`,
      limit: "1",
    });
    if (releaseId) query.set("release_id", `eq.${releaseId}`);
    const rows = await this.client.rest<unknown>(`${view}?${query}`);
    if (!Array.isArray(rows)) {
      throw new Error(`Supabase ${view} must return an array`);
    }
    return rows.length === 0 ? null : parseDatasetRow(rows[0]);
  }
}

function parseDatasetRow(value: unknown): DatasetRelease {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("invalid dataset catalog row");
  }
  const row = value as Partial<DatasetCatalogRow>;
  const requiredStrings = [
    row.dataset_id,
    row.release_id,
    row.object_key,
    row.checksum_sha256,
    row.content_type,
    row.schema_version,
    row.generated_at,
    row.published_at,
  ];
  if (requiredStrings.some((entry) => typeof entry !== "string" || !entry)) {
    throw new Error("dataset catalog row is missing required fields");
  }
  if (!/^[0-9a-f]{64}$/.test(row.checksum_sha256!)) {
    throw new Error("dataset catalog checksum is invalid");
  }
  const byteSize = Number(row.byte_size);
  if (!Number.isSafeInteger(byteSize) || byteSize < 0) {
    throw new Error("dataset catalog byte_size is invalid");
  }
  return {
    datasetId: row.dataset_id!,
    releaseId: row.release_id!,
    objectKey: row.object_key!,
    checksumSha256: row.checksum_sha256!,
    byteSize,
    contentType: row.content_type!,
    schemaVersion: row.schema_version!,
    generatedAt: canonicalIsoTimestamp(row.generated_at, "generated_at"),
    publishedAt: canonicalIsoTimestamp(row.published_at, "published_at"),
  };
}
