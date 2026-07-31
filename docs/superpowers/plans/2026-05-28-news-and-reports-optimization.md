# News Sourcing and Daily Report Optimization Implementation Plan

> **Historical plan:** its Google News/web-search tasks are no longer active.
> **DO NOT EXECUTE THE INSTRUCTIONS BELOW.** They are retained only as an
> implementation record and reference files that have since been deleted.
> The 2026-07-30 replacement is documented in
> [`../../professional-source-migration.md`](../../professional-source-migration.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Widen free news sourcing (regulator RSS + dynamic Google News top-up + two-layer relevance gate) and rewrite the daily sellable report with per-jurisdiction prompt blocks and a Sources list — zero incremental API cost.

**Architecture:** Add 9 first-party regulator RSS feeds and 5 Google News `site:`-proxy feeds to `feeds.json` with a new `trustedSource` flag. Trusted-source items use a wider Layer-1 regex plus a Layer-2 Haiku gate (`NOT_RELEVANT` sentinel). A new `news-web-search.ts` runs after every RSS poll and synthesizes up to 6 dynamic Google News queries based on jurisdiction gaps, rolling keywords, and a rotating `site:` query. The daily report's input is restructured into per-jurisdiction blocks (last 7 days, ≤10 items each), the Sonnet prompt is split into system/user, the output schema gains a `sources` field validated against input URLs, and the fallback no longer fabricates content.

**Tech Stack:** TypeScript, `tsx` for script execution, `@anthropic-ai/sdk` (Haiku for item summaries, Sonnet for the daily report), Next.js 16 (only `data/` and `scripts/` touched, no app routes). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-28-news-and-reports-optimization-design.md`

---

## Pre-flight

- [ ] **Step 0: Verify clean working tree**

Run:
```bash
git -C /Users/kidinamoto/Documents/work/stablecoin-policy status --short
```
Expected: empty output (or unrelated files only — never `data/news/feeds.json`, `scripts/sync/news-rss.ts`, `scripts/reports/generate-daily-report.ts`).

- [ ] **Step 1: Confirm env**

Run:
```bash
node --version && npx tsx --version
```
Expected: Node ≥ 20, `tsx` resolves. `ANTHROPIC_API_KEY` is needed for live report dry-run in Task 12 but not for any earlier task.

---

## Task 1: Smoke script — `feeds-ping.ts`

This is the first acceptance criterion. We write it before changing `feeds.json` so it can validate every later feed addition.

**Files:**
- Create: `scripts/smoke/feeds-ping.ts`

- [ ] **Step 1: Create the smoke script**

```ts
// scripts/smoke/feeds-ping.ts
/**
 * Health-check every feed in data/news/feeds.json.
 *
 * - Direct RSS feeds: HEAD must return 2xx OR the body must contain at least
 *   one <item>/<entry>.
 * - Google News RSS feeds (URL host news.google.com): GET and require at
 *   least 1 <item>.
 *
 * Exits non-zero if any feed fails so this can run on CI.
 */
import "../env.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const FEEDS_PATH = join(ROOT, "data/news/feeds.json");
const TIMEOUT_MS = 15_000;
const USER_AGENT = "gov-index/1.0 (rss feed smoke)";

interface FeedConfig {
  url: string;
  name: string;
  entity: string;
  topicHint?: string;
  trustedSource?: boolean;
}
interface FeedsFile { feeds: FeedConfig[]; }

async function check(feed: FeedConfig): Promise<{ ok: boolean; status: string; items: number }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(feed.url, {
      signal: ctl.signal,
      redirect: "follow",
      headers: {
        "user-agent": USER_AGENT,
        accept: "application/rss+xml,application/atom+xml,application/xml,text/xml,*/*",
      },
    });
    if (!res.ok) return { ok: false, status: `HTTP ${res.status}`, items: 0 };
    const body = await res.text();
    const items = (body.match(/<item\b/gi)?.length ?? 0) + (body.match(/<entry\b/gi)?.length ?? 0);
    return { ok: items > 0, status: items > 0 ? `HTTP ${res.status}` : `HTTP ${res.status} (0 items)`, items };
  } catch (err) {
    return { ok: false, status: (err as Error).name === "AbortError" ? "TIMEOUT" : `ERR ${(err as Error).message}`, items: 0 };
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  const feeds = (JSON.parse(readFileSync(FEEDS_PATH, "utf8")) as FeedsFile).feeds;
  console.log(`feeds-ping: checking ${feeds.length} feed(s)`);
  let failures = 0;
  // Light concurrency to be polite.
  const CONCURRENCY = 6;
  const results: { feed: FeedConfig; result: Awaited<ReturnType<typeof check>> }[] = [];
  let i = 0;
  const runners: Promise<void>[] = [];
  for (let k = 0; k < Math.min(CONCURRENCY, feeds.length); k++) {
    runners.push((async () => {
      while (i < feeds.length) {
        const idx = i++;
        const feed = feeds[idx];
        const result = await check(feed);
        results.push({ feed, result });
        if (!result.ok) failures++;
        const flag = feed.trustedSource ? " [trusted]" : "";
        console.log(`  ${result.ok ? "OK  " : "FAIL"} items=${String(result.items).padStart(3, " ")} ${result.status.padEnd(20, " ")} ${feed.name}${flag}`);
      }
    })());
  }
  await Promise.all(runners);
  console.log(`feeds-ping: ${results.length - failures}/${results.length} ok, ${failures} failure(s)`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error("feeds-ping crashed:", err);
  process.exit(2);
});
```

- [ ] **Step 2: Run smoke against current feeds.json**

Run:
```bash
npx tsx scripts/smoke/feeds-ping.ts
```
Expected: every existing Google News feed returns OK (or at most 1–2 transient failures from Google News which the script will surface). Exit code 0 if all pass.

- [ ] **Step 3: Commit**

```bash
git add scripts/smoke/feeds-ping.ts
git commit -m "feat(smoke): add feeds-ping health check for news RSS feeds"
```

---

## Task 2: Add 14 regulator + site-proxy feeds with `trustedSource` flag

**Files:**
- Modify: `data/news/feeds.json`

- [ ] **Step 1: Append the 14 new feed entries**

Insert these objects into the `feeds[]` array in `data/news/feeds.json` (just before the closing `]`). Preserve the trailing comma on the previous entry:

```json
    {
      "url": "https://www.federalreserve.gov/feeds/press_all.xml",
      "name": "Federal Reserve Board — Press Releases",
      "entity": "United States",
      "topicHint": "stablecoin-policy",
      "trustedSource": true
    },
    {
      "url": "https://www.sec.gov/news/pressreleases.rss",
      "name": "SEC — Press Releases",
      "entity": "United States",
      "topicHint": "stablecoin-policy",
      "trustedSource": true
    },
    {
      "url": "https://www.cftc.gov/PressRoom/PressReleases/rss",
      "name": "CFTC — Press Releases",
      "entity": "United States",
      "topicHint": "stablecoin-policy",
      "trustedSource": true
    },
    {
      "url": "https://www.fca.org.uk/news/rss.xml",
      "name": "FCA — News",
      "entity": "United Kingdom",
      "topicHint": "stablecoin-policy",
      "trustedSource": true
    },
    {
      "url": "https://www.bankofengland.co.uk/rss/news",
      "name": "Bank of England — News",
      "entity": "United Kingdom",
      "topicHint": "stablecoin-policy",
      "trustedSource": true
    },
    {
      "url": "https://www.eba.europa.eu/rss.xml",
      "name": "EBA — News",
      "entity": "European Union",
      "topicHint": "stablecoin-policy",
      "trustedSource": true
    },
    {
      "url": "https://www.esma.europa.eu/rss.xml",
      "name": "ESMA — News",
      "entity": "European Union",
      "topicHint": "stablecoin-policy",
      "trustedSource": true
    },
    {
      "url": "https://www.ecb.europa.eu/rss/press.html",
      "name": "ECB — Press Releases",
      "entity": "European Union",
      "topicHint": "stablecoin-policy",
      "trustedSource": true
    },
    {
      "url": "https://www.mas.gov.sg/rss/news",
      "name": "MAS — News",
      "entity": "Singapore",
      "topicHint": "stablecoin-policy",
      "trustedSource": true
    },
    {
      "url": "https://news.google.com/rss/search?q=stablecoin+site%3Aocc.gov&hl=en-US&gl=US&ceid=US:en",
      "name": "Google News — site:occ.gov stablecoin",
      "entity": "United States",
      "topicHint": "stablecoin-policy"
    },
    {
      "url": "https://news.google.com/rss/search?q=stablecoin+site%3Afdic.gov&hl=en-US&gl=US&ceid=US:en",
      "name": "Google News — site:fdic.gov stablecoin",
      "entity": "United States",
      "topicHint": "stablecoin-policy"
    },
    {
      "url": "https://news.google.com/rss/search?q=stablecoin+site%3Atreasury.gov&hl=en-US&gl=US&ceid=US:en",
      "name": "Google News — site:treasury.gov stablecoin",
      "entity": "United States",
      "topicHint": "stablecoin-policy"
    },
    {
      "url": "https://news.google.com/rss/search?q=stablecoin+site%3Ahkma.gov.hk&hl=en-US&gl=US&ceid=US:en",
      "name": "Google News — site:hkma.gov.hk stablecoin",
      "entity": "Hong Kong",
      "topicHint": "stablecoin-policy"
    },
    {
      "url": "https://news.google.com/rss/search?q=stablecoin+site%3Afsa.go.jp&hl=en-US&gl=US&ceid=US:en",
      "name": "Google News — site:fsa.go.jp stablecoin",
      "entity": "Japan",
      "topicHint": "stablecoin-policy"
    }
