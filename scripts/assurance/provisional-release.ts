import "../env.js";
import {
  readSupabaseConfig,
  SupabaseHttpClient,
} from "../../lib/data/supabase-client.js";
import { MachineAssuranceClient } from "../../lib/legal-corpus/machine-assurance.js";
import {
  ProvisionalReleaseClient,
  provisionalReleaseInputErrors,
} from "../../lib/legal-corpus/provisional-release.js";

/**
 * Publishes AI_CROSS_CHECKED claims as a provisional corpus release.
 *
 * DRY-RUN BY DEFAULT: without --execute this validates the membership,
 * prints each claim's machine-assurance chain summary, and writes nothing.
 * The service RPC independently re-verifies every gate on --execute.
 */

async function main() {
  const args = process.argv.slice(2);
  const releaseId = readValue(args, "--release");
  const jurisdiction = readValue(args, "--jurisdiction");
  const asOf = readValue(args, "--as-of");
  const knowledgeCutoff = readValue(args, "--knowledge-cutoff");
  const claimIds = args
    .filter((_, index) => args[index - 1] === "--claim")
    .filter(Boolean);
  const execute = args.includes("--execute");

  const input = {
    releaseId,
    jurisdictionCode: jurisdiction,
    asOf,
    knowledgeCutoff,
    claimIds,
  };
  const errors = provisionalReleaseInputErrors(input);
  if (errors.length > 0) {
    throw new Error(`provisional release input invalid: ${errors.join(", ")}`);
  }

  const client = new SupabaseHttpClient(readSupabaseConfig());
  const assurance = new MachineAssuranceClient(client);
  const chains = await Promise.all(
    claimIds.map(async (claimId) => {
      const chain = await assurance.chain("CLAIM_DRAFT", claimId);
      const latest = chain.at(-1);
      return {
        claimId,
        records: chain.length,
        latestLevel: latest?.assuranceLevel ?? null,
        latestOutcome: latest?.outcome ?? null,
        blockers: latest?.blockers ?? [],
      };
    }),
  );
  console.log(
    JSON.stringify(
      { ...input, chains, mode: execute ? "EXECUTE" : "DRY_RUN" },
      null,
      2,
    ),
  );
  if (!execute) {
    console.log("dry-run: nothing was published; pass --execute to publish");
    return;
  }

  const result = await new ProvisionalReleaseClient(client).publish(input);
  console.log(JSON.stringify(result, null, 2));
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
