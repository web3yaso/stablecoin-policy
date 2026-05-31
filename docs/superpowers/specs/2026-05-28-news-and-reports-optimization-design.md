# News Sourcing and Daily Report Optimization — Design

**Date:** 2026-05-28
**Scope:** `scripts/sync/news-rss.ts`, `data/news/feeds.json`, new `scripts/sync/news-web-search.ts`, `scripts/reports/generate-daily-report.ts`, three new smoke scripts under `scripts/smoke/`.
**Out of scope:** UI changes (`AIOverview.tsx`, `LiveNews.tsx`), x402 server, payment logs, regional summarizer (`news-regional-summary.ts`), placeholder rebuild script, sellable slug / pricing / encryption / index upsert semantics.

## Goals

1. Widen news sourcing without taking on paid API costs.
2. Improve daily report (sellable slug `global-stablecoin-policy-report`) structural quality and add source attribution.

## Terminology

Two distinct geographic groupings appear throughout this spec; they are not interchangeable:

- **Region** (`na | eu | asia`) — the 3-bucket grouping used by `news-regional-summary.ts`, `AIOverview.tsx`, and the dynamic top-up's gap analysis. Coarse.
- **Jurisdiction** (`US-Federal | US-NY | EU | UK | HK | JP | SG | ...`) — the finer grouping used by the daily report's `JurisdictionBlock`. Multiple jurisdictions roll up to one region.

## Non-goals

- Per-claim inline citations (decided: bottom Sources list only).
- Bilingual report output (decided: English only, structural quality first).
- Event-driven report regeneration (decided: keep daily cron).
- Replacing RSS pipeline with paid web search (decided: zero incremental $).
- A unit test framework (no existing test infra; smoke scripts cover this).

## Design

### 1. Regulator RSS expansion

Add 9 first-party regulator RSS feeds (HTTP 200 verified 2026-05-28) to `data/news/feeds.json`:

| Outlet | URL | entity |
|---|---|---|
| Federal Reserve Board | `https://www.federalreserve.gov/feeds/press_all.xml` | United States |
| SEC | `https://www.sec.gov/news/pressreleases.rss` | United States |
| CFTC | `https://www.cftc.gov/PressRoom/PressReleases/rss` | United States |
| FCA | `https://www.fca.org.uk/news/rss.xml` | United Kingdom |
| Bank of England | `https://www.bankofengland.co.uk/rss/news` | United Kingdom |
| EBA | `https://www.eba.europa.eu/rss.xml` | European Union |
| ESMA | `https://www.esma.europa.eu/rss.xml` | European Union |
| ECB | `https://www.ecb.europa.eu/rss/press.html` | European Union |
| MAS | `https://www.mas.gov.sg/rss/news` | Singapore |

Add 5 Google News RSS `site:` proxy feeds for regulators without public RSS (OCC, FDIC, US Treasury, HKMA, FSA Japan), verified to return 81–100 items per query:

| Proxy query | entity |
|---|---|
| `stablecoin site:occ.gov` | United States |
| `stablecoin site:fdic.gov` | United States |
| `stablecoin site:treasury.gov` | United States |
| `stablecoin site:hkma.gov.hk` | Hong Kong |
| `stablecoin site:fsa.go.jp` | Japan |

BIS and FSB intentionally excluded for this iteration (no `Global` entity bucket exists; deferred).

All 9 direct-RSS entries carry a new optional schema field `trustedSource: true`. Site-proxy entries do not (their headlines already include `stablecoin`, so the strict relevance filter is appropriate).

### 2. Two-layer relevance filter

Direct regulator RSS items (`trustedSource: true`) bypass the strict headline regex (`RELEVANCE_RE`) and instead use:

- **Layer 1**: a wider headline regex `LAYER_1_RE` covering `stable | stablecoin | digital asset | digital currency | crypto | token | tokeniz | payment system | reserve | supervisory | virtual asset | e-money | asset-referenced`.
- **Layer 2**: at `summarize()` time, the system prompt is extended for trusted-source items with: *"If this story is not about stablecoin / digital-asset payment policy, supervision, reserves, redemption, AML/CFT, sanctions, custody, or issuer eligibility, respond with exactly NOT_RELEVANT and nothing else."* The summarize return contract gains a sentinel: `text === "NOT_RELEVANT"` → `summarize` returns `null` and the item is dropped.

Non-trusted feeds (existing Google News feeds + site-proxy feeds) keep the current `RELEVANCE_RE` and an unchanged summarize prompt.

### 3. Dynamic web-search top-up (`scripts/sync/news-web-search.ts`)

New module exporting `runWebSearch(news: NewsFile): Promise<PendingItem[]>`. Invoked from `news-rss.ts` `main()` immediately after the RSS fan-out, before the dedupe/relevance step. Pure-function builders (`buildQueries`, `hostToEntity`, `pickRotationSiteQuery`, `pickKeywordQueries`, `pickJurisdictionGapQueries`) live in this file alongside the IO wrapper.

