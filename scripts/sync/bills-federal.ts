/**
 * Sync US federal stablecoin bills from GovInfo + Congress.gov.
 *
 * Flow:
 *   1. Discover official bill-text packages with GovInfo full-text search.
 *   2. Fetch details + actions for each bill.
 *   3. Map to the app's Legislation shape (heuristic stage + stance).
 *   4. Write data/raw/congress/bills.json  (raw cache)
 *      Write data/legislation/federal.json (app-ready, merged with existing)
 *
 * Environment:
 *   CONGRESS_API_KEY  (required) — get one at https://api.congress.gov/sign-up/
 *   GOVINFO_API_KEY   (optional) — falls back to CONGRESS_API_KEY
 *
 * Run:
 *   npx tsx scripts/sync/bills-federal.ts
 */

import "../env.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchCongress, ensureBudgetOk, runCount } from "./congress.js";
import type { Legislation, Stage, StanceType } from "../../types/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const RAW_DIR = join(ROOT, "data/raw/congress");
const RAW_BILLS_PATH = join(RAW_DIR, "bills.json");
const OUT_PATH = join(ROOT, "data/legislation/federal.json");

const CURRENT_CONGRESS = 119; // 2025–2026

// Known stablecoin bills to always fetch directly by number.
// Format: { congress?, type, number } — congress defaults to CURRENT_CONGRESS.
// Direct references provide a safety net if an upstream search is unavailable.
// Add new bills here as they're introduced.
const KNOWN_BILLS: Array<{ congress?: number; type: string; number: string }> = [
  { type: "s",  number: "394"  },         // GENIUS Act of 2025 — original Senate bill (119th)
  { type: "s",  number: "1582" },         // GENIUS Act — final enrolled/enacted version (119th)
  { type: "hr", number: "2392" },         // STABLE Act of 2025 (House, 119th)
  { type: "hr", number: "3633" },         // Digital Asset Market Clarity Act (House, 119th)
  { congress: 118, type: "s", number: "4155" }, // https://www.congress.gov/bill/118th-congress/senate-bill/4155
  // TODO: add STABLE Act Senate companion and GENIUS Act House companion once confirmed
];

// ─── Congress.gov response shapes ────────────────────────────────────────────

interface CongressBillDetail {
  bill: {
    congress: number;
    type: string;
    number: string;
    title: string;
    introducedDate?: string;
    latestAction?: { actionDate: string; text: string };
    updateDate?: string;
    policyArea?: { name: string };
    sponsors?: Array<{ bioguideId: string; fullName: string; party: string; state: string }>;
    cosponsors?: { count: number; countIncludingWithdrawnCosponsors: number };
    cboCostEstimates?: unknown[];
    constitutionalAuthorityStatementText?: string;
    committees?: { count: number };
    actions?: { count: number; url?: string };
    textVersions?: { count: number; url?: string };
    summaries?: { count: number; url?: string };
    notes?: string;
    laws?: Array<{ type: string; number: string }>;
  };
}

interface CongressAction {
  actionDate: string;
  text: string;
  type: string;
  actionCode?: string;
  sourceSystem?: { code: number; name: string };
  committees?: Array<{ name: string; systemCode: string }>;
}

interface GovInfoSearchResult {
  packageId?: string;
  title?: string;
}

interface GovInfoSearchResponse {
  results?: GovInfoSearchResult[];
}

interface DiscoveredBill {
  congress: number;
  type: string;
  number: string;
  packageId: string;
}

const GOVINFO_DISCOVERY_TERMS = ["stablecoin"];

async function discoverBillsViaGovInfo(): Promise<DiscoveredBill[]> {
  const apiKey =
    process.env.GOVINFO_API_KEY?.trim() ||
    process.env.CONGRESS_API_KEY?.trim() ||
    process.env.REGULATIONS_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "GovInfo discovery requires an api.data.gov key (GOVINFO_API_KEY or CONGRESS_API_KEY)",
    );
  }

  const outputs = await Promise.all(
    GOVINFO_DISCOVERY_TERMS.map(async (term) => {
      const escapedTerm = term.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const queryTerm = /\s/.test(escapedTerm)
        ? `"${escapedTerm}"`
        : escapedTerm;
      const response = await fetch("https://api.govinfo.gov/search", {
        method: "POST",
        signal: AbortSignal.timeout(15_000),
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Api-Key": apiKey,
        },
        body: JSON.stringify({
          query:
            `collection:(BILLS) and congress:${CURRENT_CONGRESS} and ` +
            queryTerm,
          pageSize: "100",
          offsetMark: "*",
          sorts: [{ field: "publishdate", sortOrder: "DESC" }],
          resultLevel: "package",
          historical: true,
        }),
      });
      if (!response.ok) {
        throw new Error(
          `GovInfo search for "${term}" failed: ${response.status} ${response.statusText}`,
        );
      }
      return (await response.json() as GovInfoSearchResponse).results ?? [];
    }),
  );

  const discovered = new Map<string, DiscoveredBill>();
  for (const result of outputs.flat()) {
    const packageId = result.packageId?.trim();
    const match = packageId?.match(
      /^BILLS-(\d+)(hconres|sconres|hjres|sjres|hres|sres|hr|s)(\d+)[a-z0-9]+$/i,
    );
    if (!packageId || !match) continue;
    const bill = {
      congress: Number(match[1]),
      type: match[2].toUpperCase(),
      number: match[3],
      packageId,
    };
    discovered.set(`${bill.congress}/${bill.type}/${bill.number}`, bill);
  }
  return [...discovered.values()];
}

