/**
 * First-party policy-source poller. Reads `data/news/feeds.json`,
 * fetches official RSS/Atom feeds, merges structured candidates from
 * professional government APIs, dedupes by official document version
 * (or canonical URL for plain feeds), and appends summaries to
 * `data/news/summaries.json`.
 *
 * Designed to run daily via `.github/workflows/news-rss.yml`. Structured
 * adapters are bounded per run, and model calls remain protected by
 * CONCURRENCY / SUMMARY_MIN_INTERVAL_MS / MAX_HAIKU_CALLS_PER_RUN below.
 *
 * Optional evaluation-window guard:
 *   Continuous monitoring is the default. Set NEWS_POLL_MAX_DAYS to a
 *   positive integer to stop an evaluation after that many days. The
 *   start timestamp lives at `data/news/.rss-started`; to restart:
 *       npx tsx scripts/sync/news-rss.ts --restart
 *   …or just delete the file and re-run.
 *
 * Model use is hard-capped at MAX_HAIKU_CALLS_PER_RUN per run.
 */

import "../env.js";
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "../../lib/openai-llm.js";
import {
  regenerateRegions,
  regionForEntity,
  type RegionKey,
} from "./news-regional-summary.js";
import { runProfessionalSources } from "./news-professional-sources.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const NEWS_PATH = join(ROOT, "data/news/summaries.json");
const PUBLIC_NEWS_PATH = join(ROOT, "public/news-summaries.json");
const FEEDS_PATH = join(ROOT, "data/news/feeds.json");
const STARTED_PATH = join(ROOT, "data/news/.rss-started");
const SOURCE_HEALTH_PATH = join(ROOT, "data/news/source-health.json");

const MODEL = "claude-haiku-4-5-20251001";
const MAX_DAYS = Math.max(0, Number(process.env.NEWS_POLL_MAX_DAYS ?? "0") || 0);
const FETCH_TIMEOUT_MS = 15_000;
// Regulator feeds can publish dozens of unrelated notices in a month. A
// 20-item window caused relevant but less-recent policy releases to disappear
// before the daily poll could classify them.
const PER_FEED_LIMIT = 100;
const FEED_LOOKBACK_DAYS = 30;
const CONCURRENCY = 2;
const SUMMARY_MAX_TOKENS = 120;
const SUMMARY_MIN_INTERVAL_MS = 3_000;
// Circuit breaker: on the first 429 of a run, abort remaining summarize()
// calls instead of retrying. A tight-tier org's rate limit can blow up
// into a 3x-retry storm without this. SUMMARY_MAX_RETRIES applies only
// to non-429 transient errors now.
const SUMMARY_MAX_RETRIES = 3;
// Hard cap per run. Cron load is well under this; dev-triggered runs
// (which previously could hit ~500+ calls) are bounded to a survivable
// number even if invoked accidentally.
const MAX_HAIKU_CALLS_PER_RUN = 80;
const ALL_REGIONS: RegionKey[] = ["na", "eu", "asia"];

export interface FeedConfig {
  url: string;
  name: string;
  entity: string;
  topicHint?: string;
  trustedSource?: boolean;
  sourceId?: string;
  sourceType?: "official-api" | "official-feed";
  sourceAuthority?: string;
}

interface FeedsFile {
  feeds: FeedConfig[];
}

export interface NewsItem {
  id: string;
  headline: string;
  source: string;
  date: string;
  url: string;
  summary?: string;
  summarySource?: "article" | "headline-only";
  sourceId?: string;
  sourceType?: "official-api" | "official-feed";
  sourceAuthority?: string;
  officialDocumentId?: string;
  sourceVersion?: string;
  documentType?: string;
  officialPdfUrl?: string;
  commentCloseDate?: string;
  openForComment?: boolean;
  retrievedAt?: string;
  relatedDocumentIds?: string[];
}

export interface NewsFile {
  generatedAt: string;
  regional: Record<string, Record<string, unknown>>;
  entities: Record<string, { news: NewsItem[] }>;
}

type SourceHealthStatus = "healthy" | "degraded" | "failed";