**Query generation, max 6 per invocation:**

1. **Jurisdiction gap** (≤3): for each region in `na | eu | asia`, count items added in the last 7 days from `news.entities`; if a region has < 3, emit one query like `stablecoin (regulation OR rule OR legislation OR licensing) "<region keywords>"` scoped to the 7-day window via Google News `&when=7d` parameter.
2. **Rolling high-signal keywords** (≤2): a small fixed list (`"GENIUS Act"`, `"CLARITY Act"`, `MiCA stablecoin`, `"payment stablecoin" issuer`, `stablecoin "reserve" amendment`); pick 1–2 not already represented in this run's RSS bucket.
3. **Regulator `site:` rotation** (≤1): one of the 5 site-proxy queries per run, rotated via `data/news/.site-rotation` (single-line JSON `{lastIndex: number}`).

**URL pattern**: `https://news.google.com/rss/search?q=<urlencoded>&hl=en-US&gl=US&ceid=US:en`. Reuses `fetchFeed` and `parseFeed` exported from `news-rss.ts`.

**Entity attribution**: each emitted query carries a `defaultEntity`. After parse, every item URL is checked against an in-file `hostToEntity` table (first ~15 hosts hand-mapped, e.g. `fca.org.uk` → `United Kingdom`, `mas.gov.sg` → `Singapore`); a host match overrides the default.

**Trusted-source flag**: items returned by `runWebSearch` carry `trustedSource: false`. The Google News surface is already narrowed by the `stablecoin`-bearing query, but third-party outlet headlines still need the strict `RELEVANCE_RE` gate (a `stablecoin` query routinely surfaces unrelated cryptocurrency stories).

**Disabling**: env `NEWS_WEB_SEARCH_DISABLED=1` short-circuits `runWebSearch` to return `[]`.

### 4. Main loop wiring (`scripts/sync/news-rss.ts`)

`FeedConfig` gains `trustedSource?: boolean`. `parseFeed` and `fetchFeed` are exported. `isRelevant(headline, trusted)` switches between `LAYER_1_RE` and the existing `RELEVANCE_RE`. `summarize(headline, source, date, body, trusted)` appends the layer-2 gate sentence when `trusted` is true and returns `null` on `NOT_RELEVANT`.

`main()` ordering:
1. `checkStartedGuard()` (unchanged)
2. Read `feeds.json`, `summaries.json`, build `seenUrls` (unchanged)
3. Parallel `fetchFeed` over `feedsCfg.feeds` (unchanged)
4. `await runWebSearch(news)` (new; honors `NEWS_WEB_SEARCH_DISABLED`)
5. `candidates = [...rssFeedItems, ...webSearchItems]`
6. Filter by `!seenUrls.has(url) && isRelevant(headline, item.feed.trustedSource ?? false)`
7. `runPool(pending, ...)` — `summarize(..., trustedSource)` (unchanged otherwise)
8. Sort, `regenerateRegions`, write `summaries.json`, copy to `public/`, conditional `build-placeholder.ts` exec (all unchanged)

### 5. Report prompt and schema (`scripts/reports/generate-daily-report.ts`)

**Input restructure** — new private builder `buildJurisdictionBlocks(rawInputs)`:

```ts
type JurisdictionBlock = {
  jurisdiction: string;   // "US-Federal" | "US-NY" | "EU" | "UK" | "HK" | "JP" | "SG" | ...
  recentNews: Array<{
    headline: string;
    date: string;       // ISO yyyy-mm-dd
    source: string;     // outlet name
    url: string;
    summary?: string;
  }>;
  legislation?: unknown; // per-jurisdiction legislation JSON if present
};
```

Each block caps `recentNews` at 10 items (last 7 days, sorted newest first). Block ordering: US-Federal → US-States (ranked by count of items added in last 7 days, descending; states with zero recent items are omitted) → EU → UK → Asia-Pacific countries (same recent-activity ranking within group) → other.

**Output schema** — `DailyReport` gains:

```ts
sources: Array<{
  outlet: string;
  url: string;
  headline: string;
  date: string;
}>;
```

System prompt mandates: return 8–15 unique-by-outlet sources covering only the items actually relied on in `executiveSummary`, `topDevelopments`, `regulatorySignalTable`, `analystTakeaway`. Validation after parse: every `sources[i].url` must appear in the input `recentNews[].url` set; items failing this check are dropped (logged, not fatal).

**Prompt rewrite** — `buildPrompt(input)` returns `{system, user}` instead of one big user blob:
- `system`: report skeleton spec + sourcing rules + strict JSON shape.
- `user`: `regionalSummaries` (short, full text) then `jurisdictions[]` as markdown sections; each news item rendered as `- [date] [outlet] headline (url)\n  summary` (saves ~30% chars vs JSON.stringify).
- Input budget: 100K chars for the user message body only (system prompt and `regionalSummaries` prefix not counted). Append jurisdiction blocks in order until the next block would exceed the budget; drop that block whole (never truncate mid-item).
- `max_tokens`: 6000 (up from 5000).

