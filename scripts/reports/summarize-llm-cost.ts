import "../env.js";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

type CostEntry = {
  runId: string;
  label: string;
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  costUsd: number | null;
};

const path = resolve(
  process.env.LLM_COST_LOG_PATH || "data/operations/llm-cost.jsonl",
);
if (!existsSync(path)) throw new Error(`Cost log does not exist: ${path}`);

const entries = readFileSync(path, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line) as CostEntry);
const requestedRunId = process.argv[2];
const runId = requestedRunId || entries.at(-1)?.runId;
if (!runId) throw new Error("Cost log is empty.");

const selected = entries.filter((entry) => entry.runId === runId);
if (selected.length === 0) throw new Error(`No cost entries found for run ${runId}`);

const totals = selected.reduce(
  (sum, entry) => ({
    calls: sum.calls + 1,
    inputTokens: sum.inputTokens + entry.inputTokens,
    cachedInputTokens: sum.cachedInputTokens + entry.cachedInputTokens,
    cacheWriteTokens: sum.cacheWriteTokens + entry.cacheWriteTokens,
    outputTokens: sum.outputTokens + entry.outputTokens,
    costUsd: sum.costUsd + (entry.costUsd ?? 0),
    unknownPriceCalls: sum.unknownPriceCalls + (entry.costUsd === null ? 1 : 0),
  }),
  {
    calls: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    unknownPriceCalls: 0,
  },
);

console.log(JSON.stringify({ runId, ...totals }, null, 2));
