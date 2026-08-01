export const REPORT_CATEGORIES = [
  "enforcement",
  "policy",
  "licensing",
  "sanctions",
  "analysis",
] as const;

export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

export type ReportMeta = {
  slug: string;
  title: string;
  title_en?: string;
  summary: string;
  category: ReportCategory;
  jurisdiction: string[];
  publishedAt: string;
  wordCount: number;
  priceUSD: number;
  encryptedContentFile: string;
  artifactKey?: string;
  artifactChecksumSha256?: string;
  sourceUrl?: string;
};

export type Report = {
  meta: ReportMeta;
  content: string;
};

export type EncryptedReportFile = {
  version: 1;
  algorithm: "aes-256-gcm";
  iv: string;
  authTag: string;
  ciphertext: string;
};

export const REPORT_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{5,80}$/;
export const ENCRYPTED_REPORT_FILE_PATTERN =
  /^[a-z0-9][a-z0-9-]*\.md\.enc$/;

export function parseReportMeta(value: unknown): ReportMeta {
  if (!isRecord(value)) {
    throw new Error("report metadata entry must be an object");
  }

  const meta: ReportMeta = {
    slug: readString(value, "slug"),
    title: readString(value, "title"),
    summary: readString(value, "summary"),
    category: readCategory(value),
    jurisdiction: readStringArray(value, "jurisdiction"),
    publishedAt: readString(value, "publishedAt"),
    wordCount: readNumber(value, "wordCount"),
    priceUSD: readNumber(value, "priceUSD"),
    encryptedContentFile: readString(value, "encryptedContentFile"),
  };

  const titleEn = readOptionalString(value, "title_en");
  const artifactKey = readOptionalString(value, "artifactKey");
  const artifactChecksumSha256 = readOptionalString(
    value,
    "artifactChecksumSha256",
  );
  const sourceUrl = readOptionalString(value, "sourceUrl");

  if (titleEn) meta.title_en = titleEn;
  if (artifactKey) meta.artifactKey = artifactKey;
  if (artifactChecksumSha256) {
    if (!/^[0-9a-f]{64}$/.test(artifactChecksumSha256)) {
      throw new Error(`invalid artifactChecksumSha256 for report ${meta.slug}`);
    }
    meta.artifactChecksumSha256 = artifactChecksumSha256;
  }
  if (sourceUrl) meta.sourceUrl = sourceUrl;

  if (!REPORT_SLUG_PATTERN.test(meta.slug)) {
    throw new Error(`invalid report slug: ${meta.slug}`);
  }

  if (!ENCRYPTED_REPORT_FILE_PATTERN.test(meta.encryptedContentFile)) {
    throw new Error(`invalid encryptedContentFile for report ${meta.slug}`);
  }

  if (meta.artifactKey !== undefined) {
    assertSafeObjectKey(meta.artifactKey);
  }

  if (meta.wordCount < 0 || !Number.isInteger(meta.wordCount)) {
    throw new Error(`invalid wordCount for report ${meta.slug}`);
  }

  if (meta.priceUSD <= 0) {
    throw new Error(`invalid priceUSD for report ${meta.slug}`);
  }

  if (!Number.isFinite(Date.parse(meta.publishedAt))) {
    throw new Error(`invalid publishedAt for report ${meta.slug}`);
  }

  return meta;
}

export function parseEncryptedReportFile(value: unknown): EncryptedReportFile {
  if (!isRecord(value)) {
    throw new Error("encrypted report must be an object");
  }

  const version = value.version;
  const algorithm = value.algorithm;

  if (version !== 1 || algorithm !== "aes-256-gcm") {
    throw new Error("unsupported encrypted report format");
  }

  return {
    version,
    algorithm,
    iv: readString(value, "iv"),
    authTag: readString(value, "authTag"),
    ciphertext: readString(value, "ciphertext"),
  };
}

export function getReportArtifactKey(meta: ReportMeta): string {
  return meta.artifactKey ?? meta.encryptedContentFile;
}

export function assertSafeObjectKey(objectKey: string): void {
  if (
    objectKey.length === 0 ||
    objectKey.startsWith("/") ||
    objectKey.includes("\\") ||
    objectKey.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`invalid object key: ${objectKey}`);
  }
}

function readCategory(value: Record<string, unknown>): ReportCategory {
  const category = readString(value, "category");
  if (!REPORT_CATEGORIES.includes(category as ReportCategory)) {
    throw new Error(`invalid report category: ${category}`);
  }

  return category as ReportCategory;
}

function readString(value: Record<string, unknown>, key: string): string {
  const item = value[key];
  if (typeof item !== "string" || item.length === 0) {
    throw new Error(`expected ${key} to be a non-empty string`);
  }

  return item;
}

function readOptionalString(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  const item = value[key];
  if (item === undefined) {
    return undefined;
  }

  if (typeof item !== "string" || item.length === 0) {
    throw new Error(`expected ${key} to be a non-empty string`);
  }

  return item;
}

function readNumber(value: Record<string, unknown>, key: string): number {
  const item = value[key];
  if (typeof item !== "number" || !Number.isFinite(item)) {
    throw new Error(`expected ${key} to be a finite number`);
  }

  return item;
}

function readStringArray(value: Record<string, unknown>, key: string): string[] {
  const item = value[key];
  if (
    !Array.isArray(item) ||
    item.length === 0 ||
    item.some((entry) => typeof entry !== "string" || entry.length === 0)
  ) {
    throw new Error(`expected ${key} to be a non-empty string array`);
  }

  return [...item];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
