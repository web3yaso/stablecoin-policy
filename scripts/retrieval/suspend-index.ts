import "../env.js";
import { readSupabaseConfig, SupabaseHttpClient } from "../../lib/data/supabase-client.js";
import { RetrievalIndexAdminClient } from "../../lib/retrieval/index-admin.js";
import { runSuspensionCommand } from "../../lib/retrieval/suspend-command.js";

async function main() {
  const result = await runSuspensionCommand(process.argv.slice(2),
    new RetrievalIndexAdminClient(new SupabaseHttpClient(readSupabaseConfig())));
  console.log(JSON.stringify(result, null, 2));
  if (result.mode === "DRY_RUN") console.log("No writes. Execution requires the inspected index, manifest, revision, operation ID and reason.");
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
