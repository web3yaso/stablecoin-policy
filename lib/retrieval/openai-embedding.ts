import OpenAI from "openai";
import type { QueryEmbeddingProvider } from "./contracts";

export type OpenAIEmbeddingConfig = {
  apiKey: string;
  model: string;
  version: string;
  dimensions: number;
};

export class OpenAIQueryEmbeddingProvider implements QueryEmbeddingProvider {
  readonly model: string;
  readonly version: string;
  readonly dimensions: number;
  private readonly client: OpenAI;

  constructor(config: OpenAIEmbeddingConfig) {
    if (!config.apiKey) throw new Error("OPENAI_API_KEY is required for Evidence RAG");
    if (!config.model || !config.version) {
      throw new Error("RAG embedding model and version are required");
    }
    if (!Number.isInteger(config.dimensions) || config.dimensions < 1 || config.dimensions > 4096) {
      throw new Error("RAG embedding dimensions must be between 1 and 4096");
    }
    this.model = config.model;
    this.version = config.version;
    this.dimensions = config.dimensions;
    this.client = new OpenAI({ apiKey: config.apiKey });
  }

  async embed(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: this.model,
      input: text,
      dimensions: this.dimensions,
      encoding_format: "float",
    });
    const embedding = Array.from(response.data[0]?.embedding ?? []);
    if (
      embedding.length !== this.dimensions ||
      embedding.some((value) => !Number.isFinite(value))
    ) {
      throw new Error("embedding provider returned an invalid vector");
    }
    return embedding;
  }
}

export function readOpenAIEmbeddingConfig(
  env: NodeJS.ProcessEnv = process.env,
): OpenAIEmbeddingConfig {
  return {
    apiKey: env.OPENAI_API_KEY?.trim() ?? "",
    model: env.RAG_EMBEDDING_MODEL?.trim() || "text-embedding-3-small",
    version: env.RAG_EMBEDDING_MODEL_VERSION?.trim() || "1",
    dimensions: Number(env.RAG_EMBEDDING_DIMENSIONS ?? "1536"),
  };
}
