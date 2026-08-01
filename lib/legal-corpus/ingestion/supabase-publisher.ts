import { SupabaseHttpClient } from "../../data/supabase-client";
import { SupabaseObjectStore } from "../../data/supabase-object-store";
import type { OfficialSourceRegistryEntry, OfficialSourceSnapshot } from "./types";

export class SupabaseOfficialSourcePublisher {
  private readonly objects: SupabaseObjectStore;

  constructor(private readonly client: SupabaseHttpClient) {
    this.objects = new SupabaseObjectStore(client, client.config.sourcesBucket);
  }

  async publish(snapshot: OfficialSourceSnapshot): Promise<string> {
    assertSourceStorageRights(snapshot.source);
    await this.objects.putObject({
      key: snapshot.objectKey,
      body: snapshot.body,
      contentType: snapshot.contentType,
      expectedChecksumSha256: snapshot.checksumSha256,
    });
    return this.client.rpc<string>("ingest_official_source_v5", {
      p_object_id: snapshot.objectId,
      p_bucket: this.client.config.sourcesBucket,
      p_object_key: snapshot.objectKey,
      p_checksum_sha256: snapshot.checksumSha256,
      // Storage may decorate Content-Type on a duplicate-object GET. Database
      // identity must use the validated upstream snapshot in every run.
      p_byte_size: snapshot.body.byteLength,
      p_content_type: snapshot.contentType,
      p_authority: {
        authorityId: snapshot.source.authorityId,
        name: snapshot.source.authorityName,
        jurisdictionCode: snapshot.source.jurisdictionCode,
        authorityType: snapshot.source.authorityType,
        officialDomains: snapshot.source.officialDomains,
      },
      p_document: {
        documentId: snapshot.source.documentId,
        authorityId: snapshot.source.authorityId,
        officialDocumentId: snapshot.source.officialDocumentId,
        documentType: snapshot.source.documentType,
        title: snapshot.source.title,
        canonicalUrl: snapshot.source.canonicalUrl,
        languageCodes: [snapshot.source.languageCode],
        redistributionRights: snapshot.source.redistributionRights,
        licenceIdentifier: snapshot.source.licenceIdentifier,
      },
      p_version: {
        versionId: snapshot.versionId,
        documentId: snapshot.source.documentId,
        versionLabel: snapshot.source.versionLabel,
        officialUrl: snapshot.source.fetchUrl,
        publishedAt: snapshot.source.publishedAt ?? null,
        observedAt: snapshot.retrievedAt,
        retrievedAt: snapshot.retrievedAt,
        storageRights: snapshot.source.storageRights,
        rightsReviewedAt: snapshot.source.rightsReviewedAt,
        rightsBasis: snapshot.source.rightsBasis,
      },
      p_provisions: snapshot.provisions,
      p_effective_from: snapshot.source.effectiveFrom ?? null,
      p_retrieval_metadata: snapshot.retrievalMetadata,
    });
  }
}

export function assertSourceStorageRights(
  source: Pick<
    OfficialSourceRegistryEntry,
    "sourceId" | "storageRights" | "rightsReviewedAt" | "rightsBasis"
  >,
): void {
  if (source.storageRights !== "ALLOWED") {
    throw new Error(
      `source storage rights do not permit upload: ${source.sourceId}/${source.storageRights}`,
    );
  }
  if (
    !source.rightsReviewedAt ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(source.rightsReviewedAt) ||
    !Number.isFinite(Date.parse(source.rightsReviewedAt)) ||
    !source.rightsBasis?.trim()
  ) {
    throw new Error(`source storage rights review is incomplete: ${source.sourceId}`);
  }
}
