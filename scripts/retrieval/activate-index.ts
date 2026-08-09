import "../env.js";
import {
  readSupabaseConfig,
  SupabaseHttpClient,
} from "../../lib/data/supabase-client.js";
import { RetrievalIndexAdminClient } from "../../lib/retrieval/index-admin.js";

/**
 * Prints the exact server-side manifest by default. Activation requires both
 * --execute and the previously inspected --expected-manifest-sha256 value.
 */

async function main() {
  const args = process.argv.slice(2);
  const indexReleaseId = readValue(args, "--index-release");
  const execute = args.includes("--execute");
  const expected = readOptionalValue(args, "--expected-manifest-sha256");
  const admin = new RetrievalIndexAdminClient(
    new SupabaseHttpClient(readSupabaseConfig()),
  );
  const envelope = await admin.manifest(indexReleaseId);
  console.log(JSON.stringify({ mode: execute ? "EXECUTE" : "DRY_RUN", ...envelope }, null, 2));

  if (!execute) {
    console.log(
      `dry-run: inspect the exact manifest, then repeat with --execute --expected-manifest-sha256 ${envelope.manifestSha256}`,
    );
    return;
  }
  if (expected === null) {
    throw new Error("--execute requires --expected-manifest-sha256 from a prior dry-run");
  }
  if (expected !== envelope.manifestSha256) {
    throw new Error("expected manifest SHA-256 does not match the current server manifest");
  }
  if (envelope.releaseState !== "DRAFT") {
    throw new Error("only a DRAFT retrieval index can be activated");
  }
  const result = await admin.activate(indexReleaseId, expected, new Date().toISOString());
  console.log(JSON.stringify({ activationResult: result }, null, 2));
}

function readValue(args: string[], name: string): string {
  const value = readOptionalValue(args, name);
  if (value === null) throw new Error(`${name} is required`);
  return value;
}

function readOptionalValue(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  if (index < 0) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
