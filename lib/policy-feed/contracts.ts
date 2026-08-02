export const POLICY_FEED_SCHEMA_VERSION = "1.0.0" as const;

/** Canonical playbook identifiers owned by the Stablecoin Policy subsite. */
export const KNOWN_PLAYBOOK_IDS = [
  "business-model-regulatory-boundary",
  "first-jurisdiction-selection",
  "entity-licence-landing-path",
  "stablecoin-pre-listing",
  "issue-vs-white-label-vs-integrate",
  "funding-due-diligence-room",
  "multi-jurisdiction-expansion",
  "listing-lifecycle-monitor",
] as const;

export type PlaybookId = (typeof KNOWN_PLAYBOOK_IDS)[number];

export type PolicyFeedItem = {
  date: string;
  jurisdiction: string;
  summary: string;
  sourceUrl: string;
  playbookId?: PlaybookId;
};

export type PolicyFeedResponse = {
  schemaVersion: typeof POLICY_FEED_SCHEMA_VERSION;
  generatedAt: string;
  items: PolicyFeedItem[];
};

/** Explicit news-item-id to playbook-id mapping; owned by this subsite. */
export type PlaybookMap = Record<string, string>;
