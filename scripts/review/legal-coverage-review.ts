import "../env.js";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { readSupabaseConfig, SupabaseHttpClient } from "../../lib/data/supabase-client.js";
import { CoverageReviewClient } from "../../lib/legal-corpus/coverage-review.js";

async function main() {
  const args = process.argv.slice(2);
  const client = new CoverageReviewClient(new SupabaseHttpClient(readSupabaseConfig()));
  const jurisdictionCode = requiredValue(args, "--jurisdiction");

  if (args.includes("--create-checklist")) {
    const itemsFile = requiredValue(args, "--items-file");
    const parsed: unknown = JSON.parse(await readFile(itemsFile, "utf8"));
    if (!Array.isArray(parsed)) throw new Error("--items-file must contain a JSON array");
    console.log(JSON.stringify(await client.createChecklist({
      checklistId: requiredValue(args, "--checklist"),
      jurisdictionCode,
      versionLabel: requiredValue(args, "--version-label"),
      items: parsed,
    }), null, 2));
    return;
  }

  const common = {
    jurisdictionCode,
    checklistId: requiredValue(args, "--checklist"),
    releaseId: requiredValue(args, "--release"),
    freshnessCutoff: requiredValue(args, "--freshness-cutoff"),
    publicNote: requiredValue(args, "--public-note"),
  };
  if (!args.includes("--submit")) {
    const envelope = await client.prepare(common);
    console.log(JSON.stringify(args.includes("--summary") ? {
      jurisdictionCode: envelope.manifest.jurisdictionCode,
      manifestSha256: envelope.manifestSha256,
      readinessErrors: envelope.readinessErrors,
    } : envelope, null, 2));
    console.error("read-only coverage manifest generated; verify every checklist item and source freshness before review");
    return;
  }
  if (!args.includes("--confirm-human-review")) {
    throw new Error("--submit requires --confirm-human-review");
  }
  console.log(JSON.stringify(await client.review({
    ...common,
    coverageReviewId: optionalValue(args, "--coverage-review-id")
      ?? `coverage-review:${randomUUID()}`,
    manifestSha256: requiredValue(args, "--manifest-sha256"),
    reviewerRole: requiredValue(args, "--reviewer-role"),
    reviewerRef: requiredValue(args, "--reviewer-ref"),
    reviewedAt: requiredValue(args, "--reviewed-at"),
    privateNotes: optionalValue(args, "--private-notes"),
    humanReviewConfirmed: true,
  }), null, 2));
}

function requiredValue(args: string[], name: string): string {
  const value = optionalValue(args, name);
  if (!value) throw new Error(`${name} requires a value`);
  return value;
}
function optionalValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
