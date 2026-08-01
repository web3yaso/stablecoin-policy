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
  const shouldImport = args.includes("--import");
  const shouldPreflight = args.includes("--preflight") || shouldImport;
  if (!shouldPreflight) {
    console.log(JSON.stringify(summary, null, 2));
    console.error("validated locally only; use --preflight to check database evidence and ID references");
    return;
  }
  const client = new ClaimDraftImportClient(new SupabaseHttpClient(readSupabaseConfig()));
  const preflight = await client.preflight(bundle);
  if (!shouldImport) {
    console.log(JSON.stringify(preflight, null, 2));
    console.error("read-only database preflight; legal validity is not assessed");
    return;
  }
  if (!preflight.importReady) {
    throw new Error("claim draft bundle is not import-ready; inspect preflight importErrors");
  }
  const imported = await client.import(bundle);
  console.log(JSON.stringify({ preflight, imported }, null, 2));
  if (!preflight.reviewEvidenceReady) {
    console.error("private DRAFT imported; evidence blockers remain before human review");
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
