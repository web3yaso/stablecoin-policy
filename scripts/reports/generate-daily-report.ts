import "../env";

import { createCipheriv, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import Anthropic from "../../lib/openai-llm.js";
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

type RecentNewsItem = {
  headline: string;
  date: string;
  source: string;
  url: string;
  summary?: string;
  sourceId?: string;
  sourceType?: "official-api" | "official-feed";
  sourceAuthority?: string;
  officialDocumentId?: string;
  sourceVersion?: string;
  documentType?: string;
  officialPdfUrl?: string;
  commentCloseDate?: string;
  openForComment?: boolean;
};

type JurisdictionBlock = {
  jurisdiction: string;
  recentNews: RecentNewsItem[];
};

type ReportInput = {
  generatedAt: string;
  date: string;
  regionalSummaries: { na?: string; eu?: string; asia?: string };
  jurisdictions: JurisdictionBlock[];
  /** Raw paths used; kept for the report's sourceFiles field. */
  sourceFiles: string[];
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
  sources: Array<{ outlet: string; url: string; headline: string; date: string }>;
};

type RegionalSummary = {
  regional?: {
    na?: RegionalSummaryEntry;
    eu?: RegionalSummaryEntry;
    asia?: RegionalSummaryEntry;
  };
};

type RegionalSummaryEntry = {
  summary?: string;
  generatedAt?: string;
  sourcePolicy?: string;
  sourceCount?: number;
};

type SourceHealthFile = {
  version?: number;
  checkedAt?: string;
  status?: "healthy" | "degraded" | "failed";
  officialFeeds?: {
    succeeded?: number;
  };
  professionalSources?: Array<{
    status?: "ok" | "partial" | "skipped" | "failed";
  }>;
};

const ROOT = process.cwd();
const OUTPUT_DIR_JSON = path.join(ROOT, "data", "reports", "daily");
const OUTPUT_DIR_MD = path.join(ROOT, "public", "reports", "daily");
const REPORTS_DIR = path.join(ROOT, "data", "reports");
const REPORTS_INDEX_PATH = path.join(REPORTS_DIR, "index.json");
const TODAY = new Date().toISOString().slice(0, 10);
const SOURCE_HEALTH_MAX_AGE_MS = 36 * 60 * 60 * 1000;
const REGIONAL_SUMMARY_MAX_AGE_MS = 36 * 60 * 60 * 1000;

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
${report.sources.length > 0 ? `\n## Sources\n\n${report.sources
  .slice()
  .sort((a, b) => a.outlet.localeCompare(b.outlet))
  .map((s) => `- [${escapeMdLinkText(s.outlet)} — ${escapeMdLinkText(s.headline)}](${s.url}) · ${s.date}`)
  .join("\n")}\n` : ""}`;
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

export function assertPublishableSourceState(
  sourceHealth: SourceHealthFile | null,
  now: number,
): void {
  if (
    process.env.REPORT_ALLOW_UNVERIFIED_SOURCES === "1" &&
    process.env.REPORT_DRY_RUN === "1"
  ) {
    console.warn(
      "REPORT_ALLOW_UNVERIFIED_SOURCES=1: bypassing official-source health gate for dry-run only.",
    );
    return;
  }
  if (!sourceHealth || sourceHealth.version !== 1) {
    throw new Error(
      "Missing data/news/source-health.json. Run the official-source poller before publishing a report.",
    );
  }
  const checkedAt = Date.parse(sourceHealth.checkedAt ?? "");
  if (
    !Number.isFinite(checkedAt) ||
    now - checkedAt > SOURCE_HEALTH_MAX_AGE_MS
  ) {
    throw new Error(
      "Official-source health checkpoint is missing or older than 36 hours; refusing to publish a paid report.",
    );
  }
  const successfulProfessionalSources = (
    sourceHealth.professionalSources ?? []
  ).filter(
    (source) => source.status === "ok" || source.status === "partial",
  ).length;
  const successfulSources =
    Number(sourceHealth.officialFeeds?.succeeded ?? 0) +
    successfulProfessionalSources;
  if (
    (sourceHealth.status !== "healthy" &&
      sourceHealth.status !== "degraded") ||
    successfulSources < 1
  ) {
    throw new Error(
      "No official source completed successfully in the latest poll; refusing to publish a paid report.",
    );
  }
}

const RECENT_DAYS = 7;
const MAX_NEWS_PER_BLOCK = 10;

function recentNewsFor(
  newsSummary: JsonValue | null,
  entity: string,
  now: number,
): RecentNewsItem[] {
  if (!newsSummary || typeof newsSummary !== "object" || Array.isArray(newsSummary)) return [];
  const root = (newsSummary as { entities?: Record<string, { news?: unknown[] }> }).entities;
  const bucket = root?.[entity];
  const items = Array.isArray(bucket?.news) ? (bucket!.news as RecentNewsItem[]) : [];
  const cutoff = now - RECENT_DAYS * 24 * 60 * 60 * 1000;
  return items
    .filter((it) => {
      // A new paid report may only use records that passed through a
      // first-party feed or structured official-source adapter. This excludes
      // all legacy Google/third-party rows without relying on outlet naming.
      if (
        it.sourceType !== "official-api" &&
        it.sourceType !== "official-feed"
      ) {
        return false;
      }
      const t = Date.parse(it?.date ?? "");
      return Number.isFinite(t) && t >= cutoff;
    })
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
    .slice(0, MAX_NEWS_PER_BLOCK)
    .map((it) => ({
      headline: it.headline,
      date: it.date,
      source: it.source,
      url: it.url,
      summary: it.summary,
      sourceId: it.sourceId,
      sourceType: it.sourceType,
      sourceAuthority: it.sourceAuthority,
      officialDocumentId: it.officialDocumentId,
      sourceVersion: it.sourceVersion,
      documentType: it.documentType,
      officialPdfUrl: it.officialPdfUrl,
      commentCloseDate: it.commentCloseDate,
      openForComment: it.openForComment,
    }));
}

export function buildJurisdictionBlocks(args: {
  newsSummary: JsonValue | null;
  now: number;
}): JurisdictionBlock[] {
  const { newsSummary, now } = args;
  if (
    !newsSummary ||
    typeof newsSummary !== "object" ||
    Array.isArray(newsSummary)
  ) {
    return [];
  }
  const entities = (
    newsSummary as {
      entities?: Record<string, { news?: unknown[] }>;
    }
  ).entities;
  if (!entities || typeof entities !== "object") return [];

  return Object.keys(entities)
    .map((entity) => ({
      jurisdiction: entity === "United States" ? "US-Federal" : entity,
      recentNews: recentNewsFor(newsSummary, entity, now),
    }))
    .filter((block) => block.recentNews.length > 0)
    .sort((left, right) => {
      const priority = (jurisdiction: string) =>
        jurisdiction === "US-Federal"
          ? 0
          : jurisdiction === "European Union"
            ? 1
            : jurisdiction === "United Kingdom"
              ? 2
              : 3;
      const priorityDelta =
        priority(left.jurisdiction) - priority(right.jurisdiction);
      if (priorityDelta !== 0) return priorityDelta;
      const itemDelta = right.recentNews.length - left.recentNews.length;
      return itemDelta || left.jurisdiction.localeCompare(right.jurisdiction);
    });
}

function officialRegionalSummary(
  entry: RegionalSummaryEntry | undefined,
  now: number,
): string | undefined {
  if (
    entry?.sourcePolicy !== "official-only" ||
    !entry.summary?.trim() ||
    Number(entry.sourceCount ?? 0) < 1
  ) {
    return undefined;
  }
  const generatedAt = Date.parse(entry.generatedAt ?? "");
  const cutoff = now - REGIONAL_SUMMARY_MAX_AGE_MS;
  if (!Number.isFinite(generatedAt) || generatedAt < cutoff) {
    return undefined;
  }
  return entry.summary.trim();
}

export function buildRegionalSummaries(
  newsSummary: JsonValue | null,
  now: number,
): { na?: string; eu?: string; asia?: string } {
  const regional = readRegionalSummary(newsSummary).regional ?? {};
  return {
    na: officialRegionalSummary(regional.na, now),
    eu: officialRegionalSummary(regional.eu, now),
    asia: officialRegionalSummary(regional.asia, now),
  };
}

function compactForPrompt(input: ReportInput): string {
  const lines: string[] = [];
  lines.push(`Date: ${input.date}`);
  lines.push(`Generated at: ${input.generatedAt}`);
  if (input.regionalSummaries.na) lines.push(`\nRegional summary — NA:\n${input.regionalSummaries.na}`);
  if (input.regionalSummaries.eu) lines.push(`\nRegional summary — EU:\n${input.regionalSummaries.eu}`);
  if (input.regionalSummaries.asia) lines.push(`\nRegional summary — Asia:\n${input.regionalSummaries.asia}`);

  let used = lines.join("\n").length;
  const BUDGET = 100_000;
  for (const block of input.jurisdictions) {
    const blockLines: string[] = [];
    blockLines.push(`\n## ${block.jurisdiction}`);
    if (block.recentNews.length > 0) {
      blockLines.push("Recent news (last 7 days):");
      for (const n of block.recentNews) {
        const provenance = [
          n.sourceType ? `source_type=${n.sourceType}` : null,
          n.sourceId ? `source_id=${n.sourceId}` : null,
          n.sourceAuthority
            ? `authority="${n.sourceAuthority.replace(/"/g, "'")}"`
            : null,
          n.officialDocumentId ? `document_id=${n.officialDocumentId}` : null,
          n.sourceVersion ? `version=${n.sourceVersion}` : null,
          n.documentType ? `document_type=${n.documentType}` : null,
          n.commentCloseDate ? `comment_close=${n.commentCloseDate}` : null,
          typeof n.openForComment === "boolean"
            ? `open_for_comment=${String(n.openForComment)}`
            : null,
        ].filter(Boolean);
        blockLines.push(
          `- date=${n.date} outlet="${n.source.replace(/"/g, "'")}" headline="${n.headline.replace(/"/g, "'")}" url=${n.url}${provenance.length > 0 ? ` ${provenance.join(" ")}` : ""}`,
        );
        if (n.officialPdfUrl) blockLines.push(`  official_pdf=${n.officialPdfUrl}`);
        if (n.summary) blockLines.push(`  summary: ${n.summary}`);
      }
    }
    const blockText = blockLines.join("\n");
    if (used + blockText.length > BUDGET) break;
    lines.push(blockText);
    used += blockText.length;
  }
  return lines.join("\n");
}

