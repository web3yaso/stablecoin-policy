/**
 * Fetch roll-call vote data for every federal stablecoin bill via Congress.gov.
 *
 * Flow:
 *   1. Read data/legislation/federal.json for bill codes.
 *   2. For each bill, fetch its actions from Congress.gov.
 *   3. Find recorded-vote actions and fetch the vote details.
 *   4. Write data/votes/federal.json.
 *
 * Environment:
 *   CONGRESS_API_KEY (required)
 *   VOTES_FORCE_REFRESH=1 to re-fetch bills already cached
 *
 * Run: npx tsx scripts/sync/votes-congress.ts
 */
import "../env.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchCongress, runCount, hourCount } from "./congress.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const FEDERAL_BILLS = join(ROOT, "data/legislation/federal.json");
const OUT = join(ROOT, "data/votes/federal.json");
const FORCE = process.env.VOTES_FORCE_REFRESH === "1";
const CURRENT_CONGRESS = 119;

interface FederalBill {
  id: string;
  billCode: string;
  title: string;
  stage: string;
  sourceUrl?: string;
}

interface VoteEntry {
  actionDate: string;
  description: string;
  chamber: "H" | "S";
  result: "passed" | "failed" | "unknown";
  tally?: { yea: number; nay: number };
  sourceUrl?: string;
}

interface VotesFile {
  generatedAt: string;
  votes: Record<string, { billCode: string; entries: VoteEntry[] }>;
}

function ensureDir(path: string) {
  const d = dirname(path);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

function loadExisting(): VotesFile {
  if (!existsSync(OUT)) return { generatedAt: new Date().toISOString(), votes: {} };
  return JSON.parse(readFileSync(OUT, "utf8")) as VotesFile;
}

/** Parse bill code like "H.R.2392" or "S.394" → { type, number } */
function parseBillCode(code: string): { type: string; number: string } | null {
  const hr = code.match(/^H\.R\.(\d+)$/);
  if (hr) return { type: "hr", number: hr[1] };
  const s = code.match(/^S\.(\d+)$/);
  if (s) return { type: "s", number: s[1] };
  const hjres = code.match(/^H\.J\.Res\.(\d+)$/i);
  if (hjres) return { type: "hjres", number: hjres[1] };
  const sjres = code.match(/^S\.J\.Res\.(\d+)$/i);
  if (sjres) return { type: "sjres", number: sjres[1] };
  return null;
}

interface CongressAction {
  actionDate: string;
  text: string;
  type: string;
  actionCode?: string;
  recordedVotes?: Array<{
    chamber: string;
    congress: number;
    date: string;
    rollNumber: number;
    sessionNumber: number;
    url: string;
  }>;
}

async function main() {
  if (!existsSync(FEDERAL_BILLS)) {
    console.error(`[votes] ${FEDERAL_BILLS} not found — run bills-federal.ts first`);
    process.exit(1);
  }

  const { legislation: bills } = JSON.parse(readFileSync(FEDERAL_BILLS, "utf8")) as {
    legislation: FederalBill[];
  };
  console.log(`[votes] ${bills.length} federal bills`);

  const out = loadExisting();
  let enriched = 0;
  let skipped = 0;

  for (const bill of bills) {
    if (!FORCE && out.votes[bill.id]) {
      skipped++;
      continue;
    }

    const parsed = parseBillCode(bill.billCode);
    if (!parsed) {
      console.warn(`[votes] cannot parse bill code: ${bill.billCode}`);
      continue;
    }

    let actions: CongressAction[] = [];
    try {
      const res = await fetchCongress<{ actions: CongressAction[] }>(
        `/bill/${CURRENT_CONGRESS}/${parsed.type}/${parsed.number}/actions`,
        { limit: 50 },
      );
      actions = res.actions ?? [];
    } catch (e) {
      console.warn(`[votes] failed to fetch actions for ${bill.billCode}:`, (e as Error).message);
      continue;
    }

    const entries: VoteEntry[] = [];
    for (const action of actions) {
      // Congress.gov marks recorded-vote actions with recordedVotes array
      const votes = action.recordedVotes ?? [];
      for (const rv of votes) {
        const chamber = rv.chamber.toLowerCase().startsWith("h") ? "H" : "S";
        const actionLower = action.text.toLowerCase();
        const passed =
          actionLower.includes("passed") || actionLower.includes("agreed to")
            ? "passed"
            : actionLower.includes("failed") || actionLower.includes("rejected")
              ? "failed"
              : "unknown";

        entries.push({
          actionDate: action.actionDate,
          description: action.text,
          chamber,
          result: passed,
          sourceUrl: rv.url,
        });
      }

      // Also capture simple passage actions without a recorded vote
      if (votes.length === 0 && action.type === "Floor") {
        const t = action.text.toLowerCase();
        if (t.includes("passed") || t.includes("agreed to") || t.includes("failed")) {
          const chamber: "H" | "S" = t.includes("senate") ? "S" : "H";
          entries.push({
            actionDate: action.actionDate,
            description: action.text,
            chamber,
            result: t.includes("failed") ? "failed" : "passed",
          });
        }
      }
    }

    out.votes[bill.id] = { billCode: bill.billCode, entries };
    if (entries.length > 0) {
      enriched++;
      console.log(`[votes] ${bill.billCode}: ${entries.length} vote action(s)`);
    }
  }

  out.generatedAt = new Date().toISOString();
  ensureDir(OUT);
  writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(
    `[votes] wrote ${OUT} — ${enriched} bills with votes, ${skipped} skipped (cached) · congress.gov calls: ${runCount()} (hour ${hourCount()})`,
  );
}

main().catch((e) => {
  console.error("[votes] fatal:", e.message);
  process.exit(1);
});
