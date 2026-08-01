import "../env.js";

import { SupabaseHttpClient, readSupabaseConfig } from "../../lib/data/supabase-client.js";

type RestoreKind = "dataset" | "report";

async function main() {
  const kind = readArgument("--kind") as RestoreKind | null;
  const id = readArgument("--id");
  const releaseId = readArgument("--release");
  const apply = process.argv.includes("--apply");
  if ((kind !== "dataset" && kind !== "report") || !id || !releaseId) {
    throw new Error(
      "usage: --kind dataset|report --id <dataset-id|report-slug> --release <release-id> [--apply]",
    );
  }

  const client = new SupabaseHttpClient(readSupabaseConfig());
  const view = kind === "dataset" ? "dataset_release_catalog" : "report_release_catalog";
  const idColumn = kind === "dataset" ? "dataset_id" : "slug";
  const query = new URLSearchParams({
    select: "*",
    [idColumn]: `eq.${id}`,
    release_id: `eq.${releaseId}`,
    limit: "1",
  });
  const rows = await client.rest<unknown>(`${view}?${query}`);
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new Error(`release not found: ${kind} ${id}@${releaseId}`);
  }

  console.log(`verified restore target ${kind} ${id}@${releaseId}`);
  if (!apply) {
    console.log("dry-run only; add --apply to move the active release pointer");
    return;
  }

  const functionName =
    kind === "dataset" ? "activate_dataset_release" : "activate_report_release";
  const payload =
    kind === "dataset"
      ? { p_dataset_id: id, p_release_id: releaseId }
      : { p_slug: id, p_release_id: releaseId };
  await client.rpc<string>(functionName, payload);
  console.log(`activated ${kind} ${id}@${releaseId}`);
}

function readArgument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
