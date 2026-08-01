import "../env.js";
import { randomUUID } from "node:crypto";
import { readSupabaseConfig, SupabaseHttpClient } from "../../lib/data/supabase-client.js";
import {
  ClaimReviewClient,
  type ClaimReviewOutcome,
} from "../../lib/legal-corpus/claim-review.js";

async function main() {
  const args = process.argv.slice(2);
  const claimId = requiredValue(args, "--claim");
  const reviewer = new ClaimReviewClient(
    new SupabaseHttpClient(readSupabaseConfig()),
  );

  if (args.includes("--submit-for-review")) {
    console.log(JSON.stringify(await reviewer.submitForReview(claimId), null, 2));
    return;
  }

  if (!args.includes("--submit")) {
    const envelope = await reviewer.prepare(claimId);
    if (args.includes("--summary")) {
      console.log(JSON.stringify({
        claimId: envelope.manifest.claimId,
        reviewState: envelope.reviewState,
        manifestSha256: envelope.manifestSha256,
        citationCount: envelope.manifest.citations.length,
        readinessErrors: envelope.readinessErrors,
      }, null, 2));
    } else {
      console.log(JSON.stringify(envelope, null, 2));
    }
    console.error(
      "read-only claim review manifest generated; inspect the proposition and every citation before using --submit",
    );
    return;
  }

  if (!args.includes("--confirm-human-review")) {
    throw new Error("--submit requires --confirm-human-review");
  }
  const result = await reviewer.review({
    reviewId: optionalValue(args, "--review-id") ?? `review:${randomUUID()}`,
    claimId,
    outcome: requiredValue(args, "--outcome") as ClaimReviewOutcome,
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