```

- [ ] **Step 2: Verify JSON parses**

Run:
```bash
node -e "JSON.parse(require('fs').readFileSync('data/news/feeds.json','utf8')); console.log('ok')"
```
Expected: `ok`.

- [ ] **Step 3: Run feeds-ping against the expanded feeds.json**

Run:
```bash
npx tsx scripts/smoke/feeds-ping.ts
```
Expected: all 14 new feeds report OK with items ≥ 1. If a regulator URL fails, do not patch by guessing — instead substitute the corresponding `https://news.google.com/rss/search?q=stablecoin+site:<host>` proxy (and remove the `trustedSource: true` flag for that entry) and re-run.

- [ ] **Step 4: Commit**

```bash
git add data/news/feeds.json
git commit -m "feat(news): add 9 regulator RSS + 5 Google News site-proxy feeds"
```

---

## Task 3: Two-layer relevance filter in `news-rss.ts`

**Files:**
- Modify: `scripts/sync/news-rss.ts`

- [ ] **Step 1: Add `trustedSource` to `FeedConfig` and add `LAYER_1_RE`**

In `scripts/sync/news-rss.ts`, update the `FeedConfig` interface (around line 49) to add the new field, and add `LAYER_1_RE` immediately above the existing `RELEVANCE_RE`:

```ts
interface FeedConfig {
  url: string;
  name: string;
  entity: string;
  topicHint?: string;
  trustedSource?: boolean;
}
```

Then, immediately before the `const RELEVANCE_RE = ...` declaration, add:

```ts
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
    "e-money",
    "asset-referenced",
  ].join("|"),
  "i",
);
```

- [ ] **Step 2: Update `isRelevant` signature**

Replace the existing `isRelevant` function with:

```ts
function isRelevant(headline: string, trusted: boolean): boolean {
  return (trusted ? LAYER_1_RE : RELEVANCE_RE).test(headline);
}
```

- [ ] **Step 3: Update `summarize` to accept `trusted` and emit Layer-2 gate**

Replace the existing `summarize` function (around lines 335–377) with:

