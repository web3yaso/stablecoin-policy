import { sha256 } from "./integrity";
import type { ReportMeta } from "./report-types";
import { SupabaseHttpClient } from "./supabase-client";
import { SupabaseObjectStore } from "./supabase-object-store";

export type PublishedRelease = {
  releaseId: string;
  objectKey: string;
  checksumSha256: string;
  byteSize: number;
};

export type PublishDatasetInput = {
  datasetId: string;
  body: Uint8Array;
  contentType: string;
  schemaVersion: string;
  generatedAt: string;
  publishedAt?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  extension: string;
};

export class SupabaseReleasePublisher {
  private readonly reports;
  private readonly datasets;

  constructor(private readonly client: SupabaseHttpClient) {
    this.reports = new SupabaseObjectStore(
      client,
      client.config.reportsBucket,
    );
    this.datasets = new SupabaseObjectStore(
      client,
      client.config.datasetsBucket,
    );
  }

  async publishReport(
    meta: ReportMeta,
    body: Uint8Array,
  ): Promise<PublishedRelease> {
    const checksumSha256 = sha256(body);
    const objectKey = createImmutableObjectKey({
      kind: "reports",
      id: meta.slug,
      timestamp: meta.publishedAt,
      checksumSha256,
      extension: "md.enc",
    });
    const stored = await this.reports.putObject({
      key: objectKey,
      body,
      contentType: "application/json",
      expectedChecksumSha256: checksumSha256,
    });
    const objectId = deterministicId("object", objectKey);
    const reportId = deterministicId("report", meta.slug);
    const releaseId = deterministicId(
      "report-release",
      `${meta.slug}:${meta.publishedAt}:${checksumSha256}`,
    );

    await this.client.rpc<string>("publish_report_release", {
      p_object_id: objectId,
      p_provider: "supabase-storage",
      p_bucket: this.client.config.reportsBucket,
      p_object_key: objectKey,
      p_checksum_sha256: checksumSha256,
      p_byte_size: stored.byteSize,
      p_content_type: stored.contentType,
      p_encryption_state: "APPLICATION_ENCRYPTED",
      p_report_id: reportId,
      p_slug: meta.slug,
      p_release_id: releaseId,
      p_title: meta.title,
      p_title_en: meta.title_en ?? null,
      p_summary: meta.summary,
      p_category: meta.category,
      p_jurisdictions: meta.jurisdiction,
      p_published_at: meta.publishedAt,
      p_word_count: meta.wordCount,
      p_price_usd: meta.priceUSD,
      p_source_url: meta.sourceUrl ?? null,
      p_metadata: {
        encryptedContentFile: meta.encryptedContentFile,
      },
    });

    return { releaseId, objectKey, checksumSha256, byteSize: stored.byteSize };
  }

  async publishDataset(input: PublishDatasetInput): Promise<PublishedRelease> {
    assertTimestamp(input.generatedAt, "generatedAt");
    const publishedAt = input.publishedAt ?? new Date().toISOString();
    assertTimestamp(publishedAt, "publishedAt");
    const checksumSha256 = sha256(input.body);
    const objectKey = createImmutableObjectKey({
      kind: "datasets",
      id: input.datasetId,
      timestamp: input.generatedAt,
      checksumSha256,
      extension: input.extension,
    });
    const stored = await this.datasets.putObject({
      key: objectKey,
      body: input.body,
      contentType: input.contentType,
      expectedChecksumSha256: checksumSha256,
    });
    const objectId = deterministicId("object", objectKey);
    const releaseId = deterministicId(
      "dataset-release",
      `${input.datasetId}:${input.generatedAt}:${checksumSha256}`,
    );

    await this.client.rpc<string>("publish_dataset_release", {
      p_object_id: objectId,
      p_provider: "supabase-storage",
      p_bucket: this.client.config.datasetsBucket,
      p_object_key: objectKey,
      p_checksum_sha256: checksumSha256,
      p_byte_size: stored.byteSize,
      p_content_type: stored.contentType,
      p_dataset_id: input.datasetId,
      p_release_id: releaseId,
      p_schema_version: input.schemaVersion,
      p_generated_at: input.generatedAt,
      p_published_at: publishedAt,
      p_description: input.description ?? null,
      p_metadata: input.metadata ?? {},
    });

    return { releaseId, objectKey, checksumSha256, byteSize: stored.byteSize };
  }
}

export function createImmutableObjectKey(input: {
  kind: "reports" | "datasets";
  id: string;
  timestamp: string;
  checksumSha256: string;
  extension: string;
}): string {
  assertTimestamp(input.timestamp, "timestamp");
  if (!/^[a-z0-9][a-z0-9-]{2,80}$/.test(input.id)) {
    throw new Error(`invalid release id: ${input.id}`);
  }
  if (!/^[0-9a-f]{64}$/.test(input.checksumSha256)) {
    throw new Error("invalid release checksum");
  }
  if (!/^[a-z0-9][a-z0-9.]{0,15}$/.test(input.extension)) {
    throw new Error(`invalid object extension: ${input.extension}`);
  }
  const timestamp = new Date(input.timestamp)
    .toISOString()
    .replace(/[:.]/g, "-");
  return `${input.kind}/${input.id}/${timestamp}/${input.checksumSha256}.${input.extension}`;
}

function deterministicId(namespace: string, value: string): string {
  return `${namespace}_${sha256(Buffer.from(value, "utf8")).slice(0, 32)}`;
}

function assertTimestamp(value: string, label: string): void {
  if (!Number.isFinite(Date.parse(value))) {
    throw new Error(`invalid ${label}: ${value}`);
  }
}
