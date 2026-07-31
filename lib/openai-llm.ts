import OpenAI from "openai";

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
};

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

      const response = await this.client.responses.create({
        model: resolveModel(request.model),
        input,
        max_output_tokens: request.max_tokens,
        tools: request.tools?.length ? [{ type: "web_search" }] : undefined,
      });

      return {
        content: [{ type: "text", text: response.output_text }],
        usage: {
          input_tokens: response.usage?.input_tokens ?? 0,
          output_tokens: response.usage?.output_tokens ?? 0,
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

namespace Anthropic {
  export namespace Messages {
    export type Message = import("./openai-llm.js").Message;
    export type TextBlock = import("./openai-llm.js").TextBlock;
  }
}

export default Anthropic;