// ─── Stage mapping ────────────────────────────────────────────────────────────

function deriveStage(detail: CachedBill, actions: CongressAction[]): Stage {
  // Check if it became law
  if (detail.laws && detail.laws.length > 0) return "Enacted";

  const latestText = (detail.latestAction?.text ?? "").toLowerCase();

  // Sort actions newest-first for scanning
  const sorted = [...actions].sort((a, b) => b.actionDate.localeCompare(a.actionDate));

  for (const action of sorted) {
    const t = action.text.toLowerCase();
    const code = (action.actionCode ?? "").toLowerCase();

    if (
      t.includes("became public law") ||
      t.includes("signed by president") ||
      t.includes("enacted into law")
    ) return "Enacted";

    if (
      t.includes("passed senate") ||
      t.includes("passed house") ||
      t.includes("agreed to in") ||
      code === "36000" // BecameLaw
    ) return "Floor";

    if (
      t.includes("placed on senate legislative calendar") ||
      t.includes("ordered to be reported") ||
      t.includes("reported by") ||
      action.type === "Floor"
    ) return "Floor";

    if (
      t.includes("failed") ||
      t.includes("tabled") ||
      t.includes("indefinitely postponed") ||
      t.includes("rejected")
    ) return "Dead";
  }

  if (
    latestText.includes("referred to the") ||
    latestText.includes("committee on") ||
    latestText.includes("referred to committee")
  ) return "Committee";

  return "Filed";
}

// ─── Stance heuristic ─────────────────────────────────────────────────────────

function deriveStance(detail: CachedBill): StanceType {
  const text = `${detail.title} ${detail.latestAction?.text ?? ""}`.toLowerCase();
  if (text.includes("prohibit") || text.includes("ban") || text.includes("restrict")) {
    return "concerning";
  }
  if (text.includes("framework") || text.includes("authorize") || text.includes("permit")) {
    return "favorable";
  }
  return "review";
}

// ─── Bill code formatter ──────────────────────────────────────────────────────

function billCode(type: string, number: string): string {
  const t = type.toUpperCase();
  if (t === "HR") return `H.R.${number}`;
  if (t === "S") return `S.${number}`;
  if (t === "HJRES") return `H.J.Res.${number}`;
  if (t === "SJRES") return `S.J.Res.${number}`;
  if (t === "HRES") return `H.Res.${number}`;
  if (t === "SRES") return `S.Res.${number}`;
  return `${t} ${number}`;
}