**Fallback rewrite** — `fallbackReport(input)` no longer fabricates content:
- `executiveSummary`: 3 sentences sourced from `regionalSummaries.{na,eu,asia}` first lines; if all empty, single sentence `"No new policy signal detected in last 24 hours."`
- `topDevelopments`, `regulatorySignalTable`, `watchlist`, `sources`: empty arrays.
- `marketImpact.*`: `"Insufficient signal — see recent reports."`
- `analystTakeaway`: literal string `"Data ingestion was sparse or AI generation was unavailable. The next refresh runs at the next scheduled cron tick."` (no dynamic time interpolation — keeps fallback deterministic and testable).

**Markdown output** — `reportToMarkdown()` appends `## Sources` with one bullet per source: `- [outlet — headline](url) · YYYY-MM-DD`, alphabetized by outlet. Preview markdown (`reportToPreviewMarkdown()`) also appends `## Sources` (same content), giving paying users a pre-purchase credibility signal.

**Unchanged**: `SELLABLE_SLUG`, `SELLABLE_PRICE_USD`, `SELLABLE_CATEGORY`, `SELLABLE_JURISDICTION`, AES-256-GCM encryption, `upsertReportIndex`, output directories, cron cadence.

### 6. Smoke scripts (`scripts/smoke/`)

**`feeds-ping.ts`** — HEAD all direct-RSS feeds; GET + count `<item>` for site-proxy feeds. Table output. Non-zero exit on any feed below threshold (200 OK or items ≥ 1).

**`web-search-dryrun.ts`** — Prints the 6 queries `buildQueries(news, now)` produces against current `summaries.json`. With `--fetch`, executes them and prints per-query hit counts and layer-1 survival counts, without writing summaries.json.

**`report-dryrun.ts`** — Runs the full report pipeline but skips encryption, index upsert, and `.md.enc` writes. JSON + Markdown go to `/tmp/`. Respects `REPORT_FORCE_FALLBACK=1`.

### 7. Observability

End-of-run log lines (single-line, grep-friendly):

```
rss-summary: candidates=842 dedup=120 layer1_kept=88 layer2_kept=71 added=68
  · trustedSource=true: candidates=215 layer1_kept=42 layer2_kept=31 added=29
  · trustedSource=false: candidates=627 layer1_kept=46 layer2_kept=40 added=39
  · webSearch contribution: items=18 added=12

report-summary: jurisdiction_blocks=14 input_chars=87234 sources_returned=11 word_count=1820
```

### 8. Rollback

- `NEWS_WEB_SEARCH_DISABLED=1` — disables dynamic top-up immediately.
- Setting `trustedSource: false` (or removing the field) on a feeds.json entry restores strict `RELEVANCE_RE` for that feed.
- Old `fallbackReport` body retained as a commented-out block for 7 days as a paper trail in case Sonnet is unavailable for an extended period.

## Acceptance criteria

1. `npx tsx scripts/smoke/feeds-ping.ts` — all 14 feed entries pass (HTTP 200 or items ≥ 1).
2. `npx tsx scripts/smoke/web-search-dryrun.ts --fetch` — returns ≥ 1 item not already in `summaries.json` (proves top-up adds coverage).
3. `npx tsx scripts/sync/news-rss.ts --restart` — end-to-end on a clean checkout; `rss-summary` log present; `data/news/summaries.json` parses; no `summarySource: undefined`.
4. `REPORT_FORCE_FALLBACK=1 npx tsx scripts/smoke/report-dryrun.ts` — output `topDevelopments`, `regulatorySignalTable`, `watchlist`, `sources` are empty arrays.
5. `npx tsx scripts/smoke/report-dryrun.ts` (live Sonnet) — `sources` non-empty; every `sources[i].url` appears in input `recentNews[].url`.
6. `npm run lint` and `npx tsc` clean.

## Risks

- **Google News rate-limiting** for high-volume `site:` queries from one IP. GitHub Actions IPs are diverse, but the new dynamic top-up adds up to 6 queries per 15-minute run (576/day). Mitigation: per-query failure is non-fatal, and the rotation strategy already caps site-proxy queries to 1 per run.
- **Trusted-source layer-2 false negatives** — Haiku might incorrectly return `NOT_RELEVANT` for a borderline stablecoin item. Mitigation: log counts; review the first week's filtered-out items via observability log to retune the prompt if needed.
- **Sonnet hallucinated `sources[i].url`** despite the prompt instruction. Mitigation: post-parse validation drops any URL not present in input; log dropped count.
- **Regulator feed URL drift** — agencies occasionally move RSS endpoints. Mitigation: `feeds-ping.ts` smoke (run on CI) surfaces breakage; existing fetch failure is already non-fatal in `news-rss.ts`.