// ─── ARCHIVED: pre-2026-05-28 hardcoded fallback ──────────────────
// Retained for 7-day paper trail; safe to delete after 2026-06-04.
// If Sonnet is unavailable for an extended period and the sparse-data
// fallback feels too thin to ship, restore this body as a temporary
// measure (be aware it returns boilerplate, not real signal).
//
// function fallbackReportLegacy(input: ReportInput): DailyReport {
//   const regional = input.regionalSummaries;
//   const executiveSummary = [
//     regional.na
//       ? `North America: ${firstLine(regional.na)}`
//       : "North America remains focused on stablecoin legislation, issuer rules, and implementation risk.",
//     regional.eu
//       ? `Europe / UK: ${firstLine(regional.eu)}`
//       : "Europe and the UK continue to refine stablecoin, custody, and payment-related frameworks.",
//     regional.asia
//       ? `Asia-Pacific: ${firstLine(regional.asia)}`
//       : "Asia-Pacific remains active in stablecoin licensing, payment pilots, and reserve standards.",
//   ];
//   return {
//     date: input.date,
//     generatedAt: input.generatedAt,
//     title: `Daily Stablecoin Policy Brief - ${input.date}`,
//     executiveSummary,
//     topDevelopments: [/* 3 hardcoded developments */],
//     regulatorySignalTable: [/* 4 hardcoded rows */],
//     marketImpact: { /* 4 hardcoded paragraphs */ },
//     watchlist: [/* 5 hardcoded items */],
//     analystTakeaway:
//       "The global stablecoin market is moving from legislative debate to licensing, supervision, and implementation. The commercial opportunity is shifting toward compliance-ready payment infrastructure.",
//     sourceFiles: buildSourceFiles(input),
//     sources: [],
//   };
// }

