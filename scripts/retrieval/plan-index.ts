import "../env.js";
import { readSupabaseConfig, SupabaseHttpClient } from "../../lib/data/supabase-client.js";
import { RetrievalIndexAdminClient } from "../../lib/retrieval/index-admin.js";
import {
  buildRetrievalIndexPlan,
  previewRetrievalIndexManifest,
} from "../../lib/retrieval/index-builder.js";
import {
  retrievalPlanArtifactSha256,
  writeRetrievalPlanArtifact,
} from "../../lib/retrieval/plan-artifact.js";
import {
  OpenAIQueryEmbeddingProvider,
  readOpenAIEmbeddingConfig,
} from "../../lib/retrieval/openai-embedding.js";
import {
  BM25_LEXICAL_CONFIG_V2,
  WEIGHTED_VECTOR_CONFIG_V2,
} from "../../lib/retrieval/ranking-config.js";

async function main() {
  const args = process.argv.slice(2);
  const snapshotId = readValue(args, "--snapshot");
  const indexReleaseId = readValue(args, "--index-release");
  const freshThrough = readValue(args, "--fresh-through");
  const output = readValue(args, "--output");
  const jurisdictionCode = readValue(args, "--jurisdiction", "EEA");
  const admin = new RetrievalIndexAdminClient(
    new SupabaseHttpClient(readSupabaseConfig()),
  );
  const input = await admin.snapshotBuildInput(snapshotId);
  const plan = await buildRetrievalIndexPlan(
    input,
    {
      indexReleaseId,
      policyDomain: "stablecoin",
      expectedJurisdictionCode: jurisdictionCode,
      freshThrough,
      lexicalConfig: BM25_LEXICAL_CONFIG_V2,
      vectorConfig: WEIGHTED_VECTOR_CONFIG_V2,
    },
    new OpenAIQueryEmbeddingProvider(readOpenAIEmbeddingConfig()),
  );
  const artifact = await writeRetrievalPlanArtifact(
    output, input.releaseManifestSha256, plan,
  );
  console.log(JSON.stringify({
    mode: "PLAN_ONLY",
    artifactPath: output,
    artifactSha256: retrievalPlanArtifactSha256(artifact),
    planSha256: artifact.planSha256,
    chunkCount: plan.chunks.length,
    manifestPreview: previewRetrievalIndexManifest(input, plan),
  }, null, 2));
  console.log("private plan written once with mode 0600; use rag:index:build for exact replay");
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