```ts
async function summarize(
  headline: string,
  source: string,
  date: string,
  body: string | null,
  trusted: boolean,
): Promise<{ summary: string; source: "article" | "headline-only" } | null> {
  const baseSystem =
    "You write one- to two-sentence neutral summaries of news stories about stablecoin regulation, issuance, reserves, supervision, and related digital-asset policy. Plain factual prose. No editorializing.";
  const gate = trusted
    ? " If this story is not about stablecoin / digital-asset payment policy, supervision, reserves, redemption, AML/CFT, sanctions, custody, or issuer eligibility, respond with exactly NOT_RELEVANT and nothing else."
    : "";
  const system = baseSystem + gate;
  const userBlock = body
    ? `Headline: ${headline}\nSource: ${source} (${date})\n\nArticle body (trimmed):\n${body}\n\nWrite a 1–2 sentence neutral summary.`
    : `Headline: ${headline}\nSource: ${source} (${date})\n\nThe article body could not be retrieved. Write one factual sentence based on the headline alone — do not invent specifics.`;
  for (let attempt = 1; attempt <= SUMMARY_MAX_RETRIES; attempt++) {
    await waitForSummarySlot();
    try {
      const res = await client.messages.create({
        model: MODEL,
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
      if (isRateLimitError(err) && attempt < SUMMARY_MAX_RETRIES) {
        const backoffMs = attempt * 15_000;
        console.warn(
          `  summarize rate-limited; retrying in ${(backoffMs / 1000).toFixed(0)}s ` +
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
```

- [ ] **Step 4: Update call sites in `main()`**

In `main()`, find the filter line:

```ts
const pending = candidates.filter(
  (c) => !seenUrls.has(c.parsed.link) && isRelevant(c.parsed.title),
);
```

Replace with:

```ts
const pending = candidates.filter(
  (c) =>
    !seenUrls.has(c.parsed.link) &&
    isRelevant(c.parsed.title, c.feed.trustedSource ?? false),
);
```

And find the `summarize` call inside `runPool`:

```ts
const sum = await summarize(parsed.title, feed.name, parsed.pubDate, body);
```

Replace with:

```ts
const sum = await summarize(parsed.title, feed.name, parsed.pubDate, body, feed.trustedSource ?? false);
```

- [ ] **Step 5: Typecheck**

Run:
```bash
npx tsc
```
Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add scripts/sync/news-rss.ts
git commit -m "feat(news): two-layer relevance filter for trusted-source feeds"
```

---

## Task 4: Export `fetchFeed` / `parseFeed` from `news-rss.ts`

`news-web-search.ts` (next task) will reuse the same fetch + parse logic instead of duplicating it.

**Files:**
- Modify: `scripts/sync/news-rss.ts`

- [ ] **Step 1: Add `export` to declarations**

In `scripts/sync/news-rss.ts`, add the `export` keyword to:

```ts
export interface FeedConfig { /* ... */ }
export interface ParsedItem { /* ... */ }
export interface PendingItem { /* feed, parsed — declared further down the file */ }
export function parseFeed(xml: string): ParsedItem[] { /* ... */ }
export async function fetchFeed(url: string): Promise<string | null> { /* ... */ }
```

Also export `NewsItem` and `NewsFile`:

```ts
export interface NewsItem { /* ... */ }
export interface NewsFile { /* ... */ }
```

- [ ] **Step 2: Verify typecheck and that main() still executes via tsx**

Run:
```bash
npx tsc && npx tsx -e "import('./scripts/sync/news-rss.js').then(() => console.log('import ok'))"
```
Expected: `import ok`. The `import()` will not run `main()` because `main()` is invoked at the bottom of the file via top-level call; this is intentional — we just want the module load to succeed. If it fails because top-level `main()` runs, that's fine too (it will short-circuit on the 14-day guard or run cleanly).

If executing main() is undesired during this check, skip the second command — `npx tsc` clean is enough.

- [ ] **Step 3: Commit**

```bash
git add scripts/sync/news-rss.ts
git commit -m "refactor(news): export parseFeed/fetchFeed for reuse"
```

---

## Task 5: Pure-function builders in `news-web-search.ts`

Build the deterministic, IO-free pieces first. They get unit-test-like coverage via the smoke script in Task 6.

**Files:**
- Create: `scripts/sync/news-web-search.ts`

- [ ] **Step 1: Create the module skeleton with pure helpers**

```ts
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
```

- [ ] **Step 2: Typecheck**

Run:
```bash
npx tsc
```
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add scripts/sync/news-web-search.ts
git commit -m "feat(news): pure-function builders for dynamic Google News queries"
```

---

## Task 6: Web-search dry-run smoke script

**Files:**
- Create: `scripts/smoke/web-search-dryrun.ts`

- [ ] **Step 1: Create the smoke**

```ts
// scripts/smoke/web-search-dryrun.ts
/**
 * Print the queries buildQueries() would emit against the current
 * summaries.json. Does NOT touch summaries.json.
 *
 * With --fetch: actually GET each query, parse, run Layer-1 filter
 * (same regex news-rss.ts uses for non-trusted feeds), and print
 * candidate / kept counts per query. Still does not write anything.
 */
import "../env.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildQueries, hostToEntity } from "../sync/news-web-search.js";
import { fetchFeed, parseFeed, type NewsFile } from "../sync/news-rss.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const NEWS_PATH = join(ROOT, "data/news/summaries.json");

const RELEVANCE_RE = new RegExp(
  // Mirror of news-rss.ts RELEVANCE_RE (kept minimal — this smoke only
  // needs to estimate Layer-1 survival, not be byte-identical).
  "stablecoin|stable coin|digital asset|cryptoasset|crypto-asset|virtual asset|tokenized|tokenised|e-money|MiCA|GENIUS Act|STABLE Act|payment stablecoin|reserve",
  "i",
);

async function main() {
  const news = JSON.parse(readFileSync(NEWS_PATH, "utf8")) as NewsFile;
  const plans = buildQueries(news, Date.now());
  console.log(`web-search-dryrun: ${plans.length} planned queries`);
  for (const p of plans) {
    console.log(`  [${p.kind}] (defaultEntity=${p.defaultEntity}) ${p.query}`);
  }

  if (!process.argv.includes("--fetch")) return;

  console.log("\n--fetch: running each query…");
  for (const p of plans) {
    const xml = await fetchFeed(p.url);
    if (!xml) {
      console.log(`  FAIL ${p.query}`);
      continue;
    }
    const parsed = parseFeed(xml).slice(0, 20);
    const kept = parsed.filter((item) => RELEVANCE_RE.test(item.title));
    const entityHits = parsed
      .map((item) => hostToEntity(item.link, p.defaultEntity))
      .reduce<Record<string, number>>((acc, e) => {
        acc[e] = (acc[e] ?? 0) + 1;
        return acc;
      }, {});
    const entitySummary = Object.entries(entityHits)
      .map(([e, n]) => `${e}=${n}`)
      .join(", ");
    console.log(
      `  ${p.kind.padEnd(7)} candidates=${String(parsed.length).padStart(3)} layer1_kept=${String(kept.length).padStart(3)} ${entitySummary} :: ${p.query}`,
    );
  }
}

main().catch((err) => {
  console.error("web-search-dryrun crashed:", err);
  process.exit(2);
});
```

