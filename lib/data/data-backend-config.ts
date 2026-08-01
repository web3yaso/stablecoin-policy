import type { ResilientCacheOptions } from "./resilient-cache";

export type DataBackend = "file" | "dual" | "supabase";

export function readDataBackend(
  env: NodeJS.ProcessEnv = process.env,
): DataBackend {
  const backend = env.STABLECOIN_POLICY_DATA_BACKEND?.trim() || "file";
  if (backend !== "file" && backend !== "dual" && backend !== "supabase") {
    throw new Error(`unsupported STABLECOIN_POLICY_DATA_BACKEND: ${backend}`);
  }
  return backend;
}

export function readCacheOptions(
  env: NodeJS.ProcessEnv = process.env,
): ResilientCacheOptions {
  return {
    freshForMs: readSeconds(env.POLICY_CACHE_FRESH_SECONDS, 300) * 1000,
    maxStaleMs: readSeconds(env.POLICY_CACHE_MAX_STALE_SECONDS, 86_400) * 1000,
    maxEntries: 100,
    onStale: (key, error) =>
      console.warn(`policy data stale fallback for ${key}: ${error.message}`),
  };
}

export function readDualReadStrict(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.POLICY_DUAL_READ_STRICT === "1";
}

function readSeconds(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`invalid cache duration: ${raw}`);
  }
  return value;
}
