import { chmod, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { replayChecksum } from "../legal-corpus/machine-pipeline";
import {
  retrievalIndexPlanSha256,
  type RetrievalIndexPlan,
} from "./index-builder";
import {
  BM25_LEXICAL_CONFIG_V2,
  LEGACY_LEXICAL_CONFIG_VERSIONS,
  LEGACY_VECTOR_CONFIG_VERSIONS,
  WEIGHTED_VECTOR_CONFIG_V2,
} from "./ranking-config";

export type RetrievalPlanArtifact = {
  schemaVersion: "1.0.0";
  createdAt: string;
  inputManifestSha256: string;
  planSha256: string;
  plan: RetrievalIndexPlan;
};

const SHA256 = /^[0-9a-f]{64}$/;
const IDENTIFIER = /^[a-z0-9][a-z0-9._:-]{2,200}$/;

export function deriveRetrievalRankingV2Plan(
  source: RetrievalPlanArtifact,
  indexReleaseId: string,
): RetrievalIndexPlan {
  if (!IDENTIFIER.test(indexReleaseId) || indexReleaseId === source.plan.indexReleaseId) {
    throw new Error("derived retrieval index identifier is invalid or unchanged");
  }
  const lexicalVersion = String(source.plan.lexicalConfig.version ?? "");
  const vectorVersion = String(source.plan.vectorConfig.version ?? "");
  if (!LEGACY_LEXICAL_CONFIG_VERSIONS.has(lexicalVersion)
    || !LEGACY_VECTOR_CONFIG_VERSIONS.has(vectorVersion)) {
    throw new Error("ranking v2 can only be derived from an inspected v1 plan");
  }
  return {
    ...structuredClone(source.plan),
    indexReleaseId,
    lexicalConfig: BM25_LEXICAL_CONFIG_V2,
    vectorConfig: WEIGHTED_VECTOR_CONFIG_V2,
  };
}

export async function writeRetrievalPlanArtifact(
  outputPath: string,
  inputManifestSha256: string,
  plan: RetrievalIndexPlan,
  createdAt = new Date().toISOString(),
): Promise<RetrievalPlanArtifact> {
  const absolutePath = await assertPrivateArtifactPath(outputPath);
  if (!SHA256.test(inputManifestSha256)) {
    throw new Error("input manifest SHA-256 is invalid");
  }
  if (!Number.isFinite(Date.parse(createdAt))) {
    throw new Error("artifact creation timestamp is invalid");
  }
  const artifact: RetrievalPlanArtifact = {
    schemaVersion: "1.0.0",
    createdAt: new Date(createdAt).toISOString(),
    inputManifestSha256,
    planSha256: retrievalIndexPlanSha256(plan),
    plan,
  };
  await writeFile(absolutePath, `${JSON.stringify(artifact)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  await chmod(absolutePath, 0o600);
  return artifact;
}

export async function readRetrievalPlanArtifact(
  inputPath: string,
): Promise<RetrievalPlanArtifact> {
  const absolutePath = path.resolve(inputPath);
  const metadata = await stat(absolutePath);
  if (!metadata.isFile()) throw new Error("retrieval plan artifact is not a file");
  if ((metadata.mode & 0o077) !== 0) {
    throw new Error("retrieval plan artifact must have mode 0600");
  }
  const value = JSON.parse(await readFile(absolutePath, "utf8")) as unknown;
  assertArtifact(value);
  if (retrievalIndexPlanSha256(value.plan) !== value.planSha256) {
    throw new Error("retrieval plan artifact checksum does not match its plan");
  }
  return value;
}

export function retrievalPlanArtifactSha256(artifact: RetrievalPlanArtifact): string {
  return replayChecksum(artifact);
}

async function assertPrivateArtifactPath(inputPath: string): Promise<string> {
  if (!path.isAbsolute(inputPath)) {
    throw new Error("retrieval plan artifact path must be absolute");
  }
  const absolutePath = path.join(
    await realpath(path.dirname(path.resolve(inputPath))),
    path.basename(inputPath),
  );
  const repositoryRoot = await realpath(process.cwd());
  const relative = path.relative(repositoryRoot, absolutePath);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new Error("retrieval plan artifacts must be stored outside the repository");
  }
  return absolutePath;
}

function assertArtifact(value: unknown): asserts value is RetrievalPlanArtifact {
  if (typeof value !== "object" || value === null) {
    throw new Error("retrieval plan artifact must be an object");
  }
  const artifact = value as Partial<RetrievalPlanArtifact>;
  if (
    artifact.schemaVersion !== "1.0.0" ||
    typeof artifact.createdAt !== "string" ||
    !Number.isFinite(Date.parse(artifact.createdAt)) ||
    typeof artifact.inputManifestSha256 !== "string" ||
    !SHA256.test(artifact.inputManifestSha256) ||
    typeof artifact.planSha256 !== "string" ||
    !SHA256.test(artifact.planSha256) ||
    typeof artifact.plan !== "object" ||
    artifact.plan === null ||
    artifact.plan.schemaVersion !== "1.0.0" ||
    !Array.isArray(artifact.plan.chunks)
  ) {
    throw new Error("retrieval plan artifact shape is invalid");
  }
}
