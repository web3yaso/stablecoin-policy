import { createDecipheriv } from "node:crypto";
import type { ImmutableObjectStore, ReportMetadataRepository } from "./contracts";
import {
  getReportArtifactKey,
  parseEncryptedReportFile,
  type EncryptedReportFile,
  type Report,
  type ReportMeta,
} from "./report-types";
import { DataIntegrityError } from "./external-storage-errors";

export interface ReportReader {
  listReports(): Promise<ReportMeta[]>;
  getReportMetaBySlug(slug: string): Promise<ReportMeta | null>;
  getReportBySlug(slug: string): Promise<Report | null>;
}

export class ReportContentKeyMissingError extends Error {
  constructor() {
    super("REPORTS_ENCRYPTION_KEY is required to decrypt report content");
    this.name = "ReportContentKeyMissingError";
  }
}

export class ReportArtifactMissingError extends Error {
  constructor(key: string) {
    super(`report artifact is missing: ${key}`);
    this.name = "ReportArtifactMissingError";
  }
}

export class ReportService implements ReportReader {
  constructor(
    private readonly metadata: ReportMetadataRepository,
    private readonly objects: ImmutableObjectStore,
    private readonly readEncryptionKey: () => string | undefined = () =>
      process.env.REPORTS_ENCRYPTION_KEY,
  ) {}

  listReports(): Promise<ReportMeta[]> {
    return this.metadata.listReports();
  }

  getReportMetaBySlug(slug: string): Promise<ReportMeta | null> {
    return this.metadata.findReportBySlug(resolveReportSlug(slug));
  }

  async getReportBySlug(slug: string): Promise<Report | null> {
    const meta = await this.getReportMetaBySlug(slug);
    if (!meta) {
      return null;
    }

    const artifactKey = getReportArtifactKey(meta);
    const artifact = await this.objects.getObject(artifactKey);
    if (!artifact) {
      throw new ReportArtifactMissingError(artifactKey);
    }
    if (
      meta.artifactChecksumSha256 &&
      artifact.checksumSha256 !== meta.artifactChecksumSha256
    ) {
      throw new DataIntegrityError(
        `report artifact checksum mismatch: ${artifactKey}`,
      );
    }

    const encrypted = parseEncryptedReportFile(
      JSON.parse(Buffer.from(artifact.body).toString("utf8")),
    );

    return {
      meta,
      content: decryptReportContent(encrypted, this.readEncryptionKey()),
    };
  }
}

export const LATEST_REPORT_SLUG = "global-stablecoin-policy-report";

function resolveReportSlug(slug: string): string {
  return slug === "latest" ? LATEST_REPORT_SLUG : slug;
}

function decryptReportContent(
  encrypted: EncryptedReportFile,
  rawKey: string | undefined,
): string {
  const key = parseEncryptionKey(rawKey);
  const decipher = createDecipheriv(
    encrypted.algorithm,
    key,
    Buffer.from(encrypted.iv, "base64"),
  );

  decipher.setAuthTag(Buffer.from(encrypted.authTag, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

function parseEncryptionKey(raw: string | undefined): Buffer {
  if (!raw) {
    throw new ReportContentKeyMissingError();
  }

  const base64Key = Buffer.from(raw, "base64");
  if (base64Key.length === 32) {
    return base64Key;
  }

  const hexKey = Buffer.from(raw, "hex");
  if (hexKey.length === 32) {
    return hexKey;
  }

  throw new Error("REPORTS_ENCRYPTION_KEY must be 32 bytes, base64 or hex");
}