interface SourceHealthFile {
  version: 1;
  checkedAt: string;
  status: SourceHealthStatus;
  officialFeeds: {
    configured: number;
    succeeded: number;
    failed: number;
    failedSourceIds: string[];
    candidateCount: number;
  };
  professionalSources: Awaited<
    ReturnType<typeof runProfessionalSources>
  >["results"];
  professionalDiscoveryError?: string;
  candidateCounts: {
    feeds: number;
    professional: number;
    total: number;
    relevantNew: number;
  };
}

export interface ParsedItem {
  title: string;
  link: string;
  pubDate: string;
  /** Official abstract / structured record text; avoids scraping when supplied. */
  contentText?: string;
  /** Structured API matches have already passed the source's full-text query. */
  prequalified?: boolean;
  officialDocumentId?: string;
  sourceVersion?: string;
  documentType?: string;
  officialPdfUrl?: string;
  commentCloseDate?: string;
  openForComment?: boolean;
  retrievedAt?: string;
  federalRegisterNumber?: string;
  relatedDocumentIds?: string[];
}

// ─── Optional evaluation-window guard ─────────────────────────────
function checkStartedGuard(): boolean {
  if (MAX_DAYS <= 0) {
    console.log("sources: continuous monitoring enabled");
    return true;
  }
  if (process.argv.includes("--restart")) {
    writeFileSync(STARTED_PATH, new Date().toISOString() + "\n");
    console.log(`rss: restarted at ${new Date().toISOString()}`);
    return true;
  }
  if (!existsSync(STARTED_PATH)) {
    writeFileSync(STARTED_PATH, new Date().toISOString() + "\n");
    console.log(`rss: first run — initialized window starting now`);
    return true;
  }
  const startedRaw = readFileSync(STARTED_PATH, "utf8").trim();
  const started = new Date(startedRaw);
  if (Number.isNaN(started.getTime())) {
    console.warn(`rss: invalid timestamp in ${STARTED_PATH}; resetting to now`);
    writeFileSync(STARTED_PATH, new Date().toISOString() + "\n");
    return true;
  }
  const ageDays = (Date.now() - started.getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays > MAX_DAYS) {
    console.log(
      `rss: window expired (${ageDays.toFixed(1)} days since ${startedRaw}). ` +
        `Run with --restart to resume.`,
    );
    return false;
  }
  console.log(
    `rss: ${ageDays.toFixed(1)} days into the ${MAX_DAYS}-day window`,
  );
  return true;
}

// ─── Minimal RSS / Atom parser ─────────────────────────────────────
// We accept the most common RSS 2.0 (<item>) and Atom (<entry>) shapes.
// The goal isn't perfect spec coverage — it's "extract title, link, and
// date for every news outlet's standard feed without taking on a dep."

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    // Numeric entities first (decimal + hex) so the named pass below
    // doesn't pick up half-decoded fragments. WordPress feeds love these.
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .trim();
}

// Wider gate for trusted first-party regulator feeds: their headlines
// rarely contain "stablecoin" verbatim ("Final rule on payment systems",
// "Supervisory letter on reserve management") so the strict RELEVANCE_RE
// would drop almost everything. Layer 2 (the Haiku NOT_RELEVANT gate in
// summarize()) catches off-topic items that slip through.
const LAYER_1_RE = new RegExp(
  [
    "\\bstable\\b",
    "stablecoin",
    "digital asset",
    "digital currency",
    "\\bcrypto",
    "\\btoken",
    "tokeniz",
    "payment system",
    "\\breserve",
    "supervisory",
    "virtual asset",
    "electronic payment instrument",
    "travel rule",
    "anti-money laundering",
    "money laundering",
    "prevention of transfer of criminal proceeds",
    "public consultation",
    "e-money",
    "asset-referenced",
  ].join("|"),
  "i",
);

