import "../env.js";
import { randomUUID } from "node:crypto";
import { readSupabaseConfig, SupabaseHttpClient } from "../../lib/data/supabase-client.js";
import {
  SourceVerificationClient,
  type SourceVerificationMethod,
  type SourceVerificationOutcome,
} from "../../lib/legal-corpus/verification.js";

async function main() {
  const args = process.argv.slice(2);
  const versionId = requiredValue(args, "--source-version");
  const verifier = new SourceVerificationClient(
    new SupabaseHttpClient(readSupabaseConfig()),
  );

  if (!args.includes("--submit")) {
    const envelope = await verifier.prepare(versionId);
    console.log(JSON.stringify(envelope, null, 2));
    console.error(
      "read-only manifest generated; inspect the official artifact and locators before using --submit",
    );
    return;
  }

  if (!args.includes("--confirm-human-review")) {
    throw new Error("--submit requires --confirm-human-review");
  }
  const outcome = requiredValue(args, "--outcome") as SourceVerificationOutcome;
  const verificationMethod = requiredValue(
    args,
    "--verification-method",
  ) as SourceVerificationMethod;
  const result = await verifier.submit({
    verificationId: optionalValue(args, "--verification-id") ?? `verification:${randomUUID()}`,
    versionId,
    outcome,
    verificationMethod,
    reviewerRole: requiredValue(args, "--reviewer-role"),
    reviewerRef: requiredValue(args, "--reviewer-ref"),
    manifestSha256: requiredValue(args, "--manifest-sha256"),
    reviewedAt: requiredValue(args, "--reviewed-at"),
    privateNotes: optionalValue(args, "--private-notes"),
    humanReviewConfirmed: true,
  });
  console.log(JSON.stringify(result, null, 2));
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
