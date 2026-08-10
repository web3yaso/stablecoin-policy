import "../env.js";
import { readSupabaseConfig, SupabaseHttpClient } from "../../lib/data/supabase-client.js";
import { RetrievalIndexAdminClient } from "../../lib/retrieval/index-admin.js";
import type { RetrievalCorpusKind } from "../../lib/retrieval/index-builder.js";

async function main() {
  const args = process.argv.slice(2);
  const snapshotId = readValue(args, "--snapshot");
  const sourceReleaseIds = readMany(args, "--release");
  const kind = readKind(args);
  const execute = args.includes("--execute");
  const admin = new RetrievalIndexAdminClient(
    new SupabaseHttpClient(readSupabaseConfig()),
  );
  const prepared = await admin.prepareSnapshot(
    snapshotId, "stablecoin", kind, sourceReleaseIds,
  );
  console.log(JSON.stringify({ mode: execute ? "EXECUTE" : "DRY_RUN", ...prepared }, null, 2));
  if (!execute) {
    console.log("dry-run: pass --execute with --expected-manifest-sha256 to create the immutable snapshot");
    return;
  }
  const expected = readValue(args, "--expected-manifest-sha256");
  if (expected !== prepared.manifestSha256) {
    throw new Error("prepared snapshot changed or expected manifest SHA-256 is stale");
  }
  const result = await admin.createSnapshot(
    snapshotId, "stablecoin", kind, sourceReleaseIds, expected,
  );
  console.log(JSON.stringify({ snapshotResult: result }, null, 2));
}

function readKind(args: string[]): RetrievalCorpusKind {
  const kind = readValue(args, "--kind", "PROVISIONAL");
  if (kind !== "PROVISIONAL" && kind !== "HUMAN_REVIEWED") {
    throw new Error("--kind must be PROVISIONAL or HUMAN_REVIEWED");
  }
  return kind;
}

function readMany(args: string[], name: string): string[] {
  const values = args.flatMap((arg, index) => arg === name ? [args[index + 1]] : [])
    .filter((value): value is string => Boolean(value && !value.startsWith("--")));
  if (values.length === 0) throw new Error(`${name} is required at least once`);
  return values;
}

function readValue(args: string[], name: string, fallback?: string): string {
  const index = args.indexOf(name);
  if (index >= 0) {
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
    return value;
  }
  if (fallback !== undefined) return fallback;
  throw new Error(`${name} is required`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
