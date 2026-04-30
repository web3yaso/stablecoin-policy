/**
 * Quick smoke test — confirms CONGRESS_API_KEY works and prints
 * the most recently updated stablecoin bill.
 *
 * Run: npx tsx scripts/smoke/congress-ping.ts
 */
import "../env.js";
import { fetchCongress } from "../sync/congress.js";

async function main() {
  console.log("[smoke] pinging Congress.gov — searching for 'stablecoin' in Congress 119...");
  const data = await fetchCongress<{
    bills: Array<{ type: string; number: string; title: string; latestAction?: { actionDate: string; text: string } }>;
    pagination: { count: number };
  }>("/bill", { query: "stablecoin", congress: 119, limit: 3, sort: "updateDate+desc" });

  console.log(`[smoke] total results: ${data.pagination?.count ?? "?"}`);
  for (const b of data.bills ?? []) {
    console.log(`  ${b.type} ${b.number} — ${b.title}`);
    console.log(`    latest action (${b.latestAction?.actionDate}): ${b.latestAction?.text}`);
  }
  console.log("[smoke] OK");
}

main().catch((e) => {
  console.error("[smoke] FAILED:", e.message);
  process.exit(1);
});
