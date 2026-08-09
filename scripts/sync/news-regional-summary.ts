/**
 * Regenerate the three regional AI overview summaries (NA / EU / Asia)
 * from the latest news items. Intended to be called from news-rss.ts
 * after new items are added, so the AI Overview stays in sync with the
 * feed.
 *
 * Each region's summary + a handful of key-phrase highlights (used by
 * the UI for `highlight-sweep` underlines) are written into
 *     news.regional[region].{summary, highlights, generatedAt, sourcePolicy}
 *
 * Budget: one Sonnet call per region on demand. Typical run touches
 * only the region(s) with new items this poll, so cost is ~$0.02–0.05
 * per fresh poll.
 */

import "../env.js";
import Anthropic from "../../lib/openai-llm.js";

const MODEL = "claude-sonnet-4-6";

export type RegionKey = "na" | "eu" | "asia";

export interface RegionalHighlight {
  /** Exact substring to highlight in the summary. Case-sensitive. */
  text: string;
  /** Topic color bucket used by the public policy-update presentation. */
  topic: "legislation" | "infrastructure" | "cooperation";
}

export interface RegionalSummaryBody {
  summary: string;
  highlights: RegionalHighlight[];
  generatedAt: string;
  sourcePolicy: "official-only";
  sourceCount: number;
  sourceIds: string[];
}

// Entity-name → region mapping. Anything not here is treated as "na",
// which is the right default for US federal + state entities.
const EU_ENTITIES = new Set([
  "Netherlands",
  "Ireland",
  "Sweden",
  "Finland",
  "Germany",
  "France",
  "United Kingdom",
  "Spain",
  "Italy",
  "Poland",
  "Denmark",
  "Norway",
  "Belgium",
  "Austria",
  "Portugal",
  "Greece",
  "Czech Republic",
  "Czechia",
  "Switzerland",
  "Luxembourg",
  "European Union",
]);

const ASIA_ENTITIES = new Set([
  "Japan",
  "China",
  "South Korea",
  "Republic of Korea",
  "Singapore",
  "India",
  "Taiwan",
  "Indonesia",
  "Australia",
  "Malaysia",
  "Thailand",
  "Vietnam",
  "Philippines",
  "Hong Kong",
]);

export function regionForEntity(name: string): RegionKey {
  if (EU_ENTITIES.has(name)) return "eu";
  if (ASIA_ENTITIES.has(name)) return "asia";
  return "na";
}

const REGION_LABEL: Record<RegionKey, string> = {
  na: "North America (US + Canada)",
  eu: "Europe",
  asia: "Asia-Pacific",
};

interface NewsItem {
  id: string;
  headline: string;
  source: string;
  date: string;
  url: string;
  summary?: string;
  sourceId?: string;
  sourceType?: "official-api" | "official-feed";
}

interface NewsFile {
  generatedAt: string;
  // Kept loose since the file mixes regenerated + legacy fields. The
  // regenerator only writes known keys and preserves legacy display fields.
  // and preserves everything else via object spread.
  regional: Record<string, Record<string, unknown>>;
  entities: Record<string, { news: NewsItem[] }>;
}

function getAnthropicApiKey(): string {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "OPENAI_API_KEY is missing. Add it to GitHub Actions secrets or .env.local before regenerating news summaries.",
    );
  }
  return key;
}

const client = new Anthropic({ apiKey: getAnthropicApiKey() });

// Only feed the summarizer official-source items from the last 30 days.
// A quiet region stays empty; old policy events must not be repackaged as a
// newly generated regional signal.
const RECENT_WINDOW_DAYS = 30;

function collectRecentForRegion(
  news: NewsFile,
  region: RegionKey,
  limit = 24,
): { entity: string; item: NewsItem }[] {
  const rows: { entity: string; item: NewsItem }[] = [];
  for (const [entity, body] of Object.entries(news.entities)) {
    if (regionForEntity(entity) !== region) continue;
    for (const item of body.news) {
      if (
        item.sourceType !== "official-api" &&
        item.sourceType !== "official-feed"
      ) {
        continue;
      }
      rows.push({ entity, item });
    }
  }
  rows.sort((a, b) => (b.item.date ?? "").localeCompare(a.item.date ?? ""));
  const cutoff = Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const recent = rows.filter((r) => {
    const d = new Date(r.item.date ?? "").getTime();
    return Number.isFinite(d) && d >= cutoff;
  });
  return recent.slice(0, limit);
}

