import { SupabaseHttpClient } from "../../data/supabase-client";
import { SupabaseObjectStore } from "../../data/supabase-object-store";
import type { OfficialSourceSnapshot } from "./types";

export class SupabaseOfficialSourcePublisher {
  private readonly objects: SupabaseObjectStore;

  constructor(private readonly client: SupabaseHttpClient) {
    this.objects = new SupabaseObjectStore(client, client.config.sourcesBucket);
  }

  async publish(snapshot: OfficialSourceSnapshot): Promise<string> {
    const stored = await this.objects.putObject({
      key: snapshot.objectKey,
      body: snapshot.body,
      contentType: snapshot.contentType,
      expectedChecksumSha256: snapshot.checksumSha256,
    });
    return this.client.rpc<string>("ingest_official_source", {
      p_object_id: snapshot.objectId,
      p_bucket: this.client.config.sourcesBucket,
      p_object_key: snapshot.objectKey,
      p_checksum_sha256: snapshot.checksumSha256,
      p_byte_size: stored.byteSize,
      p_content_type: stored.contentType,
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
      },
      p_provisions: snapshot.provisions,
    });
  }
}
