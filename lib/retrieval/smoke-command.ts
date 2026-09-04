import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { replayChecksum } from "../legal-corpus/machine-pipeline";
import { evidenceSmokeOrigin, parseEvidenceSmokeCase, runCitelyEvidenceSmoke } from "./citely-smoke";

export async function readEvidenceSmokeCaseFile(inputPath: string) {
  if (!path.isAbsolute(inputPath)) throw new Error("smoke case path must be absolute");
  let raw: unknown;
  try {
    const resolved = await realpath(inputPath);
    const relative = path.relative(await realpath(process.cwd()), resolved);
    if (relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))) {
      throw new Error("repository path");
    }
    const metadata = await stat(resolved);
    if (!metadata.isFile() || (metadata.mode & 0o777) !== 0o600 || metadata.size > 2_000_000) {
      throw new Error("file policy");
    }
    raw = JSON.parse(await readFile(resolved, "utf8"));
  } catch { throw new Error("smoke case must be a readable mode-0600 JSON file outside the repository, at most 2 MB"); }
  return parseEvidenceSmokeCase(raw);
}

export async function runEvidenceSmokeCommand(
  args: string[],
  env: Record<string, string | undefined>,
  run = runCitelyEvidenceSmoke,
) {
  if (args.length > 1 || (args.length === 1 && args[0] !== "--execute")) {
    throw new Error("only optional --execute is supported");
  }
  const required = (name: string) => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`${name} is required`);
    return value;
  };
  const baseUrl = evidenceSmokeOrigin(required("CITELY_SMOKE_BASE_URL")).origin;
  const smokeCase = await readEvidenceSmokeCaseFile(required("CITELY_RAG_SMOKE_CASE_PATH"));
  if (args.length === 0) return {
    mode: "DRY_RUN", baseUrl, expectedMode: smokeCase.mode,
    caseSha256: replayChecksum(smokeCase), requestsSent: 0,
    message: "No requests. Execution may incur embedding charges and write retrieval audits; run only in the Citely secret boundary.",
  };
  return run({ baseUrl, smokeCase, keyId: required("CITELY_SERVICE_SIGNING_KEY_ID"),
    privateKeyPem: required("CITELY_SERVICE_PRIVATE_KEY_PEM") });
}
