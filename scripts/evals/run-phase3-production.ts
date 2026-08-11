import "../env.js";
import { chmod, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { replayChecksum } from "../../lib/legal-corpus/machine-pipeline.js";
import { readSupabaseConfig, SupabaseHttpClient } from "../../lib/data/supabase-client.js";
import { RetrievalIndexAdminClient } from "../../lib/retrieval/index-admin.js";
import type { IndexedEvidenceChunk } from "../../lib/retrieval/contracts.js";
import {
  runProductionDraftEval,
  type ProductionEvalDataset,
} from "../../lib/retrieval/production-eval.js";
import {
  OpenAIQueryEmbeddingProvider,
  readOpenAIEmbeddingConfig,
} from "../../lib/retrieval/openai-embedding.js";

async function main() {
  const args = process.argv.slice(2);
  const indexReleaseId = readValue(args, "--index-release");
  const datasetPath = readValue(args, "--dataset");
  const outputPath = await assertPrivateOutput(readValue(args, "--output"));
  const dataset = JSON.parse(await readFile(datasetPath, "utf8")) as ProductionEvalDataset;
  const admin = new RetrievalIndexAdminClient(
    new SupabaseHttpClient(readSupabaseConfig()),
  );
  const manifest = await admin.manifest(indexReleaseId);
  if (manifest.releaseState !== "DRAFT") throw new Error("production eval requires a DRAFT index");
  const input = await admin.draftEvalInput(indexReleaseId);
  const corpusPin = await admin.draftCorpusPin(indexReleaseId);
  const chunks: IndexedEvidenceChunk[] = input.chunks.map((chunk) => ({
    ...chunk,
    embedding: parseVector(chunk.embedding),
  }));
  const report = await runProductionDraftEval(
    dataset,
    input.indexRelease,
    chunks,
    new OpenAIQueryEmbeddingProvider(readOpenAIEmbeddingConfig()),
    corpusPin.manifestSha256,
  );
  const artifact = {
    ...report,
    evaluatedAt: new Date().toISOString(),
    manifestSha256: manifest.manifestSha256,
    datasetSha256: replayChecksum(dataset),
    datasetId: dataset.datasetId,
    sourceSnapshot: dataset.sourceSnapshot,
    generation: dataset.generation,
    independentCheck: dataset.independentCheck,
  };
  await writeFile(outputPath, `${JSON.stringify(artifact)}\n`, {
    encoding: "utf8", flag: "wx", mode: 0o600,
  });
  await chmod(outputPath, 0o600);
  const artifactSha256 = replayChecksum(artifact);
  console.log(JSON.stringify({
    mode: args.includes("--record") ? "RECORD" : "EVAL_ONLY",
    outputPath,
    artifactSha256,
    manifestSha256: manifest.manifestSha256,
    metrics: report.metrics,
    passed: report.passed,
  }, null, 2));
  if (!args.includes("--record")) {
    console.log("eval artifact written; no activation or eval record was created");
    if (!report.passed) throw new Error("production DRAFT eval gates failed");
    return;
  }
  const expectedManifest = readValue(args, "--expected-manifest-sha256");
  if (expectedManifest !== manifest.manifestSha256) {
    throw new Error("expected manifest SHA-256 does not match the evaluated DRAFT");
  }
  const result = await admin.recordEval({
    evalRecordId: readValue(args, "--eval-record"),
    indexReleaseId,
    expectedManifestSha256: manifest.manifestSha256,
    evalAssurance: dataset.evalAssurance,
    outcome: report.passed ? "PASSED" : "FAILED",
    artifactSha256,
    metrics: report.metrics,
    evaluatedAt: artifact.evaluatedAt,
  });
  console.log(JSON.stringify({ evalRecordResult: result }, null, 2));
  if (!report.passed) throw new Error("production DRAFT eval gates failed");
}

async function assertPrivateOutput(value: string): Promise<string> {
  if (!path.isAbsolute(value)) throw new Error("eval artifact output must be absolute");
  const output = path.join(
    await realpath(path.dirname(path.resolve(value))),
    path.basename(value),
  );
  const relative = path.relative(await realpath(process.cwd()), output);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new Error("eval artifacts must be stored outside the repository");
  }
  return output;
}

function parseVector(value: string): number[] {
  if (!/^\[(?:-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)(?:,-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)*\]$/i.test(value)) {
    throw new Error("invalid pgvector response");
  }
  return value.slice(1, -1).split(",").map(Number);
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
