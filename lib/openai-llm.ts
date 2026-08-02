import OpenAI from "openai";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type TextBlock = { type: "text"; text: string };
export type Message = {
  content: TextBlock[];
  usage: { input_tokens: number; output_tokens: number };
  stop_reason: "end_turn" | "max_tokens";
};

type LegacyMessage = {
  role: "user" | "assistant";
  content: string | Array<{ type: string; text?: string }>;
};

type LegacyRequest = {
  model?: string;
  max_tokens?: number;
  system?: string | Array<{ type: string; text?: string; [key: string]: unknown }>;
  messages: LegacyMessage[];
  tools?: Array<{ type?: string; name?: string; [key: string]: unknown }>;
  temperature?: number;
  /** Stable operation name used by the persisted cost audit log. */
  cost_label?: string;
};

type ModelPrice = {
  input: number;
  cachedInput: number;
  cacheWrite: number;
  output: number;
};

// USD per 1M tokens. GPT-5.6 cache writes cost 1.25x uncached input;
// cache reads receive the 90% cached-input discount.
const MODEL_PRICES: Record<string, ModelPrice> = {
  "gpt-5.6-luna": { input: 1, cachedInput: 0.1, cacheWrite: 1.25, output: 6 },
  "gpt-5.6-terra": { input: 2.5, cachedInput: 0.25, cacheWrite: 3.125, output: 15 },
};

const COST_LOG_PATH = resolve(
  process.env.LLM_COST_LOG_PATH || "data/operations/llm-cost.jsonl",
);
const COST_RUN_ID =
  process.env.LLM_COST_RUN_ID ||
  process.env.GITHUB_RUN_ID ||
  `local-${new Date().toISOString()}-${process.pid}`;

function recordCost(params: {
  responseId: string;
  model: string;
  label: string;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
}): number | null {
  const price = MODEL_PRICES[params.model];
  const uncachedInputTokens = Math.max(
    0,
    params.inputTokens - params.cachedInputTokens - params.cacheWriteTokens,
  );
  const costUsd = price
    ? (uncachedInputTokens * price.input +
        params.cachedInputTokens * price.cachedInput +
        params.cacheWriteTokens * price.cacheWrite +
        params.outputTokens * price.output) /
      1_000_000
    : null;
  const entry = {
    timestamp: new Date().toISOString(),
    runId: COST_RUN_ID,
    responseId: params.responseId,
    label: params.label,
    model: params.model,
    inputTokens: params.inputTokens,
    uncachedInputTokens,
    cachedInputTokens: params.cachedInputTokens,
    cacheWriteTokens: params.cacheWriteTokens,
    outputTokens: params.outputTokens,
    costUsd,
  };

  mkdirSync(dirname(COST_LOG_PATH), { recursive: true });
  appendFileSync(COST_LOG_PATH, `${JSON.stringify(entry)}\n`, "utf8");
  console.log(
    `[llm-cost] ${params.label} model=${params.model} ` +
      `input=${params.inputTokens} cached=${params.cachedInputTokens} ` +
      `cache_write=${params.cacheWriteTokens} output=${params.outputTokens} ` +
      `usd=${costUsd === null ? "unknown" : costUsd.toFixed(6)}`,
  );
  return costUsd;
}

function textFromContent(
  content: string | Array<{ type: string; text?: string }> | undefined,
): string {
  if (typeof content === "string") return content;
  return (content ?? [])
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n");
}

function resolveModel(legacyModel?: string): string {
  // explicit OpenAI model names are respected verbatim — required for the
  // machine-assurance cross-check, whose independence depends on actually
  // calling a different model than extraction
  if (legacyModel?.startsWith("gpt-")) return legacyModel;
  if (legacyModel?.includes("haiku")) {
    return (
      process.env.OPENAI_FAST_MODEL ||
      process.env.OPENAI_MODEL ||
      "gpt-5.6-luna"
    );
  }
  return process.env.OPENAI_MODEL || "gpt-5.6-terra";
}

/**
 * Small compatibility adapter for the repository's existing batch scripts.
 * It preserves their message/result shape while routing every request through
 * OpenAI's Responses API.
 */
class Anthropic {
  private readonly client: OpenAI;

  constructor(options: { apiKey?: string } = {}) {
    this.client = new OpenAI({
      apiKey: options.apiKey || process.env.OPENAI_API_KEY,
    });
  }

  readonly messages = {
    create: async (request: LegacyRequest): Promise<Message> => {
      const input: OpenAI.Responses.ResponseInput = [];
      const system = textFromContent(request.system);
      if (system) input.push({ role: "system", content: system });
      for (const message of request.messages) {
        input.push({
          role: message.role,
          content: textFromContent(message.content),
        });
      }

      const model = resolveModel(request.model);
      const response = await this.client.responses.create({
        model,
        input,
        max_output_tokens: request.max_tokens,
        tools: request.tools?.length ? [{ type: "web_search" }] : undefined,
      });

      const usage = response.usage;
      recordCost({
        responseId: response.id,
        model,
        label: request.cost_label || "unspecified",
        inputTokens: usage?.input_tokens ?? 0,
        cachedInputTokens: usage?.input_tokens_details?.cached_tokens ?? 0,
        cacheWriteTokens: usage?.input_tokens_details?.cache_write_tokens ?? 0,
        outputTokens: usage?.output_tokens ?? 0,
      });

      return {
        content: [{ type: "text", text: response.output_text }],
        usage: {
          input_tokens: usage?.input_tokens ?? 0,
          output_tokens: usage?.output_tokens ?? 0,
        },
        stop_reason:
          response.status === "incomplete" &&
          response.incomplete_details?.reason === "max_output_tokens"
            ? "max_tokens"
            : "end_turn",
      };
    },
    stream: (request: LegacyRequest) => ({
      finalMessage: () => this.messages.create(request),
    }),
  };
}

/* eslint-disable @typescript-eslint/no-namespace -- Declaration merging preserves the legacy Anthropic.Messages type API. */
namespace Anthropic {
  export namespace Messages {
    export type Message = import("./openai-llm.js").Message;
    export type TextBlock = import("./openai-llm.js").TextBlock;
  }
}
/* eslint-enable @typescript-eslint/no-namespace */

export default Anthropic;
