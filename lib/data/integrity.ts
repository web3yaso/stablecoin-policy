import { createHash } from "node:crypto";

export function sha256(body: Uint8Array): string {
  return createHash("sha256").update(body).digest("hex");
}

export function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

export function canonicalIsoTimestamp(value: unknown, field: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${field} must be a valid timestamp`);
  }
  return new Date(value).toISOString();
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }

  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortJson(entry)]),
    );
  }

  return value;
}
