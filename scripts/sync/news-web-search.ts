// scripts/sync/news-web-search.ts
/**
 * Dynamic top-up layer that synthesizes Google News RSS queries each
 * poll to plug gaps in the static feeds list. Never replaces RSS — only
 * augments it.
 *
 * Free: uses news.google.com/rss/search, no API key, no quota.
 *
 * runWebSearch() is called from news-rss.ts main() right after the static
 * fan-out, and returns PendingItems that flow through the same dedupe /
 * relevance / Haiku path as RSS items.
 */
import "../env.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  fetchFeed,
  parseFeed,
  type FeedConfig,
  type NewsFile,
  type NewsItem,
  type ParsedItem,
  type PendingItem,
} from "./news-rss.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const ROTATION_PATH = join(ROOT, "data/news/.site-rotation");
const RECENT_WINDOW_DAYS = 7;
const MAX_QUERIES_PER_RUN = 6;
const MAX_JURISDICTION_GAP_QUERIES = 3;
const MAX_KEYWORD_QUERIES = 2;
const MAX_SITE_QUERIES = 1;
const PER_QUERY_ITEM_LIMIT = 20;

// PendingItem is imported from news-rss.ts (Task 4 export). Re-export
// for callers (notably the smoke script).
export type { PendingItem };

// ─── Pure builders ─────────────────────────────────────────────────

type Region = "na" | "eu" | "asia";

const EU_ENTITIES = new Set([
  "Netherlands", "Ireland", "Sweden", "Finland", "Germany", "France",
  "United Kingdom", "Spain", "Italy", "Poland", "Denmark", "Norway",
  "Belgium", "Austria", "Portugal", "Greece", "Czech Republic", "Czechia",
  "Switzerland", "Luxembourg", "European Union",
]);
const ASIA_ENTITIES = new Set([
  "Japan", "China", "South Korea", "Republic of Korea", "Singapore",
  "India", "Taiwan", "Indonesia", "Australia", "Malaysia", "Thailand",
  "Vietnam", "Philippines", "Hong Kong",
]);

function regionForEntity(name: string): Region {
  if (EU_ENTITIES.has(name)) return "eu";
  if (ASIA_ENTITIES.has(name)) return "asia";
  return "na";
}

const REGION_GAP_QUERY_TEMPLATE: Record<Region, { keywords: string; defaultEntity: string }> = {
  na: {
    keywords: "stablecoin (regulation OR rule OR legislation OR licensing) (US OR Federal OR Treasury OR OCC OR \"Federal Reserve\")",
    defaultEntity: "United States",
  },
  eu: {
    keywords: "stablecoin (MiCA OR EBA OR ESMA OR ECB OR \"European Union\")",
    defaultEntity: "European Union",
  },
  asia: {
    keywords: "stablecoin (HKMA OR MAS OR FSA OR \"Bank of Japan\" OR \"Hong Kong\" OR Singapore)",
    defaultEntity: "Singapore",
  },
};

const ROLLING_KEYWORD_QUERIES: Array<{ query: string; defaultEntity: string; hint: string }> = [
  { query: "\"GENIUS Act\" stablecoin", defaultEntity: "United States", hint: "genius" },
  { query: "\"CLARITY Act\" stablecoin", defaultEntity: "United States", hint: "clarity" },
  { query: "MiCA stablecoin amendment", defaultEntity: "European Union", hint: "mica" },
  { query: "\"payment stablecoin\" issuer", defaultEntity: "United States", hint: "payment-issuer" },
  { query: "stablecoin \"reserve\" amendment", defaultEntity: "United States", hint: "reserve-amendment" },
];

const SITE_ROTATION: Array<{ query: string; defaultEntity: string }> = [
  { query: "stablecoin site:occ.gov", defaultEntity: "United States" },
  { query: "stablecoin site:fdic.gov", defaultEntity: "United States" },
  { query: "stablecoin site:treasury.gov", defaultEntity: "United States" },
  { query: "stablecoin site:hkma.gov.hk", defaultEntity: "Hong Kong" },
  { query: "stablecoin site:fsa.go.jp", defaultEntity: "Japan" },
];

// host (lowercased, no port) → entity name. First match wins. Used to
// override the query's defaultEntity when the URL we got back is from a
// recognizable host.
const HOST_TO_ENTITY: Array<{ pattern: RegExp; entity: string }> = [
  { pattern: /(^|\.)fca\.org\.uk$/, entity: "United Kingdom" },
  { pattern: /(^|\.)bankofengland\.co\.uk$/, entity: "United Kingdom" },
  { pattern: /(^|\.)ecb\.europa\.eu$/, entity: "European Union" },
  { pattern: /(^|\.)eba\.europa\.eu$/, entity: "European Union" },
  { pattern: /(^|\.)esma\.europa\.eu$/, entity: "European Union" },
  { pattern: /(^|\.)hkma\.gov\.hk$/, entity: "Hong Kong" },
  { pattern: /(^|\.)mas\.gov\.sg$/, entity: "Singapore" },
  { pattern: /(^|\.)fsa\.go\.jp$/, entity: "Japan" },
  { pattern: /(^|\.)federalreserve\.gov$/, entity: "United States" },
  { pattern: /(^|\.)treasury\.gov$/, entity: "United States" },
  { pattern: /(^|\.)occ\.gov$/, entity: "United States" },
  { pattern: /(^|\.)fdic\.gov$/, entity: "United States" },
  { pattern: /(^|\.)sec\.gov$/, entity: "United States" },
  { pattern: /(^|\.)cftc\.gov$/, entity: "United States" },
  { pattern: /(^|\.)bafin\.de$/, entity: "Germany" },
];

