import { readFile } from "node:fs/promises";
import path from "node:path";

type Outcome = "ACCEPT" | "SERVE_STALE" | "SERVE_PRIMARY" | "BLOCK";

type StorageCase =
  | {
      caseId: string;
      kind: "stale-cache";
      cached: boolean;
      ageSeconds: number;
      maxStaleSeconds: number;
      expected: Outcome;
    }
  | {
      caseId: string;
      kind: "checksum";
      expectedChecksum: string;
      actualChecksum: string;
      expected: Outcome;
    }
  | {
      caseId: string;
      kind: "dual-read";
      equal: boolean;
      strict: boolean;
      expected: Outcome;
    }
  | {
      caseId: string;
      kind: "rollback";
      known: boolean;
      verified: boolean;
      expected: Outcome;
    };

async function main() {
  const cases = (await readFile(
    path.join(process.cwd(), "evals", "phase1-storage-cases.jsonl"),
    "utf8",
  ))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as StorageCase);
  const failures = cases.filter((evalCase) => evaluate(evalCase) !== evalCase.expected);

  for (const failure of failures) {
    console.error(
      `${failure.caseId}: expected=${failure.expected} actual=${evaluate(failure)}`,
    );
  }
  if (failures.length > 0) {
    throw new Error(`phase1 eval failed: ${failures.length}/${cases.length} cases`);
  }
  console.log(`phase1 eval passed: ${cases.length}/${cases.length} cases`);
}

function evaluate(evalCase: StorageCase): Outcome {
  switch (evalCase.kind) {
    case "stale-cache":
      return evalCase.cached && evalCase.ageSeconds <= evalCase.maxStaleSeconds
        ? "SERVE_STALE"
        : "BLOCK";
    case "checksum":
      return evalCase.expectedChecksum === evalCase.actualChecksum
        ? "ACCEPT"
        : "BLOCK";
    case "dual-read":
      if (evalCase.equal) return "ACCEPT";
      return evalCase.strict ? "BLOCK" : "SERVE_PRIMARY";
    case "rollback":
      return evalCase.known && evalCase.verified ? "ACCEPT" : "BLOCK";
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