function fallbackReport(input: ReportInput): DailyReport {
  const regional = input.regionalSummaries;
  const allEmpty = !regional.na && !regional.eu && !regional.asia;
  const executiveSummary = allEmpty
    ? ["No new policy signal detected in last 24 hours."]
    : [
        regional.na ? `North America: ${firstLine(regional.na)}` : "North America: insufficient signal.",
        regional.eu ? `Europe / UK: ${firstLine(regional.eu)}` : "Europe / UK: insufficient signal.",
        regional.asia ? `Asia-Pacific: ${firstLine(regional.asia)}` : "Asia-Pacific: insufficient signal.",
      ];
  return {
    date: input.date,
    generatedAt: input.generatedAt,
    title: `Daily Stablecoin Policy Brief - ${input.date}`,
    executiveSummary,
    topDevelopments: [],
    regulatorySignalTable: [],
    marketImpact: {
      stablecoinIssuers: "Insufficient signal — see recent reports.",
      exchangesAndWallets: "Insufficient signal — see recent reports.",
      paymentCompanies: "Insufficient signal — see recent reports.",
      defiProtocols: "Insufficient signal — see recent reports.",
    },
    watchlist: [],
    analystTakeaway:
      "Data ingestion was sparse or AI generation was unavailable. The next refresh runs at the next scheduled cron tick.",
    sourceFiles: buildSourceFiles(input),
    sources: [],
  };
}