// Coarse relevance gate. A new item must mention at least one of these
// keywords in its headline, otherwise it never makes it to the Haiku
// summarize step. Saves cost AND keeps off-topic noise out of the
// stablecoin policy feed.
const RELEVANCE_RE = new RegExp(
  [
    "stablecoin",
    "stable coin",
    "payment stablecoin",
    "fiat-backed token",
    "fiat backed token",
    "dollar-backed token",
    "dollar backed token",
    "digital dollar",
    "tokenized deposit",
    "genius act",
    "stable act",
    "digital asset",
    "digital asset market clarity act",
    "tokenized dollar",
    "dollar token",
    "cryptoasset",
    "crypto-asset",
    "virtual asset",
    "e-money token",
    "asset-referenced token",
    "single-currency stablecoin",
    "single currency stablecoin",
    "reserve requirement",
    "reserve backing",
    "backed by reserves",
    "issuer",
    "redemption",
    "treasury",
    "occ\\b",
    "fdic",
    "federal reserve",
    "money transmission",
    "mica",
    "markets in crypto-assets",
    "markets in crypto assets",
    "hkma",
    "\\bmas\\b",
    "\\bfsa\\b",
    "cbuae",
    "vara",
    "finma",
    "bank of england",
    "csa",
    "bank of canada",
    "banxico",
    "bcb\\b",
    "bcra",
    "cnv\\b",
    "\\bemt\\b",
    "\\bart\\b",
  ].join("|"),
  "i",
);

function isRelevant(headline: string, trusted: boolean): boolean {
  return (trusted ? LAYER_1_RE : RELEVANCE_RE).test(headline);
}

function pickTag(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = block.match(re);
  return m ? decodeEntities(m[1]) : null;
}

// Atom <link> uses an `href` attribute, not text content.
function pickAtomLink(block: string): string | null {
  const m = block.match(/<link\b[^>]*href="([^"]+)"[^>]*\/?>(?:[\s\S]*?<\/link>)?/i);
  return m ? decodeEntities(m[1]) : null;
}

function feedBodyText(block: string): string | undefined {
  const raw =
    pickTag(block, "content:encoded") ??
    pickTag(block, "description") ??
    pickTag(block, "summary") ??
    pickTag(block, "content");
  if (!raw) return undefined;
  const text = decodeEntities(raw.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
  return text || undefined;
}

export function parseFeed(xml: string): ParsedItem[] {
  const out: ParsedItem[] = [];
  // RSS 2.0
  const rssRe = /<item\b[\s\S]*?<\/item>/gi;
  for (const m of xml.matchAll(rssRe)) {
    const block = m[0];
    const title = pickTag(block, "title");
    const link = pickTag(block, "link");
    const date = pickTag(block, "pubDate") ?? pickTag(block, "dc:date") ?? "";
    if (title && link) {
      out.push({ title, link, pubDate: date, contentText: feedBodyText(block) });
    }
  }
  if (out.length > 0) return out;

  // Atom
  const atomRe = /<entry\b[\s\S]*?<\/entry>/gi;
  for (const m of xml.matchAll(atomRe)) {
    const block = m[0];
    const title = pickTag(block, "title");
    const link = pickAtomLink(block);
    const date = pickTag(block, "published") ?? pickTag(block, "updated") ?? "";
    if (title && link) {
      out.push({ title, link, pubDate: date, contentText: feedBodyText(block) });
    }
  }
  return out;
}

export function isRecognizedFeedDocument(xml: string): boolean {
  let input = xml.replace(/^\uFEFF/, "").trimStart();
  // Skip XML prolog material, then inspect the document element itself.
  // Searching the whole body would let an HTML/WAF page containing a stray
  // <feed> tag produce a false-positive health check.
  for (;;) {
    if (input.startsWith("<?")) {
      const end = input.indexOf("?>");
      if (end < 0) return false;
      input = input.slice(end + 2).trimStart();
      continue;
    }
    if (input.startsWith("<!--")) {
      const end = input.indexOf("-->");
      if (end < 0) return false;
      input = input.slice(end + 3).trimStart();
      continue;
    }
    if (/^<!doctype\b/i.test(input)) {
      let quote = "";
      let subsetDepth = 0;
      let end = -1;
      for (let index = 9; index < input.length; index += 1) {
        const char = input[index];
        if (quote) {
          if (char === quote) quote = "";
          continue;
        }
        if (char === '"' || char === "'") {
          quote = char;
        } else if (char === "[") {
          subsetDepth += 1;
        } else if (char === "]") {
          subsetDepth = Math.max(0, subsetDepth - 1);
        } else if (char === ">" && subsetDepth === 0) {
          end = index;
          break;
        }
      }
      if (end < 0) return false;
      input = input.slice(end + 1).trimStart();
      continue;
    }
    break;
  }

  const rootName = input.match(/^<([A-Za-z_][\w:.-]*)\b/)?.[1].toLowerCase();
  return (
    rootName === "rss" ||
    rootName === "feed" ||
    rootName === "rdf:rdf" ||
    Boolean(rootName?.endsWith(":feed"))
  );
}

export async function fetchFeed(url: string): Promise<string | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: {
        "user-agent": "gov-index/1.0 (news poller)",
        accept: "application/rss+xml,application/atom+xml,application/xml,text/xml,*/*",
      },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// ─── Article fetch + Haiku summarize ───────────────────────────────
async function fetchArticleText(url: string): Promise<string | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      redirect: "follow",
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
        accept: "text/html,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
      },
    });
    if (!res.ok) return null;
    return stripBoilerplate(await res.text());
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function stripBoilerplate(html: string): string | null {
  if (!html) return null;
  let s = html;
  s = s.replace(/<script[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  s = s.replace(/<nav[\s\S]*?<\/nav>/gi, " ");
  s = s.replace(/<header[\s\S]*?<\/header>/gi, " ");
  s = s.replace(/<footer[\s\S]*?<\/footer>/gi, " ");
  s = s.replace(/<aside[\s\S]*?<\/aside>/gi, " ");
  s = s.replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  s = s.replace(/\s+/g, " ").trim();
  if (s.length < 200) return null;
  return s.slice(0, 4000);
}

function getAnthropicApiKey(): string {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "OPENAI_API_KEY is missing. Add it to GitHub Actions secrets or .env.local before running news polling.",
    );
  }
  return key;
}