- [ ] **Step 2: Run smoke without --fetch**

Run:
```bash
npx tsx scripts/smoke/web-search-dryrun.ts
```
Expected: prints between 1 and 6 planned queries with `[gap]`, `[keyword]`, and/or `[site]` tags. Exits 0.

- [ ] **Step 3: Run smoke with --fetch**

Run:
```bash
npx tsx scripts/smoke/web-search-dryrun.ts --fetch
```
Expected: each query prints a non-zero `candidates=` count and a `layer1_kept=` count ≥ 0. Exit 0.

- [ ] **Step 4: Commit**

```bash
git add scripts/smoke/web-search-dryrun.ts
git commit -m "feat(smoke): web-search dry-run + --fetch validation"
```

---

## Task 7: Wire `runWebSearch` into `news-web-search.ts`

The pure builders exist; now add the IO function that the main loop will call.

**Files:**
- Modify: `scripts/sync/news-web-search.ts`

- [ ] **Step 1: Append `runWebSearch` to `news-web-search.ts`**

At the bottom of `scripts/sync/news-web-search.ts`, append:

```ts
// ─── IO ───────────────────────────────────────────────────────────

/**
 * For each planned query, fetch the Google News RSS, parse it, and map
 * each item into a PendingItem with a synthetic FeedConfig. trustedSource
 * is always false — Google News surfaces unfiltered third-party outlets.
 */
export async function runWebSearch(news: NewsFile): Promise<PendingItem[]> {
  if (process.env.NEWS_WEB_SEARCH_DISABLED === "1") {
    console.log("web-search: NEWS_WEB_SEARCH_DISABLED=1, skipping");
    return [];
  }

  const plans = buildQueries(news, Date.now());
  if (plans.length === 0) {
    console.log("web-search: no queries planned this run");
    return [];
  }

  console.log(`web-search: dispatching ${plans.length} queries`);

  const results = await Promise.all(
    plans.map(async (plan) => {
      const xml = await fetchFeed(plan.url);
      if (!xml) {
        console.warn(`  query FAIL: ${plan.query}`);
        return [] as PendingItem[];
      }
      const items = parseFeed(xml).slice(0, PER_QUERY_ITEM_LIMIT);
      return items.map<PendingItem>((parsed) => ({
        feed: {
          url: plan.url,
          name: `WebSearch [${plan.kind}]: ${plan.query}`,
          entity: hostToEntity(parsed.link, plan.defaultEntity),
          topicHint: "stablecoin-policy",
          trustedSource: false,
        },
        parsed,
      }));
    }),
  );

  const flat = results.flat();
  console.log(`web-search: produced ${flat.length} candidate item(s)`);
  return flat;
}
```

- [ ] **Step 2: Update `web-search-dryrun.ts` to optionally hit `runWebSearch` end-to-end**

Add this block at the end of `main()` in `scripts/smoke/web-search-dryrun.ts`, before the `}` that closes `main`:

```ts
  if (process.argv.includes("--runWebSearch")) {
    console.log("\n--runWebSearch: calling runWebSearch() end-to-end…");
    const { runWebSearch } = await import("../sync/news-web-search.js");
    const items = await runWebSearch(news);
    console.log(`runWebSearch returned ${items.length} PendingItem(s)`);
    // Show first 5 so we can eyeball entity attribution.
    for (const it of items.slice(0, 5)) {
      console.log(
        `  entity=${it.feed.entity.padEnd(20)} trusted=${String(it.feed.trustedSource).padEnd(5)} ${it.parsed.title.slice(0, 90)}`,
      );
    }
  }
```

- [ ] **Step 3: Run end-to-end dryrun**

Run:
```bash
npx tsx scripts/smoke/web-search-dryrun.ts --runWebSearch
```
Expected: prints `runWebSearch returned N PendingItem(s)` with N ≥ 1 and a sample table of items with sensible entity attribution.

- [ ] **Step 4: Typecheck**

