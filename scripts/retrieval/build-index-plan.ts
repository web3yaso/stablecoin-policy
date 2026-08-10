import "../env.js";
import { readSupabaseConfig, SupabaseHttpClient } from "../../lib/data/supabase-client.js";
import { RetrievalIndexAdminClient } from "../../lib/retrieval/index-admin.js";
import {
  readRetrievalPlanArtifact,
  retrievalPlanArtifactSha256,
} from "../../lib/retrieval/plan-artifact.js";

async function main() {
  const args = process.argv.slice(2);
  const artifact = await readRetrievalPlanArtifact(readValue(args, "--plan"));
  const artifactSha256 = retrievalPlanArtifactSha256(artifact);
  const execute = args.includes("--execute");
  console.log(JSON.stringify({
    mode: execute ? "EXECUTE" : "DRY_RUN",
    artifactSha256,
    planSha256: artifact.planSha256,
    inputManifestSha256: artifact.inputManifestSha256,
    indexReleaseId: artifact.plan.indexReleaseId,
    corpusReleaseId: artifact.plan.corpusReleaseId,
    chunkCount: artifact.plan.chunks.length,
    embeddingModel: artifact.plan.embeddingModel,
    embeddingModelVersion: artifact.plan.embeddingModelVersion,
    embeddingDimensions: artifact.plan.embeddingDimensions,
  }, null, 2));
  if (!execute) {
    console.log("dry-run: no database write; pass --execute with --expected-plan-sha256");
    return;
  }
  const expectedPlanSha256 = readValue(args, "--expected-plan-sha256");
  if (expectedPlanSha256 !== artifact.planSha256) {
    throw new Error("expected plan SHA-256 does not match the private artifact");
  }
  const admin = new RetrievalIndexAdminClient(
    new SupabaseHttpClient(readSupabaseConfig()),
  );
  const result = await admin.build(artifact.plan);
  console.log(JSON.stringify({ buildResult: result }, null, 2));
  console.log("draft only: activation remains blocked until an exact-manifest eval passes");
}

function readValue(args: string[], name: string): string {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (!value || value.startsWith("--")) throw new Error(`${name} is required`);
  return value;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
