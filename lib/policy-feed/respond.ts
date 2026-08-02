import { createHash } from "node:crypto";
import type { DatasetSnapshot } from "../data/dataset-types";
import { buildPolicyFeed } from "./build";
import { POLICY_FEED_SCHEMA_VERSION, type PlaybookMap } from "./contracts";

export type PolicyFeedHttpResult = {
  status: number;
  headers: Record<string, string>;
  body: unknown;
};

/**
 * Deterministic HTTP mapping for the policy feed. Any missing dataset or
 * build failure is atomic: 503 with no-store and no partial items. The ETag
 * is computed from the complete projected response, so it changes exactly
 * when the served content changes.
 */
export function respondPolicyFeed(
  snapshot: DatasetSnapshot | null,
  playbookMap: PlaybookMap,
  ifNoneMatch: string | null,
): PolicyFeedHttpResult {
  if (snapshot === null) {
    return unavailable();
  }

  let feed;
  try {
    feed = buildPolicyFeed(snapshot, playbookMap);
  } catch {
    return unavailable();
  }

  const serialized = JSON.stringify(feed);
  const etag = `"sha256-${createHash("sha256").update(serialized).digest("hex")}"`;
  const headers: Record<string, string> = {
    "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
    ETag: etag,
    "X-Policy-Feed-Schema-Version": POLICY_FEED_SCHEMA_VERSION,
    "X-Data-Generated-At": feed.generatedAt,
    "X-Data-Cache-State": snapshot.cacheState,
  };
  if (snapshot.cacheState === "stale-cache") {
    headers.Warning = '110 - "Response is stale"';
    headers["X-Data-Stale"] = "true";
  }

  if (ifNoneMatch === etag) {
    return { status: 304, headers, body: null };
  }
  return { status: 200, headers, body: feed };
}

function unavailable(): PolicyFeedHttpResult {
  return {
    status: 503,
    headers: { "Cache-Control": "no-store" },
    body: { error: "policy-feed-unavailable" },
  };
}
