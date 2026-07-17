import { createDecipheriv } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const REPORT_CATEGORIES = [
  "enforcement",
  "policy",
  "licensing",
  "sanctions",
  "analysis",
] as const;

export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

/**
 * The daily-refreshed sellable report. `latest` aliases resolve here so a
 * stable URL (e.g. the Alipay AI-collection endpoint) always returns the
 * freshest brief without the caller tracking dated slugs.
 */
export const LATEST_REPORT_SLUG = "global-stablecoin-policy-report";

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
  sourceUrl?: string;
};

export type Report = {
  meta: ReportMeta;
  content: string;
};

type EncryptedReportFile = {
  version: 1;
  algorithm: "aes-256-gcm";
  iv: string;
  authTag: string;
  ciphertext: string;
};

const REPORTS_DIR = path.join(process.cwd(), "data", "reports");
const REPORTS_INDEX_PATH = path.join(REPORTS_DIR, "index.json");
const ENCRYPTED_FILE_PATTERN = /^[a-z0-9][a-z0-9-]*\.md\.enc$/;

export class ReportContentKeyMissingError extends Error {
  constructor() {
    super("REPORTS_ENCRYPTION_KEY is required to decrypt report content");
    this.name = "ReportContentKeyMissingError";
  }
}

export async function listReports(): Promise<ReportMeta[]> {
  const raw = await readFile(REPORTS_INDEX_PATH, "utf8");
  const parsed = JSON.parse(raw) as unknown;

  if (!Array.isArray(parsed)) {
    throw new Error("reports index must be an array");
  }

  return parsed.map(validateReportMeta);
}

export async function getReportMetaBySlug(
  slug: string,
): Promise<ReportMeta | null> {
  const reports = await listReports();
  const resolvedSlug = slug === "latest" ? LATEST_REPORT_SLUG : slug;
  return reports.find((report) => report.slug === resolvedSlug) ?? null;
}

export async function getReportBySlug(slug: string): Promise<Report | null> {
  const meta = await getReportMetaBySlug(slug);

  if (!meta) {
    return null;
  }

  const encryptedPath = path.join(REPORTS_DIR, meta.encryptedContentFile);
  const encryptedRaw = await readFile(encryptedPath, "utf8");
  const encrypted = validateEncryptedReportFile(JSON.parse(encryptedRaw));

  return {
    meta,
    content: decryptReportContent(encrypted),
  };
}

function validateReportMeta(value: unknown): ReportMeta {
  if (!isRecord(value)) {
    throw new Error("report metadata entry must be an object");
  }

  const meta = {
    slug: readString(value, "slug"),
    title: readString(value, "title"),
    title_en: readOptionalString(value, "title_en"),
    summary: readString(value, "summary"),
    category: readCategory(value),
    jurisdiction: readStringArray(value, "jurisdiction"),
    publishedAt: readString(value, "publishedAt"),
    wordCount: readNumber(value, "wordCount"),
    priceUSD: readNumber(value, "priceUSD"),
    encryptedContentFile: readString(value, "encryptedContentFile"),
    sourceUrl: readOptionalString(value, "sourceUrl"),
  };

  if (!/^[a-z0-9][a-z0-9-]{5,80}$/.test(meta.slug)) {
    throw new Error(`invalid report slug: ${meta.slug}`);
  }

  if (!ENCRYPTED_FILE_PATTERN.test(meta.encryptedContentFile)) {
    throw new Error(`invalid encryptedContentFile for report ${meta.slug}`);
  }

  if (meta.wordCount < 0 || !Number.isInteger(meta.wordCount)) {
    throw new Error(`invalid wordCount for report ${meta.slug}`);
  }

  if (meta.priceUSD <= 0) {
    throw new Error(`invalid priceUSD for report ${meta.slug}`);
  }

  return meta;
}

function validateEncryptedReportFile(value: unknown): EncryptedReportFile {
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

function decryptReportContent(encrypted: EncryptedReportFile): string {
  const key = getReportsEncryptionKey();
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

function getReportsEncryptionKey(): Buffer {
  const raw = process.env.REPORTS_ENCRYPTION_KEY;

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

function readCategory(value: Record<string, unknown>): ReportCategory {
  const category = readString(value, "category");
  if (!REPORT_CATEGORIES.includes(category as ReportCategory)) {
    throw new Error(`invalid report category: ${category}`);
  }

  return category as ReportCategory;
}

function readString(value: Record<string, unknown>, key: string): string {
  const item = value[key];
  if (typeof item !== "string") {
    throw new Error(`expected ${key} to be a string`);
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

  if (typeof item !== "string") {
    throw new Error(`expected ${key} to be a string`);
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
  if (!Array.isArray(item) || item.some((entry) => typeof entry !== "string")) {
    throw new Error(`expected ${key} to be a string array`);
  }

  return item;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
