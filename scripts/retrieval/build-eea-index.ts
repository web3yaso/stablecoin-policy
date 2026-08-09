import "../env.js";
import {
  readSupabaseConfig,
  SupabaseHttpClient,
} from "../../lib/data/supabase-client.js";
import {
  buildRetrievalIndexPlan,
  previewRetrievalIndexManifest,
  retrievalIndexPlanSha256,
  type RetrievalCorpusKind,
} from "../../lib/retrieval/index-builder.js";
import { RetrievalIndexAdminClient } from "../../lib/retrieval/index-admin.js";
import {
  OpenAIQueryEmbeddingProvider,
  readOpenAIEmbeddingConfig,
} from "../../lib/retrieval/openai-embedding.js";

/**
 * Builds one provision-aligned Evidence RAG chunk per citation.
 *
 * DRY-RUN BY DEFAULT: reads the pinned release, creates embeddings and prints
 * the reproducible plan/manifest preview, but writes no database state.
 * --execute calls the single transactional build RPC and still never activates
 * the resulting DRAFT index.
 */

async function main() {
  const args = process.argv.slice(2);
  const corpusReleaseId = readValue(args, "--release");
  const indexReleaseId = readValue(args, "--index-release");
  const freshThrough = readValue(args, "--fresh-through");
  const jurisdictionCode = readValue(args, "--jurisdiction", "EEA");
  const corpusReleaseKind = readKind(args);
  const execute = args.includes("--execute");

  const client = new SupabaseHttpClient(readSupabaseConfig());
  const admin = new RetrievalIndexAdminClient(client);
  const input = await admin.buildInput(
    "stablecoin",
    corpusReleaseId,
    corpusReleaseKind,
  );
  const embeddingProvider = new OpenAIQueryEmbeddingProvider(
    readOpenAIEmbeddingConfig(),
  );
  const plan = await buildRetrievalIndexPlan(
    input,
    {
      indexReleaseId,
      policyDomain: "stablecoin",
      expectedJurisdictionCode: jurisdictionCode,
      freshThrough,
      lexicalConfig: { language: "english", version: "1" },
      vectorConfig: {
        distance: "cosine",
        fusion: "rrf",
        rrfK: 60,
        version: "1",
      },
    },
    embeddingProvider,
  );
  const summary = {
    mode: execute ? "EXECUTE" : "DRY_RUN",
    planSha256: retrievalIndexPlanSha256(plan),
    chunkCount: plan.chunks.length,
    embeddingModel: plan.embeddingModel,
    embeddingModelVersion: plan.embeddingModelVersion,
    embeddingDimensions: plan.embeddingDimensions,
    manifestPreview: previewRetrievalIndexManifest(input, plan),
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!execute) {
    console.log("dry-run: no index was created; pass --execute to create a DRAFT index");
    return;
  }

  const result = await admin.build(plan);
  console.log(JSON.stringify({ buildResult: result }, null, 2));
  console.log(
    `draft only: inspect the server manifest, then run npm run rag:index:activate -- --index-release ${indexReleaseId}`,
  );
}

function readKind(args: string[]): RetrievalCorpusKind {
  const kind = readValue(args, "--kind", "PROVISIONAL");
  if (kind !== "PROVISIONAL" && kind !== "HUMAN_REVIEWED") {
    throw new Error("--kind must be PROVISIONAL or HUMAN_REVIEWED");
  }
  return kind;
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