const client = new Anthropic({ apiKey: getAnthropicApiKey() });
let nextSummarySlotAt = 0;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForSummarySlot() {
  const now = Date.now();
  const waitMs = Math.max(0, nextSummarySlotAt - now);
  nextSummarySlotAt = Math.max(now, nextSummarySlotAt) + SUMMARY_MIN_INTERVAL_MS;
  if (waitMs > 0) {
    await sleep(waitMs);
  }
}

function isRateLimitError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const status = "status" in err ? (err as { status?: number }).status : undefined;
  if (status === 429) return true;
  const message =
    "message" in err && typeof (err as { message?: unknown }).message === "string"
      ? (err as { message: string }).message
      : "";
  return /\b429\b|rate limit/i.test(message);
}

type SummarizeGate = {
  circuitTripped: boolean;
  callsMade: number;
};

async function summarize(
  headline: string,
  source: string,
  date: string,
  body: string | null,
  trusted: boolean,
  gate: SummarizeGate,
): Promise<{ summary: string; source: "article" | "headline-only" } | null> {
  const baseSystem =
    "You write one- to two-sentence neutral summaries of news stories about stablecoin regulation, issuance, reserves, supervision, and related digital-asset policy. Plain factual prose. No editorializing.";
  const notRelevantClause = trusted
    ? " If this story is not about stablecoin / digital-asset payment policy, supervision, reserves, redemption, AML/CFT, sanctions, custody, or issuer eligibility, respond with exactly NOT_RELEVANT and nothing else."
    : "";
  const system = baseSystem + notRelevantClause;
  const userBlock = body
    ? `Headline: ${headline}\nSource: ${source} (${date})\n\nArticle body (trimmed):\n${body}\n\nWrite a 1–2 sentence neutral summary.`
    : `Headline: ${headline}\nSource: ${source} (${date})\n\nThe article body could not be retrieved. Write one factual sentence based on the headline alone — do not invent specifics.`;
  if (gate.circuitTripped) return null;
  if (gate.callsMade >= MAX_HAIKU_CALLS_PER_RUN) return null;
  gate.callsMade++;
  for (let attempt = 1; attempt <= SUMMARY_MAX_RETRIES; attempt++) {
    await waitForSummarySlot();
    try {
      const res = await client.messages.create({
        model: MODEL,
        cost_label: "news-item-summary",
        max_tokens: SUMMARY_MAX_TOKENS,
        system,
        messages: [{ role: "user", content: userBlock }],
      });
      const text = res.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { type: "text"; text: string }).text.trim())
        .join(" ")
        .trim();
      if (!text) return null;
      if (text.startsWith("NOT_RELEVANT")) return null;
      return { summary: text, source: body ? "article" : "headline-only" };
    } catch (err) {
      if (isRateLimitError(err)) {
        if (!gate.circuitTripped) {
          gate.circuitTripped = true;
          console.warn(
            `  summarize: 429 hit — circuit tripped. Remaining items in this run will skip Haiku.`,
          );
        }
        return null;
      }
      if (attempt < SUMMARY_MAX_RETRIES) {
        const backoffMs = attempt * 5_000;
        console.warn(
          `  summarize transient error; retrying in ${(backoffMs / 1000).toFixed(0)}s ` +
            `(attempt ${attempt + 1}/${SUMMARY_MAX_RETRIES})`,
        );
        await sleep(backoffMs);
        continue;
      }
      console.error("  summarize failed:", (err as Error).message);
      return null;
    }
  }
  return null;
}

