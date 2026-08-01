import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

type DataPolicy = {
  policyVersion: string;
  defaultMaxTrackedBytes: number;
  legacyFileMaxBytes: Record<string, number>;
  generatedPaths: string[];
  maxGeneratedPatchBytes: number;
  largeDeletionRemainingRatio: number;
  cutoverProtectedPaths: string[];
};

const ROOT = process.cwd();
const policy = JSON.parse(
  readFileSync(path.join(ROOT, "config", "repository-data-policy.json"), "utf8"),
) as DataPolicy;

function main() {
  const failures: string[] = [];
  const tracked = git(["ls-files", "-z"])
    .split("\0")
    .filter(Boolean);

  for (const relativePath of tracked) {
    const filePath = path.join(ROOT, relativePath);
    let byteSize: number;
    try {
      byteSize = statSync(filePath).size;
    } catch {
      continue;
    }
    const limit =
      policy.legacyFileMaxBytes[relativePath] ?? policy.defaultMaxTrackedBytes;
    if (byteSize > limit) {
      failures.push(`${relativePath} is ${byteSize} bytes; limit is ${limit}`);
    }
  }

  const base = process.env.DATA_DIFF_BASE?.trim() || "HEAD^";
  const changed = changedFiles(base);
  const generatedChanges = changed.filter((file) =>
    policy.generatedPaths.some((prefix) => matchesPath(file, prefix)),
  );
  const patchLimitedChanges = generatedChanges.filter(
    (file) => !isIntentionalLargeDeletion(base, file),
  );
  if (patchLimitedChanges.length > 0) {
    const patchBytes = Buffer.byteLength(
      git([
        "diff",
        "--binary",
        "--no-ext-diff",
        `${base}...HEAD`,
        "--",
        ...patchLimitedChanges,
      ]),
    ) + Buffer.byteLength(
      git(["diff", "--binary", "--no-ext-diff", "HEAD", "--", ...patchLimitedChanges]),
    );
    if (patchBytes > policy.maxGeneratedPatchBytes) {
      failures.push(
        `generated-data patch is ${patchBytes} bytes; limit is ${policy.maxGeneratedPatchBytes}`,
      );
    }
  }

  if (process.env.POLICY_STORAGE_CUTOVER === "1") {
    const protectedChanges = changed.filter((file) =>
      policy.cutoverProtectedPaths.some((prefix) => matchesPath(file, prefix)),
    );
    if (protectedChanges.length > 0) {
      failures.push(
        `storage cutover forbids Git updates to: ${protectedChanges.join(", ")}`,
      );
    }
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(`data-policy: ${failure}`);
    throw new Error(`${failures.length} repository data policy check(s) failed`);
  }

  console.log(
    `data-policy ${policy.policyVersion} passed: ${tracked.length} tracked files, ` +
      `${generatedChanges.length} generated path change(s)`,
  );
}

function isIntentionalLargeDeletion(base: string, file: string): boolean {
  const currentBytes = fileSize(path.join(ROOT, file));
  const baseBytes = gitFileSize(base, file);
  return (
    baseBytes > 0 &&
    currentBytes / baseBytes <= policy.largeDeletionRemainingRatio
  );
}

function fileSize(filePath: string): number {
  try {
    return statSync(filePath).size;
  } catch {
    return 0;
  }
}

function gitFileSize(base: string, file: string): number {
  try {
    const mergeBase = git(["merge-base", base, "HEAD"]).trim() || base;
    return Number(git(["cat-file", "-s", `${mergeBase}:${file}`]).trim()) || 0;
  } catch {
    return 0;
  }
}

function changedFiles(base: string): string[] {
  try {
    return [
      ...new Set([
        ...git(["diff", "--name-only", `${base}...HEAD`]).split("\n"),
        ...git(["diff", "--name-only", "HEAD"]).split("\n"),
      ]),
    ].filter(Boolean);
  } catch {
    console.warn(`data-policy: unable to compare with ${base}; size checks still apply`);
    return [];
  }
}

function matchesPath(file: string, prefix: string): boolean {
  return prefix.endsWith("/") ? file.startsWith(prefix) : file === prefix;
}

function git(args: string[]): string {
  return execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

try {
  main();
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