Run:
```bash
npx tsc
```
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add scripts/sync/news-web-search.ts scripts/smoke/web-search-dryrun.ts
git commit -m "feat(news): runWebSearch IO + --runWebSearch smoke verification"
```

---

## Task 8: Wire `runWebSearch` into `news-rss.ts` `main()` + observability log

**Files:**
- Modify: `scripts/sync/news-rss.ts`

- [ ] **Step 1: Import `runWebSearch`**

At the top of `scripts/sync/news-rss.ts`, with the other imports, add:

```ts
import { runWebSearch } from "./news-web-search.js";
```

- [ ] **Step 2: Insert `runWebSearch` between the RSS fan-out and the dedupe filter**

In `main()`, find:

```ts
  const candidates = fetched.flat();
  const pending = candidates.filter(
```

Insert a counter for trusted-source items above it and merge in web-search items. Replace those two lines (and the rest of the filter block) with:

```ts
  const rssCandidates = fetched.flat();

  let webSearchCandidates: PendingItem[] = [];
  try {
    webSearchCandidates = await runWebSearch(news);
  } catch (err) {
    console.warn(`web-search top-up failed: ${(err as Error).message} — continuing with RSS only`);
  }

  const candidates: PendingItem[] = [...rssCandidates, ...webSearchCandidates];

  const layer1Survivors = candidates.filter(
    (c) =>
      !seenUrls.has(c.parsed.link) &&
      isRelevant(c.parsed.title, c.feed.trustedSource ?? false),
  );
  const pending = layer1Survivors;

  const layer1KeptTrusted = layer1Survivors.filter((c) => c.feed.trustedSource).length;
  const layer1KeptUntrusted = layer1Survivors.length - layer1KeptTrusted;
  const filteredOut = candidates.length - pending.length;
  console.log(
    `rss: ${candidates.length} items (rss=${rssCandidates.length} webSearch=${webSearchCandidates.length}); ` +
      `${pending.length} new + relevant (${filteredOut} skipped: dup or off-topic)`,
  );
  if (pending.length === 0) return;
```

Note: `PendingItem` is already exported by Task 4. TypeScript interface declarations are hoisted within their file, so the forward reference inside `main()` is fine.

- [ ] **Step 3: Add NOT_RELEVANT counter and final summary log**

In `main()`, before the `runPool` call, add:

```ts
  let layer2Dropped = 0;
  let webSearchAdded = 0;
  let trustedAdded = 0;
```

In the `runPool` callback, replace:

```ts
    const sum = await summarize(parsed.title, feed.name, parsed.pubDate, body, feed.trustedSource ?? false);
    if (!sum) return;
```

with:

```ts
    const sum = await summarize(parsed.title, feed.name, parsed.pubDate, body, feed.trustedSource ?? false);
    if (!sum) {
      // Either Haiku failed, returned empty, or returned NOT_RELEVANT.
      // We can't cheaply distinguish here, so count as layer2 drop only
      // when the feed was trusted (where NOT_RELEVANT is the gate).
      if (feed.trustedSource) layer2Dropped++;
      return;
    }
```

After the `entityBucket.news.unshift(...)` block, just below `added++;`, add:

```ts
    if (feed.name.startsWith("WebSearch ")) webSearchAdded++;
    if (feed.trustedSource) trustedAdded++;
```

Finally, just before the `news.generatedAt = new Date().toISOString();` line (the line that writes summaries.json), insert the summary log:

```ts
  console.log(
    `rss-summary: candidates=${candidates.length} ` +
      `layer1_kept=${layer1Survivors.length} ` +
      `(trusted=${layer1KeptTrusted}, untrusted=${layer1KeptUntrusted}) ` +
      `layer2_dropped=${layer2Dropped} added=${added} ` +
      `(trusted=${trustedAdded}, webSearch=${webSearchAdded})`,
  );
```

- [ ] **Step 4: Typecheck**

Run:
```bash
npx tsc
```
Expected: zero errors.

- [ ] **Step 5: End-to-end run on a clean run**

Force a window restart (so the 14-day guard does not block) and execute the poll. This will hit Anthropic Haiku for each surviving item — make sure `ANTHROPIC_API_KEY` is set in `.env.local`.

Run:
```bash
npx tsx scripts/sync/news-rss.ts --restart
```
Expected: succeeds end-to-end; final `rss-summary:` line is present; `data/news/summaries.json` is updated; `public/news-summaries.json` is in sync.

If you want to test the web-search disable path:
```bash
NEWS_WEB_SEARCH_DISABLED=1 npx tsx scripts/sync/news-rss.ts
```
Expected: `web-search: NEWS_WEB_SEARCH_DISABLED=1, skipping` log line; no web-search candidates in the summary.

- [ ] **Step 6: Commit**

```bash
git add scripts/sync/news-rss.ts
git commit -m "feat(news): wire dynamic web-search top-up + rss-summary log"
```

---

## Task 9: Restructure report input — `JurisdictionBlock` and `buildJurisdictionBlocks`

This task changes types and adds the new builder. Sonnet prompt and output schema change in Tasks 10–11. Splitting the change keeps each commit reviewable.

**Files:**
- Modify: `scripts/reports/generate-daily-report.ts`

- [ ] **Step 1: Add new types and `buildJurisdictionBlocks`**

In `scripts/reports/generate-daily-report.ts`, just after the `type JsonFileInput = ...` declaration, add:

```ts
type RecentNewsItem = {
  headline: string;
  date: string;
  source: string;
  url: string;
  summary?: string;
};

type JurisdictionBlock = {
  jurisdiction: string;
  recentNews: RecentNewsItem[];
  legislation?: JsonValue;
};
```

Replace the existing `ReportInput` type with:

```ts
type ReportInput = {
  generatedAt: string;
  date: string;
  regionalSummaries: { na?: string; eu?: string; asia?: string };
  jurisdictions: JurisdictionBlock[];
  /** Raw paths used; kept for the report's sourceFiles field. */
  sourceFiles: string[];
};
```

Add the new builder function near the other helpers (above `compactForPrompt`):

```ts
const RECENT_DAYS = 7;
const MAX_NEWS_PER_BLOCK = 10;

// Region tagging mirrors news-regional-summary.ts. Kept local so we do
// not pull a runtime import from a sync script with its own .env logic.
const EU_ENTITIES_FOR_REPORT = new Set([
  "Netherlands", "Ireland", "Sweden", "Finland", "Germany", "France",
  "United Kingdom", "Spain", "Italy", "Poland", "Denmark", "Norway",
  "Belgium", "Austria", "Portugal", "Greece", "Czech Republic", "Czechia",
  "Switzerland", "Luxembourg", "European Union",
]);
const ASIA_ENTITIES_FOR_REPORT = new Set([
  "Japan", "China", "South Korea", "Republic of Korea", "Singapore",
  "India", "Taiwan", "Indonesia", "Australia", "Malaysia", "Thailand",
  "Vietnam", "Philippines", "Hong Kong",
]);

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
    }));
}

