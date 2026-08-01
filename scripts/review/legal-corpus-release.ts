import "../env.js";
import { randomUUID } from "node:crypto";
import { readSupabaseConfig, SupabaseHttpClient } from "../../lib/data/supabase-client.js";
import { CorpusReleaseClient, type CorpusReleaseReviewOutcome } from "../../lib/legal-corpus/corpus-release.js";

async function main() {
  const args = process.argv.slice(2);
  const releaseId = requiredValue(args, "--release");
  const client = new CorpusReleaseClient(new SupabaseHttpClient(readSupabaseConfig()));
  if (args.includes("--create")) {
    console.log(JSON.stringify(await client.create(
      releaseId,
      requiredValue(args, "--as-of"),
      requiredValue(args, "--knowledge-cutoff"),
    ), null, 2));
    return;
  }
  if (args.includes("--submit-for-review")) {
    console.log(JSON.stringify(await client.submitForReview(releaseId), null, 2));
    return;
  }
  if (args.includes("--publish")) {
    console.log(JSON.stringify(await client.publish(
      releaseId,
      requiredValue(args, "--manifest-sha256"),
      requiredValue(args, "--published-at"),
    ), null, 2));
    return;
  }
  if (!args.includes("--submit")) {
    const envelope = await client.prepare(releaseId);
    console.log(JSON.stringify(args.includes("--summary") ? {
      releaseId: envelope.manifest.releaseId,
      releaseState: envelope.releaseState,
      manifestSha256: envelope.manifestSha256,
      claimCount: envelope.manifest.claims.length,
      readinessErrors: envelope.readinessErrors,
    } : envelope, null, 2));
    console.error("read-only corpus manifest generated; inspect every claim before review or publication");
    return;
  }
  if (!args.includes("--confirm-human-review")) {
    throw new Error("--submit requires --confirm-human-review");
  }
  console.log(JSON.stringify(await client.review({
    releaseReviewId: optionalValue(args, "--release-review-id") ?? `release-review:${randomUUID()}`,
    releaseId,
    outcome: requiredValue(args, "--outcome") as CorpusReleaseReviewOutcome,
    reviewerRole: requiredValue(args, "--reviewer-role"),
    reviewerRef: requiredValue(args, "--reviewer-ref"),
    manifestSha256: requiredValue(args, "--manifest-sha256"),
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
