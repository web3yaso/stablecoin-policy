import "../env";

import { createCipheriv, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import type { ReportMeta } from "../../lib/reports";

// Fixed-slug sellable report: the daily brief is refreshed in place
// (same slug, content overwritten) and sold via the x402 API.
const SELLABLE_SLUG = "global-stablecoin-policy-report";
const SELLABLE_ENC_FILE = `${SELLABLE_SLUG}.md.enc`;
const SELLABLE_PRICE_USD = 0.1;
const SELLABLE_CATEGORY = "policy" as const;
const SELLABLE_JURISDICTION = ["GLOBAL"];

type JsonValue = unknown;
type RiskLevel = "Low" | "Medium" | "Medium-High" | "High";

type JsonFileInput = {
  id: string;
  file: string;
  data: JsonValue;
};

type ReportInput = {
  generatedAt: string;
  date: string;
  newsSummary: JsonValue | null;
  federalLegislation: JsonValue | null;
  stateLegislation: JsonFileInput[];
  international: JsonFileInput[];
};

type DailyReport = {
  date: string;
  generatedAt: string;
  title: string;
  executiveSummary: string[];
  topDevelopments: Array<{
    jurisdiction: string;
    headline: string;
    signal: string;
    whyItMatters: string;
    affectedParties: string[];
    riskLevel: RiskLevel;
  }>;
  regulatorySignalTable: Array<{
    jurisdiction: string;
    signal: string;
    direction: string;
    riskLevel: RiskLevel;
    businessImpact: string;
  }>;
  marketImpact: {
    stablecoinIssuers: string;
    exchangesAndWallets: string;
    paymentCompanies: string;
    defiProtocols: string;
  };
  watchlist: string[];
  analystTakeaway: string;
  sourceFiles: string[];
};

type RegionalSummary = {
  regional?: {
    na?: { summary?: string };
    eu?: { summary?: string };
    asia?: { summary?: string };
  };
};

const ROOT = process.cwd();
const OUTPUT_DIR_JSON = path.join(ROOT, "data", "reports", "daily");
const OUTPUT_DIR_MD = path.join(ROOT, "public", "reports", "daily");
const REPORTS_DIR = path.join(ROOT, "data", "reports");
const REPORTS_INDEX_PATH = path.join(REPORTS_DIR, "index.json");
const TODAY = new Date().toISOString().slice(0, 10);
const PROMPT_INPUT_LIMIT = 120_000;

type EncryptedReportFile = {
  version: 1;
  algorithm: "aes-256-gcm";
  iv: string;
  authTag: string;
  ciphertext: string;
};

function countWords(markdown: string): number {
  const cjk = markdown.match(/[㐀-鿿]/g)?.length ?? 0;
  const latin =
    markdown
      .replace(/[㐀-鿿]/g, " ")
      .match(/[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)*/g)?.length ?? 0;
  return cjk + latin;
}

function getReportsEncryptionKey(): Buffer {
  const raw = process.env.REPORTS_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "REPORTS_ENCRYPTION_KEY is required to publish the sellable report",
    );
  }
  const base64Key = Buffer.from(raw, "base64");
  if (base64Key.length === 32) return base64Key;
  const hexKey = Buffer.from(raw, "hex");
  if (hexKey.length === 32) return hexKey;
  throw new Error("REPORTS_ENCRYPTION_KEY must be 32 bytes, base64 or hex");
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