function countRecentItems(items: RecentNewsItem[]): number {
  return items.length;
}

function jurisdictionFromStateFile(file: JsonFileInput): string {
  // e.g. data/legislation/states/california.json → "US-California"
  const base = file.id.replace(/[-_]/g, " ");
  const titled = base
    .split(" ")
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
  return `US-${titled}`;
}

function jurisdictionFromInternationalFile(file: JsonFileInput): string {
  return file.id
    .split(/[-_]/)
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function regionOfJurisdiction(jurisdiction: string, entity: string | null): "na" | "eu" | "asia" | "other" {
  if (jurisdiction === "US-Federal" || jurisdiction.startsWith("US-")) return "na";
  if (entity && EU_ENTITIES_FOR_REPORT.has(entity)) return "eu";
  if (entity && ASIA_ENTITIES_FOR_REPORT.has(entity)) return "asia";
  return "other";
}

function buildJurisdictionBlocks(args: {
  newsSummary: JsonValue | null;
  federalLegislation: JsonValue | null;
  stateLegislation: JsonFileInput[];
  international: JsonFileInput[];
  now: number;
}): JurisdictionBlock[] {
  const { newsSummary, federalLegislation, stateLegislation, international, now } = args;
  const blocks: JurisdictionBlock[] = [];

  // 1. US-Federal: news bucket is "United States"; federal legislation JSON.
  blocks.push({
    jurisdiction: "US-Federal",
    recentNews: recentNewsFor(newsSummary, "United States", now),
    legislation: federalLegislation ?? undefined,
  });

  // 2. US-States: per-state legislation, no per-state news bucket exists
  //    (news-rss.ts files everything under the single "United States" entity).
  //    Rank by legislation file size as a recent-activity proxy and only
  //    surface states that actually have entries.
  const stateBlocks: JurisdictionBlock[] = stateLegislation
    .filter((f) => Array.isArray((f.data as { legislation?: unknown[] })?.legislation) &&
                   ((f.data as { legislation: unknown[] }).legislation.length > 0))
    .map((f) => ({
      jurisdiction: jurisdictionFromStateFile(f),
      recentNews: [],
      legislation: f.data,
    }))
    .sort((a, b) => {
      const al = ((a.legislation as { legislation?: unknown[] })?.legislation ?? []).length;
      const bl = ((b.legislation as { legislation?: unknown[] })?.legislation ?? []).length;
      return bl - al;
    });
  blocks.push(...stateBlocks);

  // 3. International: each file becomes a block; news bucket name matches
  //    the file id title-cased (best effort) OR — for the EU — "European Union".
  const international_blocks: JurisdictionBlock[] = international.map((f) => {
    let entityGuess = jurisdictionFromInternationalFile(f);
    if (entityGuess === "European Union" || f.id === "european-union") entityGuess = "European Union";
    return {
      jurisdiction: entityGuess,
      recentNews: recentNewsFor(newsSummary, entityGuess, now),
      legislation: f.data,
    };
  });

  // Rank: EU first, UK second, then by recent-news count desc, others last.
  international_blocks.sort((a, b) => {
    const rank = (j: string) => (j === "European Union" ? 0 : j === "United Kingdom" ? 1 : 2);
    const ra = rank(a.jurisdiction);
    const rb = rank(b.jurisdiction);
    if (ra !== rb) return ra - rb;
    return countRecentItems(b.recentNews) - countRecentItems(a.recentNews);
  });

  blocks.push(...international_blocks);
  return blocks;
}

function buildRegionalSummaries(newsSummary: JsonValue | null): { na?: string; eu?: string; asia?: string } {
  const regional = readRegionalSummary(newsSummary).regional ?? {};
  return {
    na: regional.na?.summary,
    eu: regional.eu?.summary,
    asia: regional.asia?.summary,
  };
}
```

- [ ] **Step 2: Update `main()` to use the new input shape**

Replace the existing `const input: ReportInput = { ... }` block in `main()` with:

```ts
  const newsSummary = await readJsonIfExists("data/news/summaries.json");
  const federalLegislation = await readJsonIfExists("data/legislation/federal.json");
  const stateLegislation = await readJsonDir("data/legislation/states");
  const international = await readJsonDir("data/international");
  const now = Date.now();

  const input: ReportInput = {
    generatedAt,
    date,
    regionalSummaries: buildRegionalSummaries(newsSummary),
    jurisdictions: buildJurisdictionBlocks({
      newsSummary,
      federalLegislation,
      stateLegislation,
      international,
      now,
    }),
    sourceFiles: [
      "data/news/summaries.json",
      "data/legislation/federal.json",
      ...stateLegislation.map((item) => item.file),
      ...international.map((item) => item.file),
    ],
  };
```

- [ ] **Step 3: Update `buildSourceFiles` and `fallbackReport` so they still typecheck**

Replace the existing `buildSourceFiles(input)` function with:

```ts
function buildSourceFiles(input: ReportInput): string[] {
  return input.sourceFiles;
}
```

Replace the existing `fallbackReport(input)` function with a temporary stub (full fallback rewrite arrives in Task 11):

```ts
function fallbackReport(input: ReportInput): DailyReport {
  // Placeholder: keeps types valid until Task 11 rewrites this with the
  // sparse-data behavior. This implementation only fires when
  // REPORT_FORCE_FALLBACK=1 or when Anthropic is unreachable.
  const regional = input.regionalSummaries;
  const executiveSummary = [
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
```

Also extend the existing `DailyReport` type with the `sources` field (the full schema-driven rewrite happens in Task 10 — this short addition keeps Step 3 typecheck-clean):

```ts
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
```

- [ ] **Step 4: Update `compactForPrompt` and `buildPrompt` to consume the new shape (interim, still single-message)**

This step keeps the prompt working with the new input shape so we can typecheck. The system/user split lands in Task 10.

Replace `compactForPrompt`:

```ts
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
        blockLines.push(`- [${n.date}] ${n.source}: ${n.headline} (${n.url})`);
        if (n.summary) blockLines.push(`  ${n.summary}`);
      }
    }
    if (block.legislation) {
      blockLines.push("Legislation:");
      blockLines.push(JSON.stringify(block.legislation, null, 2));
    }
    const blockText = blockLines.join("\n");
    if (used + blockText.length > BUDGET) break;
    lines.push(blockText);
    used += blockText.length;
  }
  return lines.join("\n");
}
```

`buildPrompt(input)` already calls `compactForPrompt(input)` — no change needed for this task; the rewrite into system/user lands in Task 10.

- [ ] **Step 5: Sanity check via tsx import**

Run:
```bash
npx tsc
```
Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add scripts/reports/generate-daily-report.ts
git commit -m "refactor(reports): per-jurisdiction input blocks + sources schema"
```