function buildSourceFiles(input: ReportInput): string[] {
  return input.sourceFiles;
}

function buildSystemAndUserPrompts(input: ReportInput): { system: string; user: string } {
  const system = `You are a stablecoin policy analyst writing the Daily Stablecoin Policy Brief.

Rules:
- Use only facts supported by the input data below.
- Do not invent dates, laws, bill names, regulator actions, or URLs.
- Prefer official-api and official-feed records over derived regional prose.
- Treat document_id, version, comment_close, and open_for_comment as source facts; never infer a deadline that is absent.
- Separate factual policy signal from business analysis.
- Each "Top Development" must be tied to a Recent news item.
- Output valid JSON only. No markdown. No comments. No prose outside the JSON.

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
  "sources": [
    { "outlet": "...", "url": "...", "headline": "...", "date": "YYYY-MM-DD" }
  ]
}

Sources rules:
- The "sources" array MUST contain 8 to 15 entries when the input contains 8+ distinct outlets in the Recent news entries below. Otherwise return as many as exist.
- The "url" field of each entry MUST be COPIED VERBATIM from the "url=" field of a Recent news entry below. Character for character. Do not substitute the separate official_pdf URL.
- A URL that does not match an input "url=" value verbatim will be dropped by post-processing and your sources list will be incomplete. So copy carefully.
- Deduplicate by outlet (one entry per outlet at most).
- Pick the most consequential items actually relied on across executiveSummary, topDevelopments, regulatorySignalTable, and analystTakeaway.`;

  const userBody = compactForPrompt(input);
  const user = `Date: ${input.date}

Repo data follows. Use only this content.

${userBody}

Produce the JSON now.`;

  return { system, user };
}

export async function generateWithAnthropic(
  input: ReportInput,
): Promise<DailyReport> {
  const currentEvidenceCount = input.jurisdictions.reduce(
    (count, block) => count + block.recentNews.length,
    0,
  );
  if (currentEvidenceCount === 0) {
    console.log(
      "report: official sources were healthy but yielded no recent policy event; publishing deterministic no-signal brief.",
    );
    return fallbackReport({ ...input, regionalSummaries: {} });
  }

  if (process.env.REPORT_FORCE_FALLBACK === "1") {
    console.warn("REPORT_FORCE_FALLBACK=1. Using deterministic fallback report.");
    return fallbackReport(input);
  }

  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    console.warn(
      "OPENAI_API_KEY is not set. Using deterministic fallback report.",
    );
    return fallbackReport(input);
  }

  const anthropic = new Anthropic({ apiKey });
  const prompts = buildSystemAndUserPrompts(input);
  const message = await anthropic.messages.create({
    model: process.env.OPENAI_MODEL || "gpt-5.6-terra",
    cost_label: "daily-policy-report",
    max_tokens: 6000,
    temperature: 0.2,
    system: prompts.system,
    messages: [{ role: "user", content: prompts.user }],
  });

  const text = message.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("\n")
    .trim();

  try {
    const parsed = JSON.parse(extractJson(text)) as DailyReport;
    const inputUrls = new Set<string>();
    for (const block of input.jurisdictions) {
      for (const item of block.recentNews) inputUrls.add(item.url);
    }
    const validSources = (parsed.sources ?? []).filter((s) => {
      const ok = typeof s?.url === "string" && inputUrls.has(s.url);
      if (!ok) {
        console.warn(`report: dropping fabricated source URL ${s?.url ?? "(missing)"}`);
      }
      return ok;
    });

    return {
      ...parsed,
      date: input.date,
      generatedAt: input.generatedAt,
      sourceFiles: parsed.sourceFiles?.length ? parsed.sourceFiles : buildSourceFiles(input),
      sources: validSources,
    };
  } catch {
    console.warn("Failed to parse Anthropic JSON output. Using fallback.");
    return fallbackReport(input);
  }
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced?.[1]?.trim() ?? text;
}

