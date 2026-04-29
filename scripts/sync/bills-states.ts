/**
 * Sync US state-level stablecoin bills from OpenStates API v3.
 *
 * Flow:
 *   1. For each target state, search OpenStates for stablecoin-related bills.
 *   2. Fetch full bill detail (actions + sources) for each result.
 *   3. Map to the app's Legislation shape.
 *   4. Merge into data/legislation/states/{state-slug}.json (preserving
 *      existing non-stablecoin bills and all hand-written fields).
 *
 * Environment:
 *   STATE_API_KEY (required) — register at https://openstates.org/accounts/profile/
 *   STATES_FORCE_REFRESH=1  — re-fetch bills already in cache
 *
 * Run:
 *   npx tsx scripts/sync/bills-states.ts
 */

import "../env.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchOpenStates, ensureBudgetOk, runCount, dayCount } from "./openstates.js";
import type { Legislation, Stage, StanceType } from "../../types/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const STATES_DIR = join(ROOT, "data/legislation/states");
const RAW_DIR = join(ROOT, "data/raw/openstates");
const FORCE = process.env.STATES_FORCE_REFRESH === "1";

// States to sync — postal code → slug matching data/legislation/states/*.json
const TARGET_STATES: Array<{ code: string; name: string; slug: string }> = [
  { code: "ny", name: "New York",   slug: "new-york"    },
  { code: "ca", name: "California", slug: "california"  },
  { code: "tx", name: "Texas",      slug: "texas"       },
  { code: "fl", name: "Florida",    slug: "florida"     },
  { code: "wy", name: "Wyoming",    slug: "wyoming"     },
  { code: "il", name: "Illinois",   slug: "illinois"    },
  { code: "wa", name: "Washington", slug: "washington"  },
  { code: "nj", name: "New Jersey", slug: "new-jersey"  },
  { code: "co", name: "Colorado",   slug: "colorado"    },
  { code: "az", name: "Arizona",    slug: "arizona"     },
];

// Single query keeps request count low — OpenStates free tier is strict on rate limits.
const SEARCH_QUERIES = ["stablecoin", "stable token"];

// Bill title must mention at least one of these to be kept
const TITLE_RELEVANCE = /stablecoin|stable.?token|payment stablecoin|digital payment|digital asset.*currenc|virtual currenc.*payment/i;

// ─── OpenStates response shapes ───────────────────────────────────────────────

interface OSBillSummary {
  id: string;
  identifier: string;
  title: string;
  classification: string[];
  openstates_url: string;
  latest_action_date: string | null;
  latest_action_description: string | null;
  first_action_date: string | null;
  jurisdiction: { id: string; name: string; classification: string };
  from_organization: { name: string; classification: string };
  updated_at: string;
}

interface OSAction {
  date: string;
  description: string;
  order: number;
  classification: string[];
  organization: { name: string; classification: string };
}

interface OSBillDetail extends OSBillSummary {
  actions: OSAction[];
  sources: Array<{ url: string; note?: string }>;
  sponsors: Array<{
    name: string;
    classification: string;
    primary: boolean;
    entity_type: string;
  }>;
}

interface OSBillsResponse {
  results: OSBillSummary[];
  pagination: { max_page: number; page: number; per_page: number; total_items: number };
}

// ─── Stage mapping ────────────────────────────────────────────────────────────

function deriveStage(latest: string | null, actions: OSAction[]): Stage {
  const sorted = [...actions].sort((a, b) => b.date.localeCompare(a.date));

  for (const action of sorted) {
    const t = action.description.toLowerCase();
    const cls = action.classification;

    if (
      t.includes("signed by governor") ||
      t.includes("chaptered") ||
      t.includes("enacted into law") ||
      cls.includes("executive-signature")
    ) return "Enacted";

    if (
      t.includes("vetoed") ||
      t.includes("failed") ||
      t.includes("tabled") ||
      t.includes("indefinitely postponed") ||
      cls.includes("failure") ||
      cls.includes("executive-veto")
    ) return "Dead";

    if (
      cls.includes("passage") ||
      t.includes("passed senate") ||
      t.includes("passed house") ||
      t.includes("passed assembly") ||
      t.includes("enrolled")
    ) return "Floor";

    if (
      cls.includes("committee-passage") ||
      t.includes("reported by committee") ||
      t.includes("advanced from committee") ||
      t.includes("placed on calendar")
    ) return "Floor";

    if (
      cls.includes("referral-committee") ||
      t.includes("referred to") ||
      t.includes("assigned to committee")
    ) return "Committee";
  }

  if (!latest) return "Filed";
  const t = latest.toLowerCase();
  if (t.includes("signed") || t.includes("chaptered")) return "Enacted";
  if (t.includes("passed")) return "Floor";
  if (t.includes("failed") || t.includes("vetoed") || t.includes("tabled")) return "Dead";
  if (t.includes("referred")) return "Committee";
  return "Filed";
}

// ─── Stance heuristic ─────────────────────────────────────────────────────────

function deriveStance(title: string, latest: string | null): StanceType {
  const text = `${title} ${latest ?? ""}`.toLowerCase();
  if (text.includes("prohibit") || text.includes("ban ") || text.includes("restrict")) return "concerning";
  if (
    text.includes("framework") ||
    text.includes("authorize") ||
    text.includes("permit") ||
    text.includes("license") ||
    text.includes("safe harbor")
  ) return "favorable";
  return "review";
}

// ─── Bill ID normalizer ───────────────────────────────────────────────────────

function billId(stateCode: string, identifier: string): string {
  // "A.1415" → "a1415", "SB 394" → "sb394", "H.B. 123" → "hb123"
  const norm = identifier.toLowerCase().replace(/[\s.]+/g, "");
  return `${stateCode}-sc-${norm}`;
}