---

## Task 10: Sonnet prompt split into system + user, with sources schema

**Files:**
- Modify: `scripts/reports/generate-daily-report.ts`

- [ ] **Step 1: Replace `buildPrompt` with `buildSystemAndUserPrompts`**

In `scripts/reports/generate-daily-report.ts`, replace the existing `buildPrompt(input)` function (and the `compactForPrompt(input)` if you fold it inline — leave it separate for testability) with:

```ts
function buildSystemAndUserPrompts(input: ReportInput): { system: string; user: string } {
  const system = `You are a stablecoin policy analyst writing the Daily Stablecoin Policy Brief.

Rules:
- Use only facts supported by the input data below.
- Do not invent dates, laws, bill names, regulator actions, or URLs.
- Separate factual policy signal from business analysis.
- Each "Top Development" must be tied to a real input news item or legislation entry.
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
- The "sources" array MUST contain 8 to 15 entries.
- Every URL in "sources" MUST appear verbatim in the input "Recent news" entries below.
- Deduplicate by outlet (one entry per outlet at most).
- Pick the most consequential items actually relied on across executiveSummary, topDevelopments, regulatorySignalTable, and analystTakeaway.
- If the input contains fewer than 8 distinct outlets in the last 7 days, return as many as exist (sources may be shorter than 8 in that case).`;

  const userBody = compactForPrompt(input);
  const user = `Date: ${input.date}

Repo data follows. Use only this content.

${userBody}

Produce the JSON now.`;

  return { system, user };
}
```

- [ ] **Step 2: Update `generateWithAnthropic` to use the split prompt**

Replace the existing `anthropic.messages.create(...)` invocation with:

```ts
  const prompts = buildSystemAndUserPrompts(input);
  const message = await anthropic.messages.create({
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
    max_tokens: 6000,
    temperature: 0.2,
    system: prompts.system,
    messages: [{ role: "user", content: prompts.user }],
  });
```

- [ ] **Step 3: Post-parse validation — drop hallucinated source URLs**

Right after the existing `JSON.parse(extractJson(text)) as DailyReport;` line, replace the surrounding return block with:

```ts
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
```

- [ ] **Step 4: Render `## Sources` in markdown and preview**

In `reportToMarkdown(report)`, just before the closing backtick of the template string, replace the existing `## 7. Source` block with:

```ts
  const sourcesList = report.sources.length
    ? report.sources
        .slice()
        .sort((a, b) => a.outlet.localeCompare(b.outlet))
        .map((s) => `- [${s.outlet} — ${s.headline}](${s.url}) · ${s.date}`)
        .join("\n")
    : "_No sources cited for this brief._";
```

And replace the final two trailing sections of `reportToMarkdown`:

```
## 6. Analyst Takeaway

${report.analystTakeaway}

## 7. Source

Compiled from public stablecoin policy and regulatory news tracking at https://stablecoin-policy.vercel.app/
```

with:

```
## 6. Analyst Takeaway

${report.analystTakeaway}

## 7. Sources

${sourcesList}

---

_Compiled from public stablecoin policy and regulatory news tracking at https://stablecoin-policy.vercel.app/_
```

In `reportToPreviewMarkdown(report)`, just before the closing backtick, append:

```ts
${report.sources.length > 0 ? `\n## Sources\n\n${report.sources
  .slice()
  .sort((a, b) => a.outlet.localeCompare(b.outlet))
  .map((s) => `- [${s.outlet} — ${s.headline}](${s.url}) · ${s.date}`)
  .join("\n")}\n` : ""}
```

- [ ] **Step 5: Typecheck**

