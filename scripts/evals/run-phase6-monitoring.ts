import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  parseMonitoringEvalCase,
  runMonitoringEval,
} from "../../lib/monitoring/eval";

async function main() {
  const body = await readFile(
    path.join(process.cwd(), "evals", "monitoring-events.jsonl"),
    "utf8",
  );
  const cases = body.split("\n").filter(Boolean).map((line) =>
    parseMonitoringEvalCase(JSON.parse(line) as unknown));
  const report = runMonitoringEval(cases);
  console.log(JSON.stringify(report, null, 2));
  if (report.outcome !== "PASSED") {
    throw new Error("Phase 6 monitoring eval gates failed");
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
