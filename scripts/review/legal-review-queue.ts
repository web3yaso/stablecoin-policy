import "../env.js";
import { readSupabaseConfig, SupabaseHttpClient } from "../../lib/data/supabase-client.js";
import { ReviewQueueClient } from "../../lib/legal-corpus/review-queue.js";

async function main() {
  const args = process.argv.slice(2);
  const jurisdictionCode = requiredValue(args, "--jurisdiction");
  const limitValue = optionalValue(args, "--limit");
  const queue = await new ReviewQueueClient(
    new SupabaseHttpClient(readSupabaseConfig()),
  ).get(jurisdictionCode, limitValue === undefined ? 100 : Number(limitValue));

  console.log(JSON.stringify(args.includes("--summary") ? {
    jurisdictionCode: queue.jurisdictionCode,
    totalTaskCount: queue.totalTaskCount,
    returnedTaskCount: queue.returnedTaskCount,
    tasks: queue.tasks.map(({ taskType, subjectId, subjectState, priority, nextAction, readinessErrors, command }) => ({
      taskType, subjectId, subjectState, priority, nextAction, readinessErrors, command,
    })),
  } : queue, null, 2));
  console.error("read-only human review queue; no task is approved or transitioned by this command");
}

function requiredValue(args: string[], name: string): string {
  const value = optionalValue(args, name);
  if (!value) throw new Error(`${name} requires a value`);
  return value;
}

function optionalValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
