import type {
  ImmutableObjectStore,
  PutImmutableObjectInput,
  StoredObject,
} from "./contracts";
import { ExternalStorageError } from "./external-storage-errors";
import { ImmutableObjectConflictError } from "./file-object-store";
import { sha256 } from "./integrity";
import {
  safeResponseText,
  SupabaseHttpClient,
} from "./supabase-client";

export class SupabaseObjectStore implements ImmutableObjectStore {
  constructor(
    private readonly client: SupabaseHttpClient,
    private readonly bucket: string,
  ) {}

  async getObject(key: string): Promise<StoredObject | null> {
    const response = await this.client.storage(this.bucket, key);
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new ExternalStorageError(
        `Supabase Storage read failed (${response.status}): ${await safeResponseText(response)}`,
        response.status,
      );
    }

    const body = new Uint8Array(await response.arrayBuffer());
    return {
      key,
      body,
      contentType:
        response.headers.get("content-type") ?? "application/octet-stream",
      byteSize: body.byteLength,
      checksumSha256: sha256(body),
    };
  }

  async putObject(input: PutImmutableObjectInput): Promise<StoredObject> {
    const body = new Uint8Array(input.body);
    const checksumSha256 = sha256(body);
    if (
      input.expectedChecksumSha256 &&
      input.expectedChecksumSha256 !== checksumSha256
    ) {
      throw new Error(`checksum mismatch for object: ${input.key}`);
    }

    const response = await this.client.storage(this.bucket, input.key, {
      method: "POST",
      headers: {
        "Content-Type": input.contentType,
        "x-upsert": "false",
      },
      body,
    });

    if (response.ok) {
      return {
        key: input.key,
        body,
        contentType: input.contentType,
        byteSize: body.byteLength,
        checksumSha256,
      };
    }

    if (response.status === 400 || response.status === 409) {
      const existing = await this.getObject(input.key);
      if (existing?.checksumSha256 === checksumSha256) return existing;
      if (existing) throw new ImmutableObjectConflictError(input.key);
    }

    throw new ExternalStorageError(
      `Supabase Storage write failed (${response.status}): ${await safeResponseText(response)}`,
      response.status,
    );
  }
}
