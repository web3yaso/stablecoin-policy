import "../env.js";
import { randomUUID } from "node:crypto";
import { readSupabaseConfig, SupabaseHttpClient } from "../../lib/data/supabase-client.js";
import {
  RegulatoryChangeClient,
  type ChangeImpactType,
  type RegulatoryEventType,
} from "../../lib/legal-corpus/regulatory-change.js";

async function main() {
  const args = process.argv.slice(2);
  const client = new RegulatoryChangeClient(new SupabaseHttpClient(readSupabaseConfig()));
  const eventId = optionalValue(args, "--event");

  if (args.includes("--create")) {
    console.log(JSON.stringify(await client.createCandidate({
      eventId: requiredValue(args, "--event"),
      beforeVersionId: requiredValue(args, "--before"),
      afterVersionId: requiredValue(args, "--after"),
      eventType: requiredValue(args, "--event-type") as RegulatoryEventType,
      title: requiredValue(args, "--title"),
      observedAt: requiredValue(args, "--observed-at"),
      effectiveAt: optionalValue(args, "--effective-at"),
      manifestSha256: requiredValue(args, "--manifest-sha256"),
    }), null, 2));
    return;
  }
  if (args.includes("--review-event")) {
    requireHumanConfirmation(args);
    console.log(JSON.stringify(await client.reviewEvent({
      eventReviewId: optionalValue(args, "--event-review-id") ?? `event-review:${randomUUID()}`,
      eventId: requiredValue(args, "--event"),
      outcome: requiredValue(args, "--outcome") as "APPROVED" | "REJECTED",
      reviewerRole: requiredValue(args, "--reviewer-role"),
      reviewerRef: requiredValue(args, "--reviewer-ref"),
      manifestSha256: requiredValue(args, "--manifest-sha256"),
      reviewedAt: requiredValue(args, "--reviewed-at"),
      privateNotes: optionalValue(args, "--private-notes"),
      humanReviewConfirmed: true,
    }), null, 2));
    return;
  }
  if (args.includes("--review-impact")) {
    requireHumanConfirmation(args);
    console.log(JSON.stringify(await client.reviewImpact({
      impactReviewId: optionalValue(args, "--impact-review-id") ?? `impact-review:${randomUUID()}`,
      eventId: requiredValue(args, "--event"),
      claimId: requiredValue(args, "--claim"),
      outcome: requiredValue(args, "--outcome") as "REVIEWED" | "DISMISSED",
      impactType: requiredValue(args, "--impact-type") as ChangeImpactType,
      reviewerRole: requiredValue(args, "--reviewer-role"),
      reviewerRef: requiredValue(args, "--reviewer-ref"),
      manifestSha256: requiredValue(args, "--manifest-sha256"),
      reviewedAt: requiredValue(args, "--reviewed-at"),
      privateNotes: optionalValue(args, "--private-notes"),
      humanReviewConfirmed: true,
    }), null, 2));
    return;
  }
  if (args.includes("--publish")) {
    console.log(JSON.stringify(await client.publish(
      requiredValue(args, "--event"),
      requiredValue(args, "--manifest-sha256"),
      requiredValue(args, "--published-at"),
    ), null, 2));
    return;
  }
  if (eventId) {
    const envelope = await client.prepareEvent(eventId);
    console.log(JSON.stringify(args.includes("--summary") ? {
      eventId: envelope.eventId,
      eventState: envelope.eventState,
      manifestSha256: envelope.currentManifestSha256,
      readinessErrors: envelope.readinessErrors,
      impacts: envelope.impacts,
    } : envelope, null, 2));
  } else {
    const envelope = await client.prepareCandidate(
      requiredValue(args, "--before"), requiredValue(args, "--after"),
    );
    console.log(JSON.stringify(args.includes("--summary") ? {
      beforeVersionId: envelope.manifest.beforeVersionId,
      afterVersionId: envelope.manifest.afterVersionId,
      manifestSha256: envelope.manifestSha256,
      provisionChangeCount: envelope.manifest.provisionChanges.length,
      claimCandidateCount: envelope.manifest.claimCandidates.length,
      readinessErrors: envelope.readinessErrors,
      legalImpactAssessed: envelope.legalImpactAssessed,
    } : envelope, null, 2));
  }
  console.error("read-only change manifest; automated analysis cannot review impacts or publish events");
}

function requireHumanConfirmation(args: string[]) {
  if (!args.includes("--confirm-human-review")) {
    throw new Error("review requires --confirm-human-review");
  }
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