// ─── Plumbing ──────────────────────────────────────────────────────
function normalizeDate(raw: string): string {
  if (!raw) return new Date().toISOString().slice(0, 10);
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "oc",
  "ref",
]);

function canonicalizeUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith("utm_") || TRACKING_PARAMS.has(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return raw.trim();
  }
}

function storedItemKey(item: NewsItem): string {
  if (item.sourceId && item.officialDocumentId) {
    return [
      "official",
      item.sourceId,
      item.officialDocumentId,
      item.sourceVersion ?? "unversioned",
    ].join(":");
  }
  return `url:${canonicalizeUrl(item.url)}`;
}

function pendingItemKey(item: PendingItem): string {
  const { feed, parsed } = item;
  if (feed.sourceId && parsed.officialDocumentId) {
    return [
      "official",
      feed.sourceId,
      parsed.officialDocumentId,
      parsed.sourceVersion ?? "unversioned",
    ].join(":");
  }
  return `url:${canonicalizeUrl(parsed.link)}`;
}

function slugifyId(name: string, url: string): string {
  // Stable id: feed slug + last url segment hash. Avoids id collisions
  // across feeds while staying human-readable in the JSON.
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);
  let h = 0;
  for (let i = 0; i < url.length; i++) h = (h * 31 + url.charCodeAt(i)) | 0;
  const hash = Math.abs(h).toString(36).slice(0, 8);
  return `rss-${slug}-${hash}`;
}

export interface PendingItem {
  feed: FeedConfig;
  parsed: ParsedItem;
}

async function runPool<T>(items: T[], worker: (t: T) => Promise<void>) {
  let i = 0;
  const runners: Promise<void>[] = [];
  for (let k = 0; k < Math.min(CONCURRENCY, items.length); k++) {
    runners.push(
      (async () => {
        while (i < items.length) {
          await worker(items[i++]);
        }
      })(),
    );
  }
  await Promise.all(runners);
}

