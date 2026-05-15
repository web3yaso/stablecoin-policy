import "../env";

import { createCipheriv, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  REPORT_CATEGORIES,
  type ReportCategory,
  type ReportMeta,
} from "../../lib/reports";

type CliOptions = {
  file: string;
  title: string;
  titleEn?: string;
  summary: string;
  category: ReportCategory;
  jurisdiction: string[];
  publishedAt: string;
  sourceUrl?: string;
  priceUSD: number;
};

type EncryptedReportFile = {
  version: 1;
  algorithm: "aes-256-gcm";
  iv: string;
  authTag: string;
  ciphertext: string;
};

const REPORTS_DIR = path.join(process.cwd(), "data", "reports");
const INDEX_PATH = path.join(REPORTS_DIR, "index.json");

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const markdown = await readFile(options.file, "utf8");
  const existing = await readIndex();
  const slug = createSlug(options.title, existing);
  const encryptedContentFile = `${slug}.md.enc`;
  const meta: ReportMeta = {
    slug,
    title: options.title,
    ...(options.titleEn ? { title_en: options.titleEn } : {}),
    summary: options.summary,
    category: options.category,
    jurisdiction: options.jurisdiction,
    publishedAt: options.publishedAt,
    wordCount: countWords(markdown),
    priceUSD: options.priceUSD,
    encryptedContentFile,
    ...(options.sourceUrl ? { sourceUrl: options.sourceUrl } : {}),
  };

  await mkdir(REPORTS_DIR, { recursive: true });
  await writeFile(
    path.join(REPORTS_DIR, encryptedContentFile),
    `${JSON.stringify(encryptMarkdown(markdown), null, 2)}\n`,
  );
  await writeFile(INDEX_PATH, `${JSON.stringify([...existing, meta], null, 2)}\n`);

  console.log(`Added encrypted report: ${slug}`);
}

function parseArgs(args: string[]): CliOptions {
  const values = new Map<string, string>();

  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];

    if (!flag?.startsWith("--") || !value) {
      usage();
    }

    values.set(flag.slice(2), value);
  }

  const category = requireOne(values, "category");
  if (!REPORT_CATEGORIES.includes(category as ReportCategory)) {
    throw new Error(`category must be one of: ${REPORT_CATEGORIES.join(", ")}`);
  }

  const priceUSD = Number(requireOne(values, "price-usd"));
  if (!Number.isFinite(priceUSD) || priceUSD <= 0) {
    throw new Error("--price-usd must be a positive number");
  }

  return {
    file: path.resolve(requireOne(values, "file")),
    title: requireOne(values, "title"),
    titleEn: values.get("title-en"),
    summary: requireOne(values, "summary"),
    category: category as ReportCategory,
    jurisdiction: requireOne(values, "jurisdiction")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    publishedAt: values.get("published-at") ?? new Date().toISOString(),
    sourceUrl: values.get("source-url"),
    priceUSD,
  };
}

async function readIndex(): Promise<ReportMeta[]> {
  try {
    const raw = await readFile(INDEX_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;

    if (!Array.isArray(parsed)) {
      throw new Error("reports index must be an array");
    }

    return parsed as ReportMeta[];
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

function createSlug(title: string, existing: ReportMeta[]): string {
  const prefix =
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "report";
  const taken = new Set(existing.map((report) => report.slug));

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const suffix = randomBytes(4).toString("hex");
    const slug = `${prefix}-${suffix}`;

    if (!taken.has(slug)) {
      return slug;
    }
  }

  throw new Error("failed to generate unique report slug");
}

function countWords(markdown: string): number {
  const cjkCharacters = markdown.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  const latinWords =
    markdown
      .replace(/[\u3400-\u9fff]/g, " ")
      .match(/[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)*/g)?.length ?? 0;

  return cjkCharacters + latinWords;
}

function encryptMarkdown(markdown: string): EncryptedReportFile {
  const key = getReportsEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(markdown, "utf8")),
    cipher.final(),
  ]);

  return {
    version: 1,
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

function getReportsEncryptionKey(): Buffer {
  const raw = process.env.REPORTS_ENCRYPTION_KEY;

  if (!raw) {
    throw new Error("REPORTS_ENCRYPTION_KEY is required");
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

function requireOne(values: Map<string, string>, key: string): string {
  const value = values.get(key);
  if (!value) {
    usage();
  }

  return value;
}

function usage(): never {
  throw new Error(
    [
      "Usage:",
      "npx tsx scripts/reports/add-report.ts \\",
      "  --file /path/to/report.md \\",
      "  --title \"中文标题\" \\",
      "  --summary \"100-200字摘要\" \\",
      "  --category policy \\",
      "  --jurisdiction US,EU \\",
      "  --price-usd 0.01 \\",
      "  [--published-at 2026-05-08T00:00:00.000Z] \\",
      "  [--source-url https://mp.weixin.qq.com/...]",
    ].join("\n"),
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "unknown error";
  console.error(message);
  process.exit(1);
});
