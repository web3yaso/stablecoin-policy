import "../env.js";
import { readSupabaseConfig, SupabaseHttpClient } from "../../lib/data/supabase-client.js";
import { BaselineReadinessClient } from "../../lib/legal-corpus/baseline-readiness.js";

async function main() {
  const args = process.argv.slice(2);
  const jurisdictionCode = requiredValue(args, "--jurisdiction");
  const client = new BaselineReadinessClient(
    new SupabaseHttpClient(readSupabaseConfig()),
  );
  const report = await client.get(jurisdictionCode);
  console.log(JSON.stringify(args.includes("--summary") ? {
    jurisdictionCode: report.jurisdictionCode,
    workflowStage: report.workflowStage,
    workflowComplete: report.workflowComplete,
    legalCompletenessAssessed: report.legalCompletenessAssessed,
    blockers: report.blockers,
    warnings: report.warnings,
  } : report, null, 2));
  console.error("read-only workflow inventory; legal completeness is not assessed");
}

function requiredValue(args: string[], name: string): string {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