async function readReportIndex(): Promise<ReportMeta[]> {
  try {
    const raw = await fs.readFile(REPORTS_INDEX_PATH, "utf8");
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

// Replace the fixed-slug entry in place (or append if absent) so the
// catalog keeps a single, daily-refreshed sellable report.
async function upsertReportIndex(meta: ReportMeta): Promise<void> {
  const existing = await readReportIndex();
  const next = existing.some((r) => r.slug === meta.slug)
    ? existing.map((r) => (r.slug === meta.slug ? meta : r))
    : [...existing, meta];
  await fs.writeFile(
    REPORTS_INDEX_PATH,
    `${JSON.stringify(next, null, 2)}\n`,
    "utf8",
  );
}

// Public preview only — the valuable analysis stays behind the x402
// paywall. Leaking the full markdown to public/ would make the paid
// endpoint pointless.
function reportToPreviewMarkdown(report: DailyReport): string {
  return `# ${report.title}

**Generated at:** ${report.generatedAt}

> This is a free preview. The full report — top policy developments, the
> regulatory signal table, market-impact analysis, and the analyst
> takeaway — is available via paid API:
> \`GET /api/reports/${SELLABLE_SLUG}\` ($${SELLABLE_PRICE_USD.toFixed(2)}, x402).

## Executive Summary

${report.executiveSummary.map((item) => `- ${item}`).join("\n")}

## Watchlist

${report.watchlist.map((item) => `- ${item}`).join("\n")}
`;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfExists<T = JsonValue>(
  relativePath: string,
): Promise<T | null> {
  const fullPath = path.join(ROOT, relativePath);
  if (!(await pathExists(fullPath))) {
    return null;
  }

  const raw = await fs.readFile(fullPath, "utf8");
  return JSON.parse(raw) as T;
}

async function readJsonDir(relativeDir: string): Promise<JsonFileInput[]> {
  const fullDir = path.join(ROOT, relativeDir);

  if (!(await pathExists(fullDir))) {
    return [];
  }

  const entries = await fs.readdir(fullDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort();

  const results: JsonFileInput[] = [];

  for (const file of files) {
    const relativePath = path.join(relativeDir, file);
    const data = await readJsonIfExists(relativePath);

    results.push({
      id: file.replace(/\.json$/, ""),
      file: relativePath,
      data,
    });
  }

  return results;
}

function compactForPrompt(input: ReportInput): string {
  return JSON.stringify(input, null, 2).slice(0, PROMPT_INPUT_LIMIT);
}

function fallbackReport(input: ReportInput): DailyReport {
  const regional = readRegionalSummary(input.newsSummary).regional ?? {};

  const executiveSummary = [
    regional.na?.summary
      ? `North America: ${firstLine(regional.na.summary)}`
      : "North America remains focused on stablecoin legislation, issuer rules, and implementation risk.",
    regional.eu?.summary
      ? `Europe / UK: ${firstLine(regional.eu.summary)}`
      : "Europe and the UK continue to refine stablecoin, custody, and payment-related frameworks.",
    regional.asia?.summary
      ? `Asia-Pacific: ${firstLine(regional.asia.summary)}`
      : "Asia-Pacific remains active in stablecoin licensing, payment pilots, and reserve standards.",
  ];

  return {
    date: input.date,
    generatedAt: input.generatedAt,
    title: `Daily Stablecoin Policy Brief - ${input.date}`,
    executiveSummary,
    topDevelopments: [
      {
        jurisdiction: "United States / North America",
        headline:
          "Stablecoin policy momentum remains centered on implementation and supervision.",
        signal:
          "Legislation, issuer supervision, AML/CFT, sanctions, and yield guardrails remain key themes.",
        whyItMatters:
          "Stablecoin companies should prepare for detailed implementation rules rather than only tracking headline bill progress.",
        affectedParties: [
          "Stablecoin issuers",
          "Exchanges",
          "Wallets",
          "Payment companies",
          "Compliance teams",
        ],
        riskLevel: "High",
      },
      {
        jurisdiction: "United Kingdom / Europe",
        headline:
          "Stablecoin and custody rules continue to move through consultation and implementation planning.",
        signal:
          "Regulators are balancing innovation, financial stability, custody rules, and cross-border exposure.",
        whyItMatters:
          "Firms targeting UK or European users should prepare authorization, custody, disclosure, and reserve documentation.",
        affectedParties: [
          "Payment firms",
          "Custodians",
          "Stablecoin issuers",
          "Fintechs",
        ],
        riskLevel: "Medium-High",
      },
      {
        jurisdiction: "Asia-Pacific",
        headline:
          "Regulated stablecoin payment infrastructure continues to advance.",
        signal:
          "Licensing, issuer approval, bank partnerships, and cross-border payment use cases are gaining traction.",
        whyItMatters:
          "Asia-Pacific may become one of the most commercially active regions for compliant stablecoin payments.",
        affectedParties: [
          "Banks",
          "Payment companies",
          "Stablecoin issuers",
          "Institutional settlement providers",
        ],
        riskLevel: "Medium",
      },
    ],
    regulatorySignalTable: [
      {
        jurisdiction: "United States",
        signal: "Implementation and supervision",
        direction: "More formalized and restrictive",
        riskLevel: "High",
        businessImpact:
          "Issuers and intermediaries should prepare for federal compliance requirements.",
      },
      {
        jurisdiction: "Canada",
        signal: "Stablecoin rulemaking and CAD stablecoin activity",
        direction: "Framework building",
        riskLevel: "Medium",
        businessImpact:
          "Canadian stablecoin and payment pilots may grow while detailed rules are finalized.",
      },
      {
        jurisdiction: "United Kingdom",
        signal: "Stablecoin and custody consultation",
        direction: "Pre-authorization preparation",
        riskLevel: "Medium-High",
        businessImpact:
          "Firms should prepare licensing and compliance documentation early.",
      },
      {
        jurisdiction: "Hong Kong / Singapore / Japan",
        signal: "Licensed, reserve-backed stablecoin models",
        direction: "Regulated payment infrastructure",
        riskLevel: "Medium",
        businessImpact:
          "Institution-grade stablecoin payment rails are becoming more attractive.",
      },
    ],
    marketImpact: {
      stablecoinIssuers:
        "The strongest regulatory direction is toward licensed issuance, high-quality reserves, at-par redemption, and stronger governance.",
      exchangesAndWallets:
        "Listing, promotion, rewards, custody, and user access will increasingly depend on jurisdiction-specific rules.",
      paymentCompanies:
        "Stablecoin settlement and cross-border payment use cases are becoming more viable where licensing frameworks are clearer.",
      defiProtocols:
        "Yield-bearing and non-fiat-backed stablecoin models may face stronger scrutiny in major regulated markets.",
    },
    watchlist: [
      "U.S. stablecoin implementation rules",
      "Treasury AML/CFT and sanctions obligations",
      "UK FCA stablecoin and custody consultation",
      "Hong Kong stablecoin licensing updates",
      "Canada stablecoin rulemaking timeline",
    ],
    analystTakeaway:
      "The global stablecoin market is moving from legislative debate to licensing, supervision, and implementation. The commercial opportunity is shifting toward compliance-ready payment infrastructure.",
    sourceFiles: buildSourceFiles(input),
  };
}

function buildSourceFiles(input: ReportInput): string[] {
  return [
    "data/news/summaries.json",
    "data/legislation/federal.json",
    ...input.stateLegislation.map((item) => item.file),
    ...input.international.map((item) => item.file),
  ];
}

async function generateWithAnthropic(input: ReportInput): Promise<DailyReport> {
  if (process.env.REPORT_FORCE_FALLBACK === "1") {
    console.warn("REPORT_FORCE_FALLBACK=1. Using deterministic fallback report.");
    return fallbackReport(input);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    console.warn(
      "ANTHROPIC_API_KEY is not set. Using deterministic fallback report.",
    );
    return fallbackReport(input);
  }

  const anthropic = new Anthropic({ apiKey });
  const message = await anthropic.messages.create({
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
    max_tokens: 5000,
    temperature: 0.2,
    messages: [
      {
        role: "user",
        content: buildPrompt(input),
      },
    ],
  });

  const text = message.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("\n")
    .trim();

  try {
    const parsed = JSON.parse(extractJson(text)) as DailyReport;

    return {
      ...parsed,
      date: input.date,
      generatedAt: input.generatedAt,
      sourceFiles: parsed.sourceFiles?.length
        ? parsed.sourceFiles
        : buildSourceFiles(input),
    };
  } catch {
    console.warn("Failed to parse Anthropic JSON output. Using fallback.");
    return fallbackReport(input);
  }
}

function buildPrompt(input: ReportInput): string {
  return `
You are a stablecoin policy analyst.

Generate a Daily Stablecoin Policy Brief from the repo data below.

Rules:
- Use only facts supported by the input data.
- Do not invent dates, laws, bill names, or regulator actions.
- Separate factual policy signal from business analysis.
- Keep the report useful for stablecoin issuers, exchanges, wallets, payment companies, compliance teams, and investors.
- Prioritize developments that affect licensing, reserves, redemption, AML/CFT, sanctions, custody, payment use cases, yield, and issuer eligibility.
- Output valid JSON only.
- No markdown.
- No comments.

Return this exact JSON shape:

{
  "date": "YYYY-MM-DD",
  "generatedAt": "ISO datetime",
  "title": "Daily Stablecoin Policy Brief - YYYY-MM-DD",
  "executiveSummary": ["...", "...", "..."],
  "topDevelopments": [
    {
      "jurisdiction": "...",
      "headline": "...",
      "signal": "...",
      "whyItMatters": "...",
      "affectedParties": ["...", "..."],
      "riskLevel": "Low | Medium | Medium-High | High"
    }
  ],
  "regulatorySignalTable": [
    {
      "jurisdiction": "...",
      "signal": "...",
      "direction": "...",
      "riskLevel": "Low | Medium | Medium-High | High",
      "businessImpact": "..."
    }
  ],
  "marketImpact": {
    "stablecoinIssuers": "...",
    "exchangesAndWallets": "...",
    "paymentCompanies": "...",
    "defiProtocols": "..."
  },
  "watchlist": ["...", "..."],
  "analystTakeaway": "...",
  "sourceFiles": ["..."]
}

Repo data:
${compactForPrompt(input)}
`;
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced?.[1]?.trim() ?? text;
}

function escapeMd(text: string): string {
  return text.replace(/\|/g, "\\|");
}

function reportToMarkdown(report: DailyReport): string {
  const topDevelopments = report.topDevelopments
    .map((item, index) => {
      return `### ${index + 1}. ${item.jurisdiction} - ${item.headline}

**Signal:** ${item.signal}

**Why it matters:** ${item.whyItMatters}

**Affected parties:** ${item.affectedParties.join(", ")}

**Risk level:** ${item.riskLevel}
`;
    })
    .join("\n");

  const signalRows = report.regulatorySignalTable
    .map(
      (row) =>
        `| ${escapeMd(row.jurisdiction)} | ${escapeMd(row.signal)} | ${escapeMd(row.direction)} | ${row.riskLevel} | ${escapeMd(row.businessImpact)} |`,
    )
    .join("\n");

  return `# ${report.title}

**Generated at:** ${report.generatedAt}

## 1. Executive Summary

${report.executiveSummary.map((item) => `- ${item}`).join("\n")}

## 2. Top Policy Developments

${topDevelopments}

## 3. Regulatory Signal Table

| Jurisdiction | Signal | Direction | Risk Level | Business Impact |
|---|---|---|---|---|
${signalRows}

## 4. Market Impact

### Stablecoin issuers

${report.marketImpact.stablecoinIssuers}

### Exchanges and wallets

${report.marketImpact.exchangesAndWallets}

### Payment companies

${report.marketImpact.paymentCompanies}

### DeFi protocols

${report.marketImpact.defiProtocols}

## 5. Watchlist

${report.watchlist.map((item) => `- ${item}`).join("\n")}

## 6. Analyst Takeaway

${report.analystTakeaway}

## 7. Source

Compiled from public stablecoin policy and regulatory news tracking at https://stablecoin-policy.vercel.app/
`;
}

function readRegionalSummary(value: JsonValue | null): RegionalSummary {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  return value as RegionalSummary;
}

function firstLine(text: string): string {
  return text.split("\n")[0] ?? text;
}

async function main() {
  const date = process.env.REPORT_DATE || TODAY;
  const generatedAt = new Date().toISOString();

  const input: ReportInput = {
    generatedAt,
    date,
    newsSummary: await readJsonIfExists("data/news/summaries.json"),
    federalLegislation: await readJsonIfExists("data/legislation/federal.json"),
    stateLegislation: await readJsonDir("data/legislation/states"),
    international: await readJsonDir("data/international"),
  };

  await fs.mkdir(OUTPUT_DIR_JSON, { recursive: true });
  await fs.mkdir(OUTPUT_DIR_MD, { recursive: true });

  const report = await generateWithAnthropic(input);
  const markdown = reportToMarkdown(report);
  const previewMarkdown = reportToPreviewMarkdown(report);

  const jsonPath = path.join(OUTPUT_DIR_JSON, `${date}.json`);
  const mdPath = path.join(OUTPUT_DIR_MD, `${date}.md`);
  const latestJsonPath = path.join(OUTPUT_DIR_JSON, "latest.json");
  const latestMdPath = path.join(OUTPUT_DIR_MD, "latest.md");

  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(
    latestJsonPath,
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  // public/ gets the preview only; full content is sold via x402.
  await fs.writeFile(mdPath, previewMarkdown, "utf8");
  await fs.writeFile(latestMdPath, previewMarkdown, "utf8");

  // Publish the full report as the daily-refreshed sellable entry.
  const encrypted = encryptMarkdown(markdown);
  await fs.writeFile(
    path.join(REPORTS_DIR, SELLABLE_ENC_FILE),
    `${JSON.stringify(encrypted, null, 2)}\n`,
    "utf8",
  );
  const sellableMeta: ReportMeta = {
    slug: SELLABLE_SLUG,
    title: report.title,
    summary: report.executiveSummary.join(" ").slice(0, 280),
    category: SELLABLE_CATEGORY,
    jurisdiction: SELLABLE_JURISDICTION,
    publishedAt: report.generatedAt,
    wordCount: countWords(markdown),
    priceUSD: SELLABLE_PRICE_USD,
    encryptedContentFile: SELLABLE_ENC_FILE,
  };
  await upsertReportIndex(sellableMeta);

  console.log(`Generated daily report JSON: ${path.relative(ROOT, jsonPath)}`);
  console.log(
    `Generated latest report JSON: ${path.relative(ROOT, latestJsonPath)}`,
  );
  console.log(`Wrote public preview: ${path.relative(ROOT, latestMdPath)}`);
  console.log(
    `Published sellable report "${SELLABLE_SLUG}" ($${SELLABLE_PRICE_USD.toFixed(2)}, ${sellableMeta.wordCount} words)`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "unknown error";
  console.error(`Daily report generation failed: ${message}`);
  process.exit(1);
});