function billUrl(congress: number, type: string, number: string): string {
  const pathByType: Record<string, string> = {
    HR: "house-bill",
    S: "senate-bill",
    HJRES: "house-joint-resolution",
    SJRES: "senate-joint-resolution",
    HRES: "house-resolution",
    SRES: "senate-resolution",
  };
  const path = pathByType[type.toUpperCase()] ?? type.toLowerCase();
  return `https://www.congress.gov/bill/${congress}th-congress/${path}/${number}`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

type CachedBill = Omit<CongressBillDetail["bill"], "actions"> & { actions: CongressAction[] };

interface RawCache {
  fetchedAt: string;
  bills: Record<string, CachedBill>;
}

function loadRawCache(): RawCache {
  if (existsSync(RAW_BILLS_PATH)) {
    const parsed = JSON.parse(
      readFileSync(RAW_BILLS_PATH, "utf8"),
    ) as RawCache;
    const bills: Record<string, CachedBill> = {};
    // Older caches used "TYPE/number" keys. Canonicalize in memory so the
    // first run after this migration refreshes rather than duplicating them.
    for (const bill of Object.values(parsed.bills ?? {})) {
      const congress = bill.congress ?? CURRENT_CONGRESS;
      const key = `${congress}/${bill.type.toUpperCase()}/${bill.number}`;
      bills[key] = bill;
    }
    return { fetchedAt: parsed.fetchedAt ?? "", bills };
  }
  return { fetchedAt: "", bills: {} };
}

interface FederalFile {
  legislation: Legislation[];
}

function loadExisting(): FederalFile {
  if (existsSync(OUT_PATH)) {
    return JSON.parse(readFileSync(OUT_PATH, "utf8")) as FederalFile;
  }
  return { legislation: [] };
}

async function main() {
  ensureBudgetOk();
  mkdirSync(RAW_DIR, { recursive: true });
  mkdirSync(dirname(OUT_PATH), { recursive: true });

  const cache = loadRawCache();
  const seen = new Set<string>(); // "congress/type/number"

  // 1. Seed known bills directly by number as an upstream-failure safety net.
  console.log(`[bills-federal] fetching ${KNOWN_BILLS.length} known bills directly...`);
  for (const bill of KNOWN_BILLS) {
    const congress = bill.congress ?? CURRENT_CONGRESS;
    seen.add(`${congress}/${bill.type.toUpperCase()}/${bill.number}`);
  }

  // 2. GovInfo performs the keyword search over official bill text. The
  //    Congress.gov /bill list has no keyword parameter.
  console.log("[bills-federal] running GovInfo full-text discovery...");
  let discovered: DiscoveredBill[] = [];
  try {
    discovered = await discoverBillsViaGovInfo();
  } catch (error) {
    console.warn(
      `[bills-federal] GovInfo discovery unavailable; continuing with known bills: ${(error as Error).message}`,
    );
  }
  for (const bill of discovered) {
    if (!["S", "HR"].includes(bill.type)) continue;
    seen.add(`${bill.congress}/${bill.type}/${bill.number}`);
  }
  console.log(
    `[bills-federal] discovery: ${discovered.length} unique official bill(s) found`,
  );

  console.log(`[bills-federal] ${seen.size} unique bills to process`);

  // 3. Fetch details + actions for each bill
  for (const key of seen) {
    const [congress, type, number] = key.split("/");
    try {
      const detailRes = await fetchCongress<CongressBillDetail>(
        `/bill/${congress}/${type.toLowerCase()}/${number}`,
      );
      if (!detailRes.bill) {
        console.warn(`[bills-federal] ${key}: no bill data returned (wrong number?)`);
        continue;
      }
      const actionsRes = await fetchCongress<{ actions: CongressAction[] }>(
        `/bill/${congress}/${type.toLowerCase()}/${number}/actions`,
        { limit: 50 },
      );
      cache.bills[key] = {
        ...detailRes.bill,
        actions: actionsRes.actions ?? [],
      };
    } catch (e) {
      console.warn(`[bills-federal] failed to fetch ${key}:`, (e as Error).message);
    }
  }

  cache.fetchedAt = new Date().toISOString();
  writeFileSync(RAW_BILLS_PATH, JSON.stringify(cache, null, 2) + "\n");
  console.log(`[bills-federal] raw cache written to ${RAW_BILLS_PATH}`);

  // 4. Map to Legislation shape and merge into federal.json
  const existing = loadExisting();
  const existingById = new Map(existing.legislation.map((l) => [l.id, l]));

  let added = 0;
  let updated = 0;

  for (const bill of Object.values(cache.bills)) {
    const code = billCode(bill.type, bill.number);
    const congressNum = bill.congress ?? CURRENT_CONGRESS;
    const id = `federal-${congressNum}-${bill.type.toLowerCase()}-${bill.number}`;
    const stage = deriveStage(bill, bill.actions);
    const stance = deriveStance(bill);
    const url = billUrl(congressNum, bill.type, bill.number);
    const updatedDate = (bill.latestAction?.actionDate ?? bill.updateDate ?? "").slice(0, 10);

    const leg: Legislation = {
      id,
      billCode: code,
      title: bill.title,
      summary: "",
      stage,
      stance,
      impactTags: [],
      category: "stablecoin-regulation",
      updatedDate,
      sourceUrl: url,
    };

    if (existingById.has(id)) {
      // Preserve hand-written summary/stance overrides, only update dynamic fields
      const prev = existingById.get(id)!;
      existingById.set(id, {
        ...prev,
        stage: leg.stage,
        updatedDate: leg.updatedDate,
        sourceUrl: leg.sourceUrl,
      });
      updated++;
    } else {
      existingById.set(id, leg);
      added++;
      console.log(`[bills-federal] + ${code} "${bill.title.slice(0, 60)}" → ${stage}`);
    }
  }

  const out: FederalFile = {
    legislation: Array.from(existingById.values()).sort((a, b) =>
      (b.updatedDate ?? "").localeCompare(a.updatedDate ?? ""),
    ),
  };

  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + "\n");
  console.log(
    `[bills-federal] done — ${added} added, ${updated} updated · congress.gov calls this run: ${runCount()}`,
  );
  console.log(`[bills-federal] output: ${OUT_PATH} (${out.legislation.length} bills total)`);
}

main().catch((e) => {
  console.error("[bills-federal] fatal:", e.message);
  process.exit(1);
});