function formatContext(
  rows: { entity: string; item: NewsItem }[],
): string {
  return rows
    .map((r, i) => {
      const parts = [
        `${i + 1}. [${r.item.date}] (${r.entity}) ${r.item.headline}`,
      ];
      if (r.item.summary) parts.push(`   ${r.item.summary}`);
      return parts.join("\n");
    })
    .join("\n\n");
}

const SYSTEM_PROMPT = `You write neutral, factual regional policy overviews for a stablecoin regulatory-intelligence product. Your output is a 4–6 sentence paragraph that weaves the most important developments from the provided first-party regulator, legislature, and official-publication records into flowing prose. Then you return 4–8 short key phrases that appear EXACTLY in your summary prose (verbatim substrings) so a UI can highlight them.

Constraints:
- Plain factual prose. No hedging, no editorializing, no "This week's developments show…"
- Lead with what's new and most consequential.
- Specific: use real bill numbers, jurisdiction names, dates, and amounts where the news supports it.
- Prioritize licensing, issuer eligibility, reserves, redemption, AML/CFT, sanctions, custody, distribution, and implementation deadlines.
- Do not invent specifics.
- Respond as strict JSON with shape:
  {
    "summary": "…",
    "highlights": [
      { "text": "exact substring from summary", "topic": "legislation|infrastructure|cooperation" }
    ]
  }
- highlight.text MUST be a literal substring of summary (case-sensitive). If you can't place a highlight verbatim, omit it.
- topic choices:
    legislation    — bills, laws, rulings, regulatory action
    infrastructure — payment rails, reserve operations, custody, technical implementation
    cooperation    — multilateral frameworks, agreements, joint statements`;

async function summarizeRegion(
  region: RegionKey,
  rows: { entity: string; item: NewsItem }[],
): Promise<RegionalSummaryBody | null> {
  if (rows.length === 0) return null;
  const user = `Region: ${REGION_LABEL[region]}

Most recent news items (newest first, limited to the top ${rows.length}):

${formatContext(rows)}

Produce the JSON now.`;

  try {
    const res = await client.messages.create({
      model: MODEL,
      cost_label: `regional-summary:${region}`,
      max_tokens: 1400,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: user }],
    });
    const raw = res.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("\n");
    // Extract the first {...} block — Sonnet sometimes wraps in code fences.
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as {
      summary: string;
      highlights?: RegionalHighlight[];
    };
    const summary = parsed.summary?.trim();
    if (!summary) return null;
    const highlights = (parsed.highlights ?? []).filter(
      (h) =>
        h &&
        typeof h.text === "string" &&
        summary.includes(h.text) &&
        ["legislation", "infrastructure", "cooperation"].includes(h.topic),
    );
    return {
      summary,
      highlights,
      generatedAt: new Date().toISOString(),
      sourcePolicy: "official-only",
      sourceCount: rows.length,
      sourceIds: [
        ...new Set(
          rows
            .map(({ item }) => item.sourceId)
            .filter((sourceId): sourceId is string => Boolean(sourceId)),
        ),
      ].sort(),
    };
  } catch (err) {
    console.error(`  regional summary failed for ${region}:`, (err as Error).message);
    return null;
  }
}

/**
 * Regenerate summaries for the requested regions, in-place on the
 * provided NewsFile object. Caller is responsible for writing the file.
 */
export async function regenerateRegions(
  news: NewsFile,
  regions: RegionKey[],
): Promise<RegionKey[]> {
  const updated: RegionKey[] = [];
  for (const region of regions) {
    const rows = collectRecentForRegion(news, region);
    if (rows.length === 0) {
      news.regional[region] = {
        ...(news.regional[region] ?? {}),
        summary: "",
        highlights: [],
        generatedAt: new Date().toISOString(),
        sourcePolicy: "official-only",
        sourceCount: 0,
        sourceIds: [],
      };
      updated.push(region);
      continue;
    }
    const body = await summarizeRegion(region, rows);
    if (!body) continue;
    news.regional[region] = { ...(news.regional[region] ?? {}), ...body };
    updated.push(region);
  }
  return updated;
}