// ─── State file types ─────────────────────────────────────────────────────────

interface StateFile {
  state: string;
  stateCode: string;
  region: string;
  stance?: string;
  stanceDatacenter: string;
  stanceAI: string;
  lastUpdated: string;
  contextBlurb: string;
  legislation: Legislation[];
}

function loadStateFile(slug: string): StateFile | null {
  const path = join(STATES_DIR, `${slug}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as StateFile;
}

function saveStateFile(slug: string, data: StateFile) {
  const path = join(STATES_DIR, `${slug}.json`);
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

// ─── Raw cache ────────────────────────────────────────────────────────────────

interface RawCache {
  fetchedAt: string;
  bills: Record<string, OSBillDetail>;
}

function loadRawCache(stateCode: string): RawCache {
  mkdirSync(RAW_DIR, { recursive: true });
  const path = join(RAW_DIR, `${stateCode}.json`);
  if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8")) as RawCache;
  return { fetchedAt: "", bills: {} };
}

function saveRawCache(stateCode: string, cache: RawCache) {
  writeFileSync(join(RAW_DIR, `${stateCode}.json`), JSON.stringify(cache, null, 2) + "\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function syncState(state: (typeof TARGET_STATES)[number]) {
  console.log(`\n[bills-states] ── ${state.name} (${state.code.toUpperCase()}) ──`);

  const cache = loadRawCache(state.code);
  const seenIds = new Set<string>();

  // 1. Search for stablecoin bills
  for (const query of SEARCH_QUERIES) {
    const res = await fetchOpenStates<OSBillsResponse>("/bills", {
      jurisdiction: state.code,
      query,
      per_page: 20,
      page: 1,
      include: "sources",
    });

    for (const bill of res.results ?? []) {
      if (!TITLE_RELEVANCE.test(bill.title ?? "")) continue;
      if (!["bill", "resolution"].some((c) => bill.classification?.includes(c))) continue;
      seenIds.add(bill.id);
    }
  }

  console.log(`[bills-states] ${state.name}: ${seenIds.size} candidate bill(s) found`);

  // 2. Fetch detail for each unseen bill
  for (const id of seenIds) {
    if (!FORCE && cache.bills[id]) continue;
    try {
      const detail = await fetchOpenStates<OSBillDetail>(`/bills/${encodeURIComponent(id)}`, {
        include: "actions,sources,sponsors",
      });
      cache.bills[id] = detail;
    } catch (e) {
      console.warn(`[bills-states] failed to fetch ${id}:`, (e as Error).message);
    }
  }

  cache.fetchedAt = new Date().toISOString();
  saveRawCache(state.code, cache);

  // 3. Map to Legislation and merge into state file
  const stateFile = loadStateFile(state.slug);
  if (!stateFile) {
    console.warn(`[bills-states] no state file for ${state.slug} — skipping merge`);
    return;
  }

  const existingById = new Map(stateFile.legislation.map((l) => [l.id, l]));
  let added = 0;
  let updated = 0;

  for (const bill of Object.values(cache.bills)) {
    if (!seenIds.has(bill.id)) continue;

    const id = billId(state.code, bill.identifier);
    const stage = deriveStage(bill.latest_action_description, bill.actions ?? []);
    const stance = deriveStance(bill.title, bill.latest_action_description);
    const sourceUrl = bill.sources?.[0]?.url ?? bill.openstates_url;
    const updatedDate = (bill.latest_action_date ?? bill.updated_at ?? "").slice(0, 10);
    const sponsors = (bill.sponsors ?? [])
      .filter((s) => s.primary)
      .map((s) => s.name);

    const leg: Legislation = {
      id,
      billCode: bill.identifier,
      title: bill.title,
      summary: "",
      stage,
      stance,
      impactTags: [],
      stablecoinTags: [],
      category: "stablecoin-regulation",
      updatedDate,
      sourceUrl,
      sponsors: sponsors.length > 0 ? sponsors : undefined,
    };

    if (existingById.has(id)) {
      const prev = existingById.get(id)!;
      existingById.set(id, {
        ...prev,
        stage: leg.stage,
        updatedDate: leg.updatedDate,
        sourceUrl: leg.sourceUrl,
        sponsors: leg.sponsors ?? prev.sponsors,
      });
      updated++;
    } else {
      existingById.set(id, leg);
      added++;
      console.log(`[bills-states] + ${bill.identifier} "${bill.title.slice(0, 60)}" → ${stage}`);
    }
  }

  stateFile.legislation = Array.from(existingById.values()).sort((a, b) =>
    (b.updatedDate ?? "").localeCompare(a.updatedDate ?? ""),
  );

  saveStateFile(state.slug, stateFile);
  console.log(`[bills-states] ${state.name}: ${added} added, ${updated} updated`);
}

async function main() {
  ensureBudgetOk();
  mkdirSync(RAW_DIR, { recursive: true });

  // Optional: pass a state code as CLI arg to sync only that state.
  // e.g. npx tsx scripts/sync/bills-states.ts ny
  const filter = process.argv[2]?.toLowerCase();
  const targets = filter
    ? TARGET_STATES.filter((s) => s.code === filter || s.slug === filter)
    : TARGET_STATES;

  if (filter && targets.length === 0) {
    console.error(`[bills-states] unknown state "${filter}". Valid codes: ${TARGET_STATES.map((s) => s.code).join(", ")}`);
    process.exit(1);
  }

  for (const state of targets) {
    await syncState(state);
  }

  console.log(
    `\n[bills-states] done · openstates calls this run: ${runCount()} · day total: ${dayCount()}`,
  );
}

main().catch((e) => {
  console.error("[bills-states] fatal:", e.message);
  process.exit(1);
});
