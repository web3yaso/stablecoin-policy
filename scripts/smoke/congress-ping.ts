/**
 * Quick smoke test — confirms CONGRESS_API_KEY works and prints
 * one known stablecoin bill. Keyword discovery is tested separately through
 * GovInfo by `npm run news:sources:check`; Congress.gov's /bill list does not
 * support a keyword query parameter.
 *
 * Run: npx tsx scripts/smoke/congress-ping.ts
 */
import "../env.js";
import { fetchCongress } from "../sync/congress.js";

async function main() {
  console.log("[smoke] pinging Congress.gov — fetching 119th Congress S. 1582...");
  const data = await fetchCongress<{
    bill?: {
      type: string;
      number: string;
      title: string;
      latestAction?: { actionDate: string; text: string };
    };
  }>("/bill/119/s/1582");

  if (!data.bill) throw new Error("Congress.gov returned no bill payload");
  const bill = data.bill;
  console.log(`  ${bill.type} ${bill.number} — ${bill.title}`);
  console.log(
    `    latest action (${bill.latestAction?.actionDate ?? "unknown"}): ` +
      `${bill.latestAction?.text ?? "not available"}`,
  );
  console.log("[smoke] OK");
}

main().catch((e) => {
  console.error("[smoke] FAILED:", e.message);
  process.exit(1);
});