Run:
```bash
npx tsc
```
Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add scripts/reports/generate-daily-report.ts
git commit -m "feat(reports): system/user prompt split + sources validation + markdown Sources"
```

---

## Task 11: Final fallback rewrite (sparse-data honest mode)

The fallback already returns empty arrays after Task 9's interim stub. This task preserves the original `fallbackReport` body as a commented archival block per the spec's rollback section.

**Files:**
- Modify: `scripts/reports/generate-daily-report.ts`

- [ ] **Step 1: Add the archival comment block above the current `fallbackReport`**

Directly above the `function fallbackReport(input: ReportInput): DailyReport {` line, paste this block (this preserves the old fabricated content for a 7-day rollback window — per spec):

```ts
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
```

- [ ] **Step 2: Replace the current interim fallback body with the final sparse-data version**

Replace the entire `fallbackReport(input)` body (Task 9 left it nearly there; just tighten the `executiveSummary` empty-all-three branch and confirm everything matches the spec):

```ts
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
```

- [ ] **Step 3: Typecheck**

Run:
```bash
npx tsc
```
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add scripts/reports/generate-daily-report.ts
git commit -m "feat(reports): honest sparse-data fallback, archive legacy"
```

---

## Task 12: Report-dryrun smoke + final acceptance checks

**Files:**
- Create: `scripts/smoke/report-dryrun.ts`

- [ ] **Step 1: Create the smoke**

```ts
// scripts/smoke/report-dryrun.ts
/**
 * Run generate-daily-report.ts end-to-end but DO NOT:
 *   - write data/reports/*.md.enc
 *   - upsert data/reports/index.json
 *   - touch public/reports/daily/*
 *
 * Writes JSON + markdown to /tmp/ for human inspection. Respects
 * REPORT_FORCE_FALLBACK=1. Suppresses the report module's auto-invoked
 * main() via REPORT_SKIP_AUTORUN=1 so we drive it ourselves through the
 * exported run() function (added to generate-daily-report.ts in step 2).
 */
import "../env.js";

const TMP = process.env.TMPDIR ?? "/tmp";

async function main() {
  process.env.REPORT_DRY_RUN = "1";
  process.env.REPORT_SKIP_AUTORUN = "1";
  const mod = await import("../reports/generate-daily-report.js");
  if (typeof (mod as { run?: () => Promise<void> }).run !== "function") {
    throw new Error("generate-daily-report.ts must export run()");
  }
  await (mod as { run: () => Promise<void> }).run();
  console.log(`report-dryrun: outputs in ${TMP}/report-dryrun-*.json and .md`);
}

main().catch((err) => {
  console.error("report-dryrun crashed:", err);
  process.exit(2);
});
```

- [ ] **Step 2: Add a `REPORT_DRY_RUN` gate inside `generate-daily-report.ts`**

In `scripts/reports/generate-daily-report.ts`, refactor the bottom of the file so `main()` becomes exportable and the encrypt/upsert paths short-circuit under `REPORT_DRY_RUN=1`:

Replace the current `main()` invocation (the final `main().catch(...)`) with:

```ts
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
```

Inside `main()`, just before the encrypt block, add:

```ts
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
```

Also, just before the existing `console.log("Generated daily report JSON:", ...)` line near the end of `main()`, add:

```ts
  console.log(
    `report-summary: jurisdiction_blocks=${input.jurisdictions.length} sources_returned=${report.sources.length} word_count=${countWords(markdown)}`,
  );
```

(The smoke in step 1 already sets `REPORT_SKIP_AUTORUN=1` before importing, so the module's auto-`main()` is suppressed and only the smoke's explicit `run()` call drives the work.)

- [ ] **Step 3: Run dry-run in forced-fallback mode (no API key required)**

Run:
```bash
REPORT_FORCE_FALLBACK=1 npx tsx scripts/smoke/report-dryrun.ts
```
Expected:
- Exit code 0
- `/tmp/report-dryrun-<date>.json` exists
- JSON `topDevelopments`, `regulatorySignalTable`, `watchlist`, `sources` are `[]`
- JSON `analystTakeaway` includes the literal string `"Data ingestion was sparse or AI generation was unavailable."`

Verify with:
```bash
DATE=$(date -u +%F)
node -e "const path=require('path'); const r=JSON.parse(require('fs').readFileSync(path.join(process.env.TMPDIR||'/tmp','report-dryrun-'+process.env.DATE+'.json'),'utf8')); console.log({td: r.topDevelopments.length, rt: r.regulatorySignalTable.length, wl: r.watchlist.length, src: r.sources.length, takeaway: r.analystTakeaway.slice(0,60)})" DATE="$DATE"
```
Expected: `{ td: 0, rt: 0, wl: 0, src: 0, takeaway: 'Data ingestion was sparse or AI generation was unavailable.' }`.

- [ ] **Step 4: Run live dry-run (requires `ANTHROPIC_API_KEY`)**

If `ANTHROPIC_API_KEY` is set:
```bash
npx tsx scripts/smoke/report-dryrun.ts
```
Expected:
- Exit code 0
- `report-summary:` line printed with `sources_returned > 0`
- JSON `sources` array non-empty
- Every `sources[i].url` appears in some `input.jurisdictions[*].recentNews[*].url` (the post-parse validator drops fabricated ones; if it logs `dropping fabricated source URL`, that's the validator working as designed)

Verify the URL-membership invariant manually:
```bash
DATE=$(date -u +%F)
node -e "
  const path=require('path');
  const r=JSON.parse(require('fs').readFileSync(path.join(process.env.TMPDIR||'/tmp','report-dryrun-'+process.env.DATE+'.json'),'utf8'));
  console.log('sources:', r.sources.length);
  for (const s of r.sources) console.log('  -', s.outlet, s.url);
" DATE="$DATE"
```
Cross-reference any URL against `data/news/summaries.json` if you want a hard assurance.

- [ ] **Step 5: Final lint + typecheck pass**

Run:
```bash
npm run lint && npx tsc
```
Expected: both clean.

- [ ] **Step 6: Re-run feeds-ping as a sanity gate**

Run:
```bash
npx tsx scripts/smoke/feeds-ping.ts
```
Expected: all feeds OK.

- [ ] **Step 7: Commit**

```bash
git add scripts/smoke/report-dryrun.ts scripts/reports/generate-daily-report.ts
git commit -m "feat(smoke): report-dryrun + REPORT_DRY_RUN gate for safe report iteration"
```

---

## Wrap-up

All twelve tasks implement the spec acceptance criteria:

| Criterion | Covered by |
|---|---|
| #1 feeds-ping all OK | Tasks 1, 2, 12 step 6 |
| #2 webSearch returns ≥1 item not already known | Task 7 step 3 (smoke output) |
| #3 `news-rss.ts --restart` end-to-end + rss-summary log | Task 8 step 5 |
| #4 forced-fallback empty arrays | Task 12 step 3 |
| #5 sources in input URL set | Task 12 step 4 + post-parse validator (Task 10 step 3) |
| #6 lint + typecheck | Task 12 step 5 |

Rollback levers (per spec):
- `NEWS_WEB_SEARCH_DISABLED=1` short-circuits `runWebSearch` (Task 7).
- Removing `trustedSource` flags in `feeds.json` restores strict relevance for those feeds (Task 2 schema).
- The archived legacy fallback comment (Task 11) is a paper trail in case Sonnet is unavailable for an extended period.
