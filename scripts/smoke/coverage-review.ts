import "../env.js";
import { readSupabaseConfig, SupabaseHttpClient } from "../../lib/data/supabase-client.js";

async function main() {
  const client = new SupabaseHttpClient(readSupabaseConfig());
  let directInsertDenied = false;
  try {
    await client.rest("coverage_scopes", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        jurisdiction_code: "invalid",
        display_name: "must not persist",
        coverage_state: "REVIEWED",
        completeness_percent: 100,
        freshness_state: "CURRENT",
        reviewed_at: new Date().toISOString(),
      }),
    });
  } catch (error: unknown) {
    directInsertDenied = error instanceof Error && /permission denied|42501/i.test(error.message);
    if (!directInsertDenied) throw error;
  }
  if (!directInsertDenied) throw new Error("service role directly inserted a coverage scope");

  let directUpdateDenied = false;
  try {
    await client.rest("coverage_scopes?jurisdiction_code=eq.ZZ", {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ completeness_percent: 100 }),
    });
  } catch (error: unknown) {
    directUpdateDenied = error instanceof Error && /permission denied|42501/i.test(error.message);
    if (!directUpdateDenied) throw error;
  }
  if (!directUpdateDenied) throw new Error("service role directly updated coverage scopes");

  let directDeleteDenied = false;
  try {
    await client.rest("coverage_scopes?jurisdiction_code=eq.ZZ", {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
  } catch (error: unknown) {
    directDeleteDenied = error instanceof Error && /permission denied|42501/i.test(error.message);
    if (!directDeleteDenied) throw error;
  }
  if (!directDeleteDenied) throw new Error("service role directly deleted coverage scopes");

  let invalidChecklistRejected = false;
  try {
    await client.rpc("create_coverage_baseline_checklist", {
      p_checklist_id: "INVALID",
      p_jurisdiction_code: "EEA",
      p_version_label: "negative smoke",
      p_items: [{ itemId: "smoke", title: "must not persist", supportingClaimIds: ["claim:none"] }],
    });
  } catch (error: unknown) {
    invalidChecklistRejected = error instanceof Error
      && /invalid coverage checklist id/i.test(error.message);
    if (!invalidChecklistRejected) throw error;
  }
  if (!invalidChecklistRejected) throw new Error("invalid coverage checklist ID was accepted");

  console.log(JSON.stringify({
    directInsertDenied,
    directUpdateDenied,
    directDeleteDenied,
    invalidChecklistRejected,
  }));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
