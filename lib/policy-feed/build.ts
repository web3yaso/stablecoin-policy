import type { DatasetSnapshot } from "../data/dataset-types";
import {
  KNOWN_PLAYBOOK_IDS,
  POLICY_FEED_SCHEMA_VERSION,
  type PlaybookId,
  type PlaybookMap,
  type PolicyFeedItem,
  type PolicyFeedResponse,
} from "./contracts";

export type PolicyFeedBuildReason =
  | "unsupported-schema-version"
  | "invalid-generated-at"
  | "invalid-source-data"
  | "invalid-item"
  | "invalid-playbook-mapping";

export class PolicyFeedBuildError extends Error {
  constructor(
    message: string,
    readonly reason: PolicyFeedBuildReason,
  ) {
    super(message);
    this.name = "PolicyFeedBuildError";
  }
}

const SUPPORTED_SOURCE_SCHEMA_VERSIONS = new Set(["1.0.0"]);
const OFFICIAL_SOURCE_TYPES = new Set(["official-api", "official-feed"]);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type SourceNewsItem = {
  id?: unknown;
  date?: unknown;
  url?: unknown;
  summary?: unknown;
  sourceType?: unknown;
};

/**
 * Pure, deterministic projection of an active news-summaries release into the
 * v1 policy-feed response. Behavior is modeled in specs/policyFeed.qnt: any
 * malformed eligible item or invalid playbook mapping fails the whole build.
 */
export function buildPolicyFeed(
  snapshot: DatasetSnapshot,
  playbookMap: PlaybookMap,
): PolicyFeedResponse {
  const { release } = snapshot;
  if (!SUPPORTED_SOURCE_SCHEMA_VERSIONS.has(release.schemaVersion)) {
    throw new PolicyFeedBuildError(
      `unsupported news-summaries schema version: ${release.schemaVersion}`,
      "unsupported-schema-version",
    );
  }
  if (
    typeof release.generatedAt !== "string" ||
    !Number.isFinite(Date.parse(release.generatedAt))
  ) {
    throw new PolicyFeedBuildError(
      "release generatedAt is missing or not a valid timestamp",
      "invalid-generated-at",
    );
  }
  for (const [itemId, playbookId] of Object.entries(playbookMap)) {
    if (!KNOWN_PLAYBOOK_IDS.includes(playbookId as PlaybookId)) {
      throw new PolicyFeedBuildError(
        `playbook mapping for ${itemId} targets unknown playbook ${playbookId}`,
        "invalid-playbook-mapping",
      );
    }
  }

  const entities = readEntities(snapshot.data);
  const items: PolicyFeedItem[] = [];
  for (const [jurisdiction, entity] of Object.entries(entities)) {
    const news = Array.isArray(entity?.news) ? entity.news : [];
    for (const raw of news) {
      const candidate = (raw ?? {}) as SourceNewsItem;
      if (
        typeof candidate.sourceType !== "string" ||
        !OFFICIAL_SOURCE_TYPES.has(candidate.sourceType)
      ) {
        continue; // non-official items never enter the feed (plan section 4)
      }
      items.push(projectEligibleItem(jurisdiction, candidate, playbookMap));
    }
  }

  items.sort(compareFeedItems);

  return {
    schemaVersion: POLICY_FEED_SCHEMA_VERSION,
    generatedAt: release.generatedAt,
    items,
  };
}

function readEntities(
  data: unknown,
): Record<string, { news?: unknown[] } | undefined> {
  if (typeof data !== "object" || data === null) {
    throw new PolicyFeedBuildError(
      "news-summaries data is not an object",
      "invalid-source-data",
    );
  }
  const entities = (data as { entities?: unknown }).entities ?? {};
  if (typeof entities !== "object" || entities === null) {
    throw new PolicyFeedBuildError(
      "news-summaries entities is not an object",
      "invalid-source-data",
    );
  }
  return entities as Record<string, { news?: unknown[] } | undefined>;
}

function projectEligibleItem(
  jurisdiction: string,
  item: SourceNewsItem,
  playbookMap: PlaybookMap,
): PolicyFeedItem {
  const displayName = jurisdiction.trim();
  if (displayName.length === 0) {
    throw invalidItem(item, "jurisdiction display name is empty");
  }
  if (typeof item.date !== "string" || !DATE_PATTERN.test(item.date)) {
    throw invalidItem(item, "date is not YYYY-MM-DD");
  }
  if (typeof item.url !== "string" || !item.url.startsWith("https://")) {
    throw invalidItem(item, "url is not HTTPS");
  }
  const summary =
    typeof item.summary === "string" ? firstSentence(item.summary) : "";
  if (summary.length === 0) {
    throw invalidItem(item, "summary is missing or empty");
  }

  const projected: PolicyFeedItem = {
    date: item.date,
    jurisdiction: displayName,
    summary,
    sourceUrl: item.url,
  };
  if (typeof item.id === "string" && item.id in playbookMap) {
    projected.playbookId = playbookMap[item.id] as PlaybookId;
  }
  return projected;
}

function invalidItem(item: SourceNewsItem, detail: string): PolicyFeedBuildError {
  const id = typeof item.id === "string" ? item.id : "<no id>";
  return new PolicyFeedBuildError(
    `eligible news item ${id} is invalid: ${detail}`,
    "invalid-item",
  );
}

/**
 * Deterministic first-sentence selection with whitespace normalization.
 * A "." only terminates a sentence when it is followed by whitespace (or ends
 * the text) and the preceding token is not a single uppercase letter, so
 * abbreviations like "U.S." do not split the sentence. No LLM is involved.
 */
export function firstSentence(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];
    if (char === "。" || char === "！" || char === "？") {
      return normalized.slice(0, i + 1);
    }
    const atBoundary = i + 1 === normalized.length || normalized[i + 1] === " ";
    if ((char === "!" || char === "?") && atBoundary) {
      return normalized.slice(0, i + 1);
    }
    if (char === "." && atBoundary && !isAbbreviationPeriod(normalized, i)) {
      return normalized.slice(0, i + 1);
    }
  }
  return normalized;
}

function isAbbreviationPeriod(text: string, periodIndex: number): boolean {
  let start = periodIndex;
  while (start > 0 && /[A-Za-z0-9]/.test(text[start - 1])) {
    start -= 1;
  }
  const token = text.slice(start, periodIndex);
  return token.length === 1 && /[A-Z]/.test(token);
}

function compareFeedItems(a: PolicyFeedItem, b: PolicyFeedItem): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  if (a.jurisdiction !== b.jurisdiction) {
    return a.jurisdiction < b.jurisdiction ? -1 : 1;
  }
  if (a.sourceUrl !== b.sourceUrl) return a.sourceUrl < b.sourceUrl ? -1 : 1;
  return 0;
}
