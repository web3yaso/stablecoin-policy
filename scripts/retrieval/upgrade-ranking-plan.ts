import { replayChecksum } from "../../lib/legal-corpus/machine-pipeline.js";
import { retrievalIndexPlanSha256 } from "../../lib/retrieval/index-builder.js";
import {
  deriveRetrievalRankingV2Plan,
  readRetrievalPlanArtifact,
  retrievalPlanArtifactSha256,
  writeRetrievalPlanArtifact,
} from "../../lib/retrieval/plan-artifact.js";

async function main() {
  const args = process.argv.slice(2);
  const source = await readRetrievalPlanArtifact(readValue(args, "--plan"));
  const sourceArtifactSha256 = retrievalPlanArtifactSha256(source);
  if (sourceArtifactSha256 !== readValue(args, "--expected-source-artifact-sha256")) {
    throw new Error("expected source artifact SHA-256 does not match the private plan");
  }
  const plan = deriveRetrievalRankingV2Plan(
    source, readValue(args, "--index-release"),
  );
  const planSha256 = retrievalIndexPlanSha256(plan);
  const embeddingSetSha256 = replayChecksum(plan.chunks.map((chunk) => ({
    chunkId: chunk.chunkId,
    embeddingId: chunk.embeddingId,
    embeddingChecksumSha256: chunk.embeddingChecksumSha256,
  })));
  const execute = args.includes("--execute");
  console.log(JSON.stringify({
    mode: execute ? "EXECUTE" : "DRY_RUN",
    sourceArtifactSha256,
    sourcePlanSha256: source.planSha256,
    derivedPlanSha256: planSha256,
    inputManifestSha256: source.inputManifestSha256,
    indexReleaseId: plan.indexReleaseId,
    corpusReleaseId: plan.corpusReleaseId,
    lexicalConfig: plan.lexicalConfig,
    vectorConfig: plan.vectorConfig,
    embeddingReuseCount: plan.chunks.length,
    embeddingSetSha256,
    embeddingProviderCalled: false,
  }, null, 2));
  if (!execute) {
    console.log("dry-run: no file was written and no embedding provider was called");
    return;
  }
  if (readValue(args, "--expected-plan-sha256") !== planSha256) {
    throw new Error("expected derived plan SHA-256 does not match");
  }
  const artifact = await writeRetrievalPlanArtifact(
    readValue(args, "--output"), source.inputManifestSha256, plan,
  );
  console.log(JSON.stringify({
    outputArtifactSha256: retrievalPlanArtifactSha256(artifact),
    outputPlanSha256: artifact.planSha256,
  }, null, 2));
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
