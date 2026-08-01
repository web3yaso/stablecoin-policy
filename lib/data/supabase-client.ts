import { ExternalStorageError } from "./external-storage-errors";
import { assertSafeObjectKey } from "./report-types";

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type SupabaseConfig = {
  url: string;
  serviceRoleKey: string;
  reportsBucket: string;
  datasetsBucket: string;
  sourcesBucket: string;
  requestTimeoutMs: number;
};

export class SupabaseHttpClient {
  readonly config: SupabaseConfig;

  constructor(
    config: SupabaseConfig,
    private readonly fetchImpl: FetchLike = fetch,
  ) {
    this.config = validateSupabaseConfig(config);
  }

  async rest<T>(
    resource: string,
    init: RequestInit = {},
    schema = "policy",
  ): Promise<T> {
    const response = await this.request(
      new URL(`/rest/v1/${resource}`, this.config.url),
      {
        ...init,
        signal: init.signal ?? AbortSignal.timeout(this.config.requestTimeoutMs),
        headers: this.headers(init.headers, {
          "Accept-Profile": schema,
          "Content-Profile": schema,
          "Content-Type": "application/json",
        }),
      },
      `Supabase REST ${resource}`,
    );
    return readJsonResponse<T>(response, `Supabase REST ${resource}`);
  }

  async rpc<T>(
    functionName: string,
    body: Record<string, unknown>,
    schema = "policy",
  ): Promise<T> {
    return this.rest<T>(
      `rpc/${encodeURIComponent(functionName)}`,
      { method: "POST", body: JSON.stringify(body) },
      schema,
    );
  }

  async storage(
    bucket: string,
    objectKey: string,
    init: RequestInit = {},
  ): Promise<Response> {
    assertSafeObjectKey(objectKey);
    const storagePath = [bucket, ...objectKey.split("/")]
      .map(encodeURIComponent)
      .join("/");
    return this.request(
      new URL(`/storage/v1/object/${storagePath}`, this.config.url),
      {
        ...init,
        signal: init.signal ?? AbortSignal.timeout(this.config.requestTimeoutMs),
        headers: this.headers(init.headers),
      },
      `Supabase Storage ${bucket}/${objectKey}`,
    );
  }

  private async request(
    url: URL,
    init: RequestInit,
    operation: string,
  ): Promise<Response> {
    try {
      return await this.fetchImpl(url, init);
    } catch (error: unknown) {
      throw new ExternalStorageError(
        `${operation} failed: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  private headers(
    input: HeadersInit | undefined,
    additions: Record<string, string> = {},
  ): Headers {
    const headers = new Headers(input);
    headers.set("apikey", this.config.serviceRoleKey);
    headers.set("Authorization", `Bearer ${this.config.serviceRoleKey}`);
    for (const [name, value] of Object.entries(additions)) {
      if (!headers.has(name)) headers.set(name, value);
    }
    return headers;
  }
}

export function readSupabaseConfig(
  env: NodeJS.ProcessEnv = process.env,
): SupabaseConfig {
  return validateSupabaseConfig({
    url: env.SUPABASE_URL?.trim() ?? "",
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "",
    reportsBucket: env.SUPABASE_REPORTS_BUCKET?.trim() || "policy-reports",
    datasetsBucket: env.SUPABASE_DATASETS_BUCKET?.trim() || "policy-datasets",
    sourcesBucket: env.SUPABASE_SOURCES_BUCKET?.trim() || "policy-sources",
    requestTimeoutMs: Number(env.POLICY_STORAGE_TIMEOUT_MS ?? "8000"),
  });
}

function validateSupabaseConfig(config: SupabaseConfig): SupabaseConfig {
  if (!config.url || !config.serviceRoleKey) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for external storage",
    );
  }

  const url = new URL(config.url);
  const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(isLocal && url.protocol === "http:")) {
    throw new Error("SUPABASE_URL must use HTTPS unless it targets localhost");
  }

  for (const [name, bucket] of [
    ["SUPABASE_REPORTS_BUCKET", config.reportsBucket],
    ["SUPABASE_DATASETS_BUCKET", config.datasetsBucket],
    ["SUPABASE_SOURCES_BUCKET", config.sourcesBucket],
  ] as const) {
    if (!/^[a-z0-9][a-z0-9._-]{2,62}$/.test(bucket)) {
      throw new Error(`${name} is invalid`);
    }
  }
  if (
    !Number.isFinite(config.requestTimeoutMs) ||
    config.requestTimeoutMs < 100 ||
    config.requestTimeoutMs > 60_000
  ) {
    throw new Error("POLICY_STORAGE_TIMEOUT_MS must be between 100 and 60000");
  }

  return {
    ...config,
    url: url.toString().replace(/\/$/, ""),
  };
}

async function readJsonResponse<T>(
  response: Response,
  operation: string,
): Promise<T> {
  if (!response.ok) {
    throw new ExternalStorageError(
      `${operation} failed (${response.status}): ${await safeResponseText(response)}`,
      response.status,
    );
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function safeResponseText(response: Response): Promise<string> {
  const text = await response.text();
  return text.slice(0, 500) || response.statusText || "unknown error";
}