export function hostToEntity(rawUrl: string, fallback: string): string {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    for (const m of HOST_TO_ENTITY) if (m.pattern.test(host)) return m.entity;
  } catch {
    /* malformed URL — fall through to fallback */
  }
  return fallback;
}

function countRecentForRegion(news: NewsFile, region: Region, now: number): number {
  const cutoff = now - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  let n = 0;
  for (const [entity, body] of Object.entries(news.entities)) {
    if (regionForEntity(entity) !== region) continue;
    for (const item of body.news) {
      const t = Date.parse(item.date);
      if (Number.isFinite(t) && t >= cutoff) n++;
    }
  }
  return n;
}

function buildGoogleNewsUrl(query: string): string {
  const u = new URL("https://news.google.com/rss/search");
  u.searchParams.set("q", query);
  u.searchParams.set("hl", "en-US");
  u.searchParams.set("gl", "US");
  u.searchParams.set("ceid", "US:en");
  return u.toString();
}

export interface PlannedQuery {
  url: string;
  query: string;
  defaultEntity: string;
  kind: "gap" | "keyword" | "site";
}

function pickJurisdictionGapQueries(news: NewsFile, now: number): PlannedQuery[] {
  const out: PlannedQuery[] = [];
  for (const region of ["na", "eu", "asia"] as Region[]) {
    if (countRecentForRegion(news, region, now) >= 3) continue;
    const tpl = REGION_GAP_QUERY_TEMPLATE[region];
    out.push({
      url: buildGoogleNewsUrl(tpl.keywords),
      query: tpl.keywords,
      defaultEntity: tpl.defaultEntity,
      kind: "gap",
    });
    if (out.length >= MAX_JURISDICTION_GAP_QUERIES) break;
  }
  return out;
}

function pickKeywordQueries(news: NewsFile, now: number): PlannedQuery[] {
  // Skip a keyword if any item in the last 7d already mentions the hint
  // case-insensitively in headline OR summary. Cheap heuristic, prevents
  // redundant Google News calls when the topic is already covered.
  const cutoff = now - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const recentText: string[] = [];
  for (const body of Object.values(news.entities)) {
    for (const item of body.news) {
      const t = Date.parse(item.date);
      if (Number.isFinite(t) && t >= cutoff) {
        recentText.push(`${item.headline} ${item.summary ?? ""}`.toLowerCase());
      }
    }
  }
  const covered = (hint: string) => recentText.some((t) => t.includes(hint));
  const out: PlannedQuery[] = [];
  for (const candidate of ROLLING_KEYWORD_QUERIES) {
    if (covered(candidate.hint)) continue;
    out.push({
      url: buildGoogleNewsUrl(candidate.query),
      query: candidate.query,
      defaultEntity: candidate.defaultEntity,
      kind: "keyword",
    });
    if (out.length >= MAX_KEYWORD_QUERIES) break;
  }
  return out;
}

function readRotationIndex(): number {
  if (!existsSync(ROTATION_PATH)) return 0;
  try {
    const raw = readFileSync(ROTATION_PATH, "utf8").trim();
    const parsed = JSON.parse(raw) as { lastIndex?: number };
    const idx = parsed.lastIndex;
    return Number.isInteger(idx) ? ((idx as number) + 1) % SITE_ROTATION.length : 0;
  } catch {
    return 0;
  }
}

function writeRotationIndex(idx: number): void {
  try {
    writeFileSync(ROTATION_PATH, JSON.stringify({ lastIndex: idx }) + "\n");
  } catch {
    /* non-fatal; rotation will reset on next run */
  }
}

function pickSiteRotationQuery(): PlannedQuery | null {
  if (MAX_SITE_QUERIES <= 0) return null;
  const idx = readRotationIndex();
  const pick = SITE_ROTATION[idx];
  writeRotationIndex(idx);
  return {
    url: buildGoogleNewsUrl(pick.query),
    query: pick.query,
    defaultEntity: pick.defaultEntity,
    kind: "site",
  };
}

/**
 * Compose up to MAX_QUERIES_PER_RUN planned queries for this poll. Pure
 * (modulo the .site-rotation read/write) so it is easy to dry-run via
 * scripts/smoke/web-search-dryrun.ts.
 */
export function buildQueries(news: NewsFile, now: number = Date.now()): PlannedQuery[] {
  const plans: PlannedQuery[] = [];
  plans.push(...pickJurisdictionGapQueries(news, now));
  plans.push(...pickKeywordQueries(news, now));
  const site = pickSiteRotationQuery();
  if (site) plans.push(site);
  return plans.slice(0, MAX_QUERIES_PER_RUN);
}