async function main() {
  if (!checkStartedGuard()) {
    throw new Error(
      "NEWS_POLL_MAX_DAYS evaluation window has expired; paid-report generation is disabled until the window is restarted or removed.",
    );
  }

  const feedsCfg = JSON.parse(readFileSync(FEEDS_PATH, "utf8")) as FeedsFile;
  const news = JSON.parse(readFileSync(NEWS_PATH, "utf8")) as NewsFile;

  // Official APIs can update a document in place. Their dedupe key therefore
  // includes the source's version marker; plain RSS items use canonical URLs.
  const seenKeys = new Set<string>();
  for (const ent of Object.values(news.entities)) {
    for (const item of ent.news) seenKeys.add(storedItemKey(item));
  }

  // Pull every feed in parallel (network-bound, cheap to fan out).
  const feedRuns = await Promise.all(
    feedsCfg.feeds.map(async (f) => {
      const xml = await fetchFeed(f.url);
      if (!xml) {
        console.warn(`  feed FAIL: ${f.name} (${f.url})`);
        return {
          feed: f,
          succeeded: false,
          candidates: [] as PendingItem[],
        };
      }
      if (!isRecognizedFeedDocument(xml)) {
        console.warn(
          `  feed FAIL: ${f.name} returned HTTP success but not an RSS/Atom document (${f.url})`,
        );
        return {
          feed: f,
          succeeded: false,
          candidates: [] as PendingItem[],
        };
      }
      const feedCutoff = Date.now() - FEED_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
      const parsed = parseFeed(xml)
        .filter((item) => {
          const timestamp = Date.parse(item.pubDate);
          return Number.isFinite(timestamp) && timestamp >= feedCutoff;
        })
        .slice(0, PER_FEED_LIMIT);
      return {
        feed: f,
        succeeded: true,
        candidates: parsed.map((p) => ({ feed: f, parsed: p })),
      };
    }),
  );

  const rssCandidates = feedRuns.flatMap((run) => run.candidates);

  let professionalCandidates: PendingItem[] = [];
  let professionalResults: Awaited<ReturnType<typeof runProfessionalSources>>["results"] = [];
  let professionalDiscoveryError: string | undefined;
  try {
    const run = await runProfessionalSources();
    professionalCandidates = run.candidates;
    professionalResults = run.results;
    for (const result of professionalResults) {
      console.log(
        `  professional ${result.sourceId}: ${result.status} ` +
          `raw=${result.rawItemCount} candidates=${result.candidateCount} ` +
          `merged=${result.mergedIntoOtherSources} duration_ms=${result.durationMs}` +
          `${result.note ? ` (${result.note})` : ""}`,
      );
      for (const error of result.errors) {
        console.warn(`    ${result.sourceId}: ${error}`);
      }
    }
  } catch (err) {
    professionalDiscoveryError = (err as Error).message;
    console.warn(
      `professional-source discovery failed: ${professionalDiscoveryError} — continuing with official feeds only`,
    );
  }

  const candidates: PendingItem[] = [...professionalCandidates, ...rssCandidates];
  const unknownEntities = new Map<string, number>();
  const runKeys = new Set<string>();
  const layer1Survivors = candidates.filter((c) => {
    if (!news.entities[c.feed.entity]) {
      unknownEntities.set(c.feed.entity, (unknownEntities.get(c.feed.entity) ?? 0) + 1);
      return false;
    }
    const key = pendingItemKey(c);
    if (seenKeys.has(key) || runKeys.has(key)) return false;
    const discoveryText = [c.parsed.title, c.parsed.contentText]
      .filter(Boolean)
      .join("\n");
    if (
      !c.parsed.prequalified &&
      !isRelevant(discoveryText, c.feed.trustedSource ?? false)
    ) {
      return false;
    }
    runKeys.add(key);
    return true;
  });
  const pending = layer1Survivors;

  const layer1KeptTrusted = layer1Survivors.filter((c) => c.feed.trustedSource).length;
  const layer1KeptUntrusted = layer1Survivors.length - layer1KeptTrusted;
  const filteredOut = candidates.length - pending.length;
  console.log(
    `sources: ${candidates.length} items (feeds=${rssCandidates.length} professional=${professionalCandidates.length}); ` +
      `${pending.length} new + relevant (${filteredOut} skipped: dup or off-topic)`,
  );
  if (unknownEntities.size > 0) {
    console.warn(
      `sources: skipped candidates for unknown entity buckets: ${[...unknownEntities.entries()]
        .map(([entity, count]) => `${entity}=${count}`)
        .join(", ")}`,
      );
  }

  const failedFeedRuns = feedRuns.filter((run) => !run.succeeded);
  const successfulProfessionalSources = professionalResults.filter(
    (result) => result.status === "ok" || result.status === "partial",
  );
  const failedProfessionalSources = professionalResults.filter(
    (result) => result.status === "failed",
  );
  const successfulSourceCount =
    feedRuns.length - failedFeedRuns.length + successfulProfessionalSources.length;
  const failedSourceCount =
    failedFeedRuns.length +
    failedProfessionalSources.length +
    (professionalDiscoveryError ? 1 : 0);
  const sourceHealth: SourceHealthFile = {
    version: 1,
    checkedAt: new Date().toISOString(),
    status:
      successfulSourceCount === 0
        ? "failed"
        : failedSourceCount > 0
          ? "degraded"
          : "healthy",
    officialFeeds: {
      configured: feedRuns.length,
      succeeded: feedRuns.length - failedFeedRuns.length,
      failed: failedFeedRuns.length,
      failedSourceIds: failedFeedRuns
        .map((run) => run.feed.sourceId ?? run.feed.name)
        .sort(),
      candidateCount: rssCandidates.length,
    },
    professionalSources: professionalResults,
    professionalDiscoveryError,
    candidateCounts: {
      feeds: rssCandidates.length,
      professional: professionalCandidates.length,
      total: candidates.length,
      relevantNew: pending.length,
    },
  };

  if (process.env.NEWS_RSS_DRY_RUN === "1") {
    const dryDir = process.env.TMPDIR ?? "/tmp";
    const dryPath = `${dryDir}/news-rss-dryrun-${new Date().toISOString().slice(0,10)}.json`;
    const fsMod = await import("node:fs/promises");
    const wouldCallHaiku = Math.min(
      pending.length,
      MAX_HAIKU_CALLS_PER_RUN,
    );
    const dryOut = {
      generatedAt: new Date().toISOString(),
      summary: {
        candidates: candidates.length,
        layer1Kept: layer1Survivors.length,
        layer1KeptTrusted,
        layer1KeptUntrusted,
        wouldCallHaiku,
        deferredByRunCap: Math.max(0, pending.length - wouldCallHaiku),
        professionalSources: professionalResults,
        sourceHealth,
      },
      candidates: pending.map((c) => ({
        feed: {
          name: c.feed.name,
          entity: c.feed.entity,
          trustedSource: c.feed.trustedSource ?? false,
          sourceId: c.feed.sourceId,
          sourceType: c.feed.sourceType,
          sourceAuthority: c.feed.sourceAuthority,
        },
        parsed: {
          title: c.parsed.title,
          link: c.parsed.link,
          pubDate: c.parsed.pubDate,
          officialDocumentId: c.parsed.officialDocumentId,
          sourceVersion: c.parsed.sourceVersion,
          documentType: c.parsed.documentType,
          officialPdfUrl: c.parsed.officialPdfUrl,
          commentCloseDate: c.parsed.commentCloseDate,
          openForComment: c.parsed.openForComment,
        },
      })),
    };
    await fsMod.writeFile(dryPath, JSON.stringify(dryOut, null, 2) + "\n", "utf8");
    console.log(`news-rss-dryrun: wrote ${pending.length} candidates to ${dryPath}`);
    console.log(
      `news-rss-dryrun: would have called Haiku ${wouldCallHaiku} time(s)` +
        `${pending.length > wouldCallHaiku ? ` and deferred ${pending.length - wouldCallHaiku} by the run cap` : ""}. ` +
        `No API calls made. No files written outside /tmp.`,
    );
    return;
  }

  writeFileSync(SOURCE_HEALTH_PATH, JSON.stringify(sourceHealth, null, 2) + "\n");
  console.log(
    `sources: health=${sourceHealth.status} succeeded=${successfulSourceCount} failed=${failedSourceCount}; ` +
      `wrote ${SOURCE_HEALTH_PATH}`,
  );
  if (sourceHealth.status === "failed") {
    throw new Error(
      "All configured official sources failed; refusing to continue to paid-report generation.",
    );
  }
  if (pending.length === 0) {
    console.log("sources: no new relevant official items; health checkpoint refreshed");
    return;
  }

  const summarizeGate: SummarizeGate = { circuitTripped: false, callsMade: 0 };
  let added = 0;
  let layer2Dropped = 0;
  let professionalAdded = 0;
  let trustedAdded = 0;
  const touchedRegions = new Set<RegionKey>();
  await runPool<PendingItem>(pending, async ({ feed, parsed }) => {
    // Don't reprocess the same official version (or canonical feed URL) if
    // another source in this run already yielded it.
    const dedupeKey = pendingItemKey({ feed, parsed });
    if (seenKeys.has(dedupeKey)) return;
    seenKeys.add(dedupeKey);

    const body = parsed.contentText ?? await fetchArticleText(parsed.link);
    const sum = await summarize(parsed.title, feed.name, parsed.pubDate, body, feed.trustedSource ?? false, summarizeGate);
    if (!sum) {
      // Either Haiku failed, returned empty, or returned NOT_RELEVANT.
      // We can't cheaply distinguish here, so count as layer2 drop only
      // when the feed was trusted (where NOT_RELEVANT is the gate).
      if (feed.trustedSource) layer2Dropped++;
      return;
    }

    const entityBucket = news.entities[feed.entity];
    if (!entityBucket) {
      console.warn(`  no entity bucket "${feed.entity}" — skipping`);
      return;
    }

    entityBucket.news.unshift({
      id: slugifyId(feed.name, `${parsed.link}|${parsed.sourceVersion ?? ""}`),
      headline: parsed.title.slice(0, 220),
      source: feed.name,
      date: normalizeDate(parsed.pubDate),
      url: parsed.link,
      summary: sum.summary,
      summarySource: sum.source,
      sourceId: feed.sourceId,
      sourceType: feed.sourceType,
      sourceAuthority: feed.sourceAuthority,
      officialDocumentId: parsed.officialDocumentId,
      sourceVersion: parsed.sourceVersion,
      documentType: parsed.documentType,
      officialPdfUrl: parsed.officialPdfUrl,
      commentCloseDate: parsed.commentCloseDate,
      openForComment: parsed.openForComment,
      retrievedAt: parsed.retrievedAt,
      relatedDocumentIds: parsed.relatedDocumentIds,
    });
    added++;
    if (feed.sourceType === "official-api") professionalAdded++;
    if (feed.trustedSource) trustedAdded++;
    touchedRegions.add(regionForEntity(feed.entity));

    // Checkpoint every few items so a transient crash doesn't lose work.
    if (added % 5 === 0) {
      writeFileSync(NEWS_PATH, JSON.stringify(news, null, 2) + "\n");
    }
  });

  // Re-sort each touched bucket newest-first.
  for (const ent of Object.values(news.entities)) {
    ent.news.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  }

  // Re-evaluate every AI Overview region whenever the dataset changes.
  // This also clears a stale legacy summary when that region no longer has
  // official evidence inside the 30-day window. Limiting this to touched
  // regions previously left AP showing pre-migration Google-search content.
  if (touchedRegions.size > 0) {
    console.log(
      `rss: regenerating AI overview for all regions ` +
        `(new items touched: ${[...touchedRegions].join(", ")})`,
    );
    const updated = await regenerateRegions(news, ALL_REGIONS);
    console.log(`rss: regenerated ${updated.length} region summary(ies)`);
  }

  console.log(
    `rss-summary: candidates=${candidates.length} ` +
      `layer1_kept=${layer1Survivors.length} ` +
      `(trusted=${layer1KeptTrusted}, untrusted=${layer1KeptUntrusted}) ` +
      `layer2_dropped=${layer2Dropped} added=${added} ` +
      `(trusted=${trustedAdded}, professional=${professionalAdded}) ` +
      `haiku_calls=${summarizeGate.callsMade}/${MAX_HAIKU_CALLS_PER_RUN}` +
      `${summarizeGate.circuitTripped ? " circuit_tripped=true" : ""}`,
  );
  news.generatedAt = new Date().toISOString();
  writeFileSync(NEWS_PATH, JSON.stringify(news, null, 2) + "\n");
  copyFileSync(NEWS_PATH, PUBLIC_NEWS_PATH);
  console.log(`rss: added ${added} new item(s)`);
  console.log("rss: synced public/news-summaries.json");

  // The UI reads ENTITIES from lib/placeholder-data.ts (generated), not
  // from data/news/summaries.json directly — so the new items have to be
  // baked back in for them to actually reach the page. Skip when nothing
  // new landed (rebuild is fast but pointless on quiet polls).
  if (added > 0) {
    console.log("rss: rebuilding placeholder-data.ts so new items reach the UI");
    execSync("npx tsx scripts/build-placeholder.ts", { stdio: "inherit" });
  }
}

export async function run(): Promise<void> {
  await main();
}

if (process.env.NEWS_RSS_SKIP_AUTORUN !== "1") {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
