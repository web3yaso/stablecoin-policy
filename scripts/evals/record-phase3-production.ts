import "../env.js";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { readSupabaseConfig, SupabaseHttpClient } from "../../lib/data/supabase-client.js";
import { inspectProductionEvalArtifact } from "../../lib/retrieval/eval-artifact.js";
import { RetrievalIndexAdminClient } from "../../lib/retrieval/index-admin.js";
import type { ProductionEvalDataset } from "../../lib/retrieval/production-eval.js";

async function main() {
  const args = process.argv.slice(2);
  const indexReleaseId = readValue(args, "--index-release");
  const artifactPath = await assertPrivateInput(readValue(args, "--artifact"), "eval artifact");
  const datasetPath = await assertPrivateInput(readValue(args, "--dataset"), "eval dataset");
  const artifactValue: unknown = JSON.parse(await readFile(artifactPath, "utf8"));
  const dataset = JSON.parse(await readFile(datasetPath, "utf8")) as ProductionEvalDataset;
  const admin = new RetrievalIndexAdminClient(
    new SupabaseHttpClient(readSupabaseConfig()),
  );
  const manifest = await admin.manifest(indexReleaseId);
  if (manifest.releaseState !== "DRAFT") {
    throw new Error("only a DRAFT index can receive a production eval record");
  }
  const input = await admin.draftEvalInput(indexReleaseId);
  const corpusPin = await admin.draftCorpusPin(indexReleaseId);
  if (corpusPin.corpusReleaseId !== dataset.sourceSnapshot.snapshotId
    || corpusPin.manifestSha256 !== dataset.sourceSnapshot.manifestSha256) {
    throw new Error("production eval dataset does not match the current DRAFT corpus pin");
  }
  const inspected = inspectProductionEvalArtifact(
    artifactValue,
    dataset,
    input.indexRelease,
    manifest.manifestSha256,
  );
  const preview = {
    mode: args.includes("--execute") ? "RECORD" : "PREVIEW",
    indexReleaseId,
    evalRecordId: readOptionalValue(args, "--eval-record"),
    artifactSha256: inspected.artifactSha256,
    manifestSha256: manifest.manifestSha256,
    datasetSha256: inspected.artifact.datasetSha256,
    outcome: inspected.artifact.passed ? "PASSED" : "FAILED",
    metrics: inspected.artifact.metrics,
  };
  console.log(JSON.stringify(preview, null, 2));
  if (!args.includes("--execute")) {
    console.log("preview only; no eval record or activation was created");
    return;
  }
  requirePin(args, "--expected-artifact-sha256", inspected.artifactSha256, "artifact");
  requirePin(args, "--expected-manifest-sha256", manifest.manifestSha256, "manifest");
  const result = await admin.recordEval({
    evalRecordId: readValue(args, "--eval-record"),
    indexReleaseId,
    expectedManifestSha256: manifest.manifestSha256,
    evalAssurance: inspected.artifact.evalAssurance,
    outcome: inspected.artifact.passed ? "PASSED" : "FAILED",
    artifactSha256: inspected.artifactSha256,
    metrics: inspected.artifact.metrics,
    evaluatedAt: inspected.artifact.evaluatedAt,
  });
  console.log(JSON.stringify({ evalRecordResult: result }, null, 2));
  console.log("immutable eval record created; index activation was not attempted");
}

async function assertPrivateInput(value: string, label: string): Promise<string> {
  if (!path.isAbsolute(value)) throw new Error(`${label} path must be absolute`);
  const resolved = await realpath(value);
  const relative = path.relative(await realpath(process.cwd()), resolved);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new Error(`${label} must be stored outside the repository`);
  }
  const metadata = await stat(resolved);
  if (!metadata.isFile() || (metadata.mode & 0o777) !== 0o600) {
    throw new Error(`${label} must be a mode-0600 regular file`);
  }
  return resolved;
}

function requirePin(args: string[], name: string, actual: string, label: string): void {
  if (readValue(args, name) !== actual) {
    throw new Error(`expected ${label} SHA-256 does not match the inspected artifact`);
  }
}

function readOptionalValue(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : null;
}

function readValue(args: string[], name: string): string {
  const value = readOptionalValue(args, name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
