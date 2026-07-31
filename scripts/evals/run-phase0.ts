import { readFile } from "node:fs/promises";
import path from "node:path";
import { assertSafeObjectKey } from "../../lib/data/report-types";

type SecurityCase = {
  caseId: string;
  kind: "object-key";
  input: string;
  expected: "ACCEPT" | "REJECT";
};

async function main() {
  const datasetPath = path.join(
    process.cwd(),
    "evals",
    "security-cases.jsonl",
  );
  const cases = (await readFile(datasetPath, "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as SecurityCase);

  let failures = 0;

  for (const evalCase of cases) {
    const actual = evaluate(evalCase);
    if (actual !== evalCase.expected) {
      failures += 1;
      console.error(
        `${evalCase.caseId}: expected=${evalCase.expected} actual=${actual}`,
      );
    }
  }

  if (failures > 0) {
    throw new Error(`phase0 eval failed: ${failures}/${cases.length} cases`);
  }

  console.log(`phase0 eval passed: ${cases.length}/${cases.length} cases`);
}

function evaluate(evalCase: SecurityCase): "ACCEPT" | "REJECT" {
  try {
    if (evalCase.kind === "object-key") {
      assertSafeObjectKey(evalCase.input);
    }
    return "ACCEPT";
  } catch {
    return "REJECT";
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
