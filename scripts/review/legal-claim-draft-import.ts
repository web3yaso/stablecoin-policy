import "../env.js";
import { readFile } from "node:fs/promises";
import { readSupabaseConfig, SupabaseHttpClient } from "../../lib/data/supabase-client.js";
import { assertClaimDraftBundle, ClaimDraftImportClient } from "../../lib/legal-corpus/claim-draft-import.js";

async function main() {
  const args = process.argv.slice(2);
  const index = args.indexOf("--file");
  const path = index >= 0 ? args[index + 1] : undefined;
  if (!path || path.startsWith("--")) throw new Error("--file requires a value");
  const bundle: unknown = JSON.parse(await readFile(path, "utf8"));
  assertClaimDraftBundle(bundle);
  const summary = { batchId: bundle.batchId, jurisdictionCode: bundle.jurisdictionCode, claimCount: bundle.claims.length, citationCount: bundle.claims.reduce((n, claim) => n + claim.citations.length, 0), targetReviewState: "DRAFT" };
  if (!args.includes("--import")) {
    console.log(JSON.stringify(summary, null, 2));
    console.error("validated only; use --import to atomically create private DRAFT claims and citations");
    return;
  }
  const client = new ClaimDraftImportClient(new SupabaseHttpClient(readSupabaseConfig()));
  console.log(JSON.stringify(await client.import(bundle), null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