function escapeMd(text: string): string {
  return text.replace(/\|/g, "\\|");
}

function escapeMdLinkText(s: string): string {
  return s.replace(/[\[\]\\]/g, "\\$&").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
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

  const sourcesList = report.sources.length
    ? report.sources
        .slice()
        .sort((a, b) => a.outlet.localeCompare(b.outlet))
        .map((s) => `- [${escapeMdLinkText(s.outlet)} — ${escapeMdLinkText(s.headline)}](${s.url}) · ${s.date}`)
        .join("\n")
    : "_No sources cited for this brief._";

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

## 7. Sources

${sourcesList}

---

_Compiled from public stablecoin policy and regulatory news tracking at https://stablecoin-policy.vercel.app/_
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

  const newsSummary = await readJsonIfExists("data/news/summaries.json");
  const sourceHealth = await readJsonIfExists<SourceHealthFile>(
    "data/news/source-health.json",
  );
  const now = Date.now();
  assertPublishableSourceState(sourceHealth, now);

  const input: ReportInput = {
    generatedAt,
    date,
    regionalSummaries: buildRegionalSummaries(newsSummary, now),
    jurisdictions: buildJurisdictionBlocks({
      newsSummary,
      now,
    }),
    sourceFiles: [
      "data/news/summaries.json",
      "data/news/source-health.json",
    ],
  };

  const report = await generateWithAnthropic(input);
  const markdown = reportToMarkdown(report);
  const previewMarkdown = reportToPreviewMarkdown(report);

  if (process.env.REPORT_DRY_RUN === "1") {
    const dryDir = process.env.TMPDIR ?? "/tmp";
    const dryJson = path.join(dryDir, `report-dryrun-${date}.json`);
    const dryMd = path.join(dryDir, `report-dryrun-${date}.md`);
    await fs.writeFile(dryJson, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await fs.writeFile(dryMd, markdown, "utf8");
    console.log(`report-dryrun: wrote ${dryJson} and ${dryMd}`);
    console.log(
      `report-summary: jurisdiction_blocks=${input.jurisdictions.length} sources_returned=${report.sources.length} word_count=${countWords(markdown)}`,
    );
    return;
  }

  await fs.mkdir(OUTPUT_DIR_JSON, { recursive: true });
  await fs.mkdir(OUTPUT_DIR_MD, { recursive: true });

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

  console.log(
    `report-summary: jurisdiction_blocks=${input.jurisdictions.length} sources_returned=${report.sources.length} word_count=${countWords(markdown)}`,
  );
  console.log(`Generated daily report JSON: ${path.relative(ROOT, jsonPath)}`);
  console.log(
    `Generated latest report JSON: ${path.relative(ROOT, latestJsonPath)}`,
  );
  console.log(`Wrote public preview: ${path.relative(ROOT, latestMdPath)}`);
  console.log(
    `Published sellable report "${SELLABLE_SLUG}" ($${SELLABLE_PRICE_USD.toFixed(2)}, ${sellableMeta.wordCount} words)`,
  );
}

export async function run(): Promise<void> {
  await main();
}

if (process.env.REPORT_SKIP_AUTORUN !== "1") {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`Daily report generation failed: ${message}`);
    process.exit(1);
  });
}
