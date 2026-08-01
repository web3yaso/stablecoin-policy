import "../env.js";
import { readSupabaseConfig, SupabaseHttpClient } from "../../lib/data/supabase-client.js";

async function main() {
  const client = new SupabaseHttpClient(readSupabaseConfig());
  let directInsertDenied = false;
  try {
    await client.rest("review_records", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        review_id: "review:negative-smoke:missing",
        claim_id: "claim:negative-smoke:missing",
        outcome: "APPROVED",
        reviewer_role: "Negative-path smoke",
        reviewer_ref: "reviewer:negative-smoke",
        evidence_fingerprint_sha256: "0".repeat(64),
        reviewed_at: new Date().toISOString(),
      }),
    });
  } catch (error: unknown) {
    directInsertDenied = error instanceof Error && /permission denied|42501/i.test(error.message);
    if (!directInsertDenied) throw error;
  }
  if (!directInsertDenied) throw new Error("service role directly inserted a claim review record");

  let missingClaimRejected = false;
  try {
    await client.rpc("submit_legal_claim_for_review", {
      p_claim_id: "claim:negative-smoke:missing",
    });
  } catch (error: unknown) {
    missingClaimRejected = error instanceof Error && /no rows|P0002/i.test(error.message);
    if (!missingClaimRejected) throw error;
  }
  if (!missingClaimRejected) throw new Error("missing claim entered review");

  console.log(JSON.stringify({ directInsertDenied, missingClaimRejected }));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
