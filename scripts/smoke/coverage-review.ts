import "../env.js";
import { readSupabaseConfig, SupabaseHttpClient } from "../../lib/data/supabase-client.js";

async function main() {
  const client = new SupabaseHttpClient(readSupabaseConfig());
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

  console.log(JSON.stringify({ directUpdateDenied, invalidChecklistRejected }));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
