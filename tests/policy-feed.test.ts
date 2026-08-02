import assert from "node:assert/strict";
import test from "node:test";
import {
  PolicyFeedBuildError,
  buildPolicyFeed,
} from "../lib/policy-feed/build";
import { respondPolicyFeed } from "../lib/policy-feed/respond";
import type { DatasetSnapshot } from "../lib/data/dataset-types";

const RELEASE_GENERATED_AT = "2026-07-31T12:00:00.000Z";

function snapshotWith(
  entities: Record<string, { news?: unknown[] }>,
  overrides: Partial<DatasetSnapshot["release"]> = {},
): DatasetSnapshot {
  return {
    release: {
      datasetId: "news-summaries",
      releaseId: "rel-1",
      objectKey: "news/summaries.json",
      checksumSha256: "0".repeat(64),
      byteSize: 1,
      contentType: "application/json",
      schemaVersion: "1.0.0",
      generatedAt: RELEASE_GENERATED_AT,
      publishedAt: RELEASE_GENERATED_AT,
      ...overrides,
    },
    data: { entities },
    cacheState: "origin",
    cachedAt: RELEASE_GENERATED_AT,
  };
}

function officialItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "us-1",
    headline: "OCC proposes GENIUS Act rules",
    source: "Federal Register",
    date: "2026-07-30",
    url: "https://www.federalregister.gov/example",
    summary: "The OCC proposed regulations implementing the GENIUS Act.",
    sourceType: "official-api",
    ...overrides,
  };
}

// model: happyFreshServeTest — schemaVersion, generatedAt from release, flatten, url -> sourceUrl
test("builds the exact v1 shape from an active release", () => {
  const feed = buildPolicyFeed(
    snapshotWith({ "United States": { news: [officialItem()] } }),
    {},
  );

  assert.equal(feed.schemaVersion, "1.0.0");
  assert.equal(feed.generatedAt, RELEASE_GENERATED_AT);
  assert.deepEqual(feed.items, [
    {
      date: "2026-07-30",
      jurisdiction: "United States",
      summary: "The OCC proposed regulations implementing the GENIUS Act.",
      sourceUrl: "https://www.federalregister.gov/example",
    },
  ]);
});

// model: invGeneratedAtFromRelease — request/build time is never used
test("generatedAt comes from release metadata even when data disagrees", () => {
  const snapshot = snapshotWith({ US: { news: [officialItem()] } });
  (snapshot.data as { generatedAt?: string }).generatedAt =
    "2020-01-01T00:00:00.000Z";

  const feed = buildPolicyFeed(snapshot, {});

  assert.equal(feed.generatedAt, RELEASE_GENERATED_AT);
});

// model: thirdPartyExcludedTest — non-official excluded, malformed non-official ignored
test("excludes non-official items silently, even malformed ones", () => {
  const feed = buildPolicyFeed(
    snapshotWith({
      US: {
        news: [
          officialItem(),
          officialItem({ id: "np-1", sourceType: undefined }),
          officialItem({ id: "np-2", sourceType: "news", date: "bad-date" }),
        ],
      },
    }),
    {},
  );

  assert.equal(feed.items.length, 1);
  assert.equal(feed.items[0].sourceUrl, officialItem().url);
});

// model: orderingDeterministicTest — date desc, jurisdiction asc, sourceUrl asc
test("orders items by date desc, jurisdiction asc, sourceUrl asc", () => {
  const feed = buildPolicyFeed(
    snapshotWith({
      Singapore: {
        news: [
          officialItem({ id: "sg-1", date: "2026-07-30", url: "https://sso.example/b" }),
          officialItem({ id: "sg-2", date: "2026-07-30", url: "https://sso.example/a" }),
        ],
      },
      "European Union": {
        news: [officialItem({ id: "eu-1", date: "2026-07-30", url: "https://eurlex.example/1" })],
      },
      "United States": {
        news: [officialItem({ id: "us-9", date: "2026-07-31", url: "https://gov.example/1" })],
      },
    }),
    {},
  );

  assert.deepEqual(
    feed.items.map((item) => [item.date, item.jurisdiction, item.sourceUrl]),
    [
      ["2026-07-31", "United States", "https://gov.example/1"],
      ["2026-07-30", "European Union", "https://eurlex.example/1"],
      ["2026-07-30", "Singapore", "https://sso.example/a"],
      ["2026-07-30", "Singapore", "https://sso.example/b"],
    ],
  );
});

// plan section 4: deterministic first sentence, no line breaks, U.S.-style abbreviations
test("normalizes multi-sentence summaries to a deterministic first sentence", () => {
  const feed = buildPolicyFeed(
    snapshotWith({
      US: {
        news: [
          officialItem({
            summary:
              "The U.S. OCC issued final guidance on\nstablecoin reserves. Comments closed earlier this month.",
          }),
        ],
      },
    }),
    {},
  );

  assert.equal(
    feed.items[0].summary,
    "The U.S. OCC issued final guidance on stablecoin reserves.",
  );
  assert.ok(!feed.items[0].summary.includes("\n"));
});

// model: emptyFeedIsServableTest
test("returns a valid empty feed when no official items exist", () => {
  const feed = buildPolicyFeed(
    snapshotWith({ US: { news: [officialItem({ sourceType: undefined })] } }),
    {},
  );

  assert.deepEqual(feed.items, []);
  assert.equal(feed.generatedAt, RELEASE_GENERATED_AT);
});

// model: malformedOfficialPoisonsFeedTest — atomic failure, no partial feed
test("rejects the whole feed when one eligible item is malformed", () => {
  for (const bad of [
    officialItem({ id: "bad-date", date: "07/30/2026" }),
    officialItem({ id: "bad-url", url: "http://insecure.example/doc" }),
    officialItem({ id: "bad-summary", summary: "   " }),
    officialItem({ id: "no-summary", summary: undefined }),
  ]) {
    assert.throws(
      () =>
        buildPolicyFeed(
          snapshotWith({ US: { news: [officialItem(), bad] } }),
          {},
        ),
      (error: unknown) =>
        error instanceof PolicyFeedBuildError && error.reason === "invalid-item",
      `expected atomic failure for ${JSON.stringify(bad)}`,
    );
  }
});

// model: invalid jurisdiction key is an eligible-item failure
test("rejects the feed when a jurisdiction display name is empty", () => {
  assert.throws(
    () => buildPolicyFeed(snapshotWith({ "  ": { news: [officialItem()] } }), {}),
    (error: unknown) =>
      error instanceof PolicyFeedBuildError && error.reason === "invalid-item",
  );
});

// model: unsupportedSchemaIs503Test
test("rejects an unsupported source dataset schema version", () => {
  assert.throws(
    () =>
      buildPolicyFeed(
        snapshotWith({ US: { news: [officialItem()] } }, { schemaVersion: "2.0.0" }),
        {},
      ),
    (error: unknown) =>
      error instanceof PolicyFeedBuildError &&
      error.reason === "unsupported-schema-version",
  );
});

// plan section 6: invalid release timestamp rejected
test("rejects a missing or invalid release generatedAt", () => {
  assert.throws(
    () =>
      buildPolicyFeed(
        snapshotWith({ US: { news: [officialItem()] } }, { generatedAt: "not-a-time" }),
        {},
      ),
    (error: unknown) =>
      error instanceof PolicyFeedBuildError &&
      error.reason === "invalid-generated-at",
  );
});

// model: playbook mapping emit/omit
test("emits playbookId only from the explicit mapping", () => {
  const feed = buildPolicyFeed(
    snapshotWith({
      US: {
        news: [
          officialItem({ id: "mapped-1" }),
          officialItem({ id: "unmapped-1", url: "https://gov.example/2" }),
        ],
      },
    }),
    { "mapped-1": "stablecoin-pre-listing" },
  );

  const mapped = feed.items.find(
    (item) => item.sourceUrl === officialItem().url,
  );
  const unmapped = feed.items.find(
    (item) => item.sourceUrl === "https://gov.example/2",
  );
  assert.equal(mapped?.playbookId, "stablecoin-pre-listing");
  assert.ok(unmapped);
  assert.ok(!("playbookId" in unmapped));
});

// model: invalidPlaybookMappingPoisonsFeedTest — fail, never silently drop
test("rejects the feed when a mapping targets an unknown playbook", () => {
  assert.throws(
    () =>
      buildPolicyFeed(
        snapshotWith({ US: { news: [officialItem({ id: "mapped-1" })] } }),
        { "mapped-1": "not-a-playbook" },
      ),
    (error: unknown) =>
      error instanceof PolicyFeedBuildError &&
      error.reason === "invalid-playbook-mapping",
  );
});

// a mapping for an item not present in this release is ignored, not an error
test("ignores mappings for items absent from the active release", () => {
  const feed = buildPolicyFeed(
    snapshotWith({ US: { news: [officialItem()] } }),
    { "gone-1": "stablecoin-pre-listing" },
  );

  assert.equal(feed.items.length, 1);
});

// ---- HTTP response assembly (lib/policy-feed/respond.ts) ----

// model: serveWithoutDatasetIs503Test — missing active dataset => 503, no-store
test("responds 503 with no-store when there is no active dataset", () => {
  const result = respondPolicyFeed(null, {}, null);

  assert.equal(result.status, 503);
  assert.equal(result.headers["Cache-Control"], "no-store");
  assert.deepEqual(result.body, { error: "policy-feed-unavailable" });
});

// model: invAtomicNoPartialFeed — build failure => 503, zero items leaked
test("responds 503 when the build fails, leaking no partial items", () => {
  const result = respondPolicyFeed(
    snapshotWith({ US: { news: [officialItem({ date: "bad" })] } }),
    {},
    null,
  );

  assert.equal(result.status, 503);
  assert.equal(result.headers["Cache-Control"], "no-store");
  assert.deepEqual(result.body, { error: "policy-feed-unavailable" });
});

// plan section 6: success headers, ETag from the complete projected response
test("responds 200 with contract headers and a deterministic ETag", () => {
  const snapshot = snapshotWith({ US: { news: [officialItem()] } });
  const result = respondPolicyFeed(snapshot, {}, null);

  assert.equal(result.status, 200);
  assert.equal(
    result.headers["Cache-Control"],
    "public, max-age=300, stale-while-revalidate=86400",
  );
  assert.equal(result.headers["X-Policy-Feed-Schema-Version"], "1.0.0");
  assert.equal(result.headers["X-Data-Generated-At"], RELEASE_GENERATED_AT);
  assert.equal(result.headers["X-Data-Cache-State"], "origin");
  assert.match(result.headers.ETag, /^"sha256-[0-9a-f]{64}"$/);
  assert.ok(!("Warning" in result.headers));

  const again = respondPolicyFeed(snapshot, {}, null);
  assert.equal(again.headers.ETag, result.headers.ETag);
});

// plan section 6: matching If-None-Match => 304 with empty body
test("responds 304 for a matching If-None-Match", () => {
  const snapshot = snapshotWith({ US: { news: [officialItem()] } });
  const first = respondPolicyFeed(snapshot, {}, null);
  const second = respondPolicyFeed(snapshot, {}, first.headers.ETag);

  assert.equal(second.status, 304);
  assert.equal(second.body, null);
  assert.equal(second.headers.ETag, first.headers.ETag);
});

// model: staleServeKeepsGeneratedAtTest — stale snapshot stays visible
test("serves a stale snapshot with stale headers and the old generatedAt", () => {
  const snapshot = snapshotWith({ US: { news: [officialItem()] } });
  snapshot.cacheState = "stale-cache";
  snapshot.staleReason = "refresh-failed";

  const result = respondPolicyFeed(snapshot, {}, null);

  assert.equal(result.status, 200);
  assert.equal(result.headers["X-Data-Stale"], "true");
  assert.match(result.headers.Warning, /^110 /);
  assert.equal(result.headers["X-Data-Cache-State"], "stale-cache");
  assert.equal(
    (result.body as { generatedAt: string }).generatedAt,
    RELEASE_GENERATED_AT,
  );
});

// ---- contract: contracts/v1/policy-feed.schema.json ----

test("complete responses validate against the committed v1 schema", async () => {
  const { readFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const Ajv2020 = (await import("ajv/dist/2020")).default;
  const addFormats = (await import("ajv-formats")).default;

  const schema = JSON.parse(
    await readFile(
      path.join(process.cwd(), "contracts", "v1", "policy-feed.schema.json"),
      "utf8",
    ),
  );
  const ajv = new Ajv2020({ strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  const feed = buildPolicyFeed(
    snapshotWith({
      US: { news: [officialItem({ id: "mapped-1" })] },
    }),
    { "mapped-1": "stablecoin-pre-listing" },
  );
  assert.equal(validate(feed), true, JSON.stringify(validate.errors));

  const wrongVersion = { ...feed, schemaVersion: "9.9.9" };
  assert.equal(validate(wrongVersion), false);

  const unknownTopLevel = { ...feed, extra: true };
  assert.equal(validate(unknownTopLevel), false);

  const unknownItemField = {
    ...feed,
    items: [{ ...feed.items[0], internalNote: "x" }],
  };
  assert.equal(validate(unknownItemField), false);

  const httpUrl = {
    ...feed,
    items: [{ ...feed.items[0], sourceUrl: "http://insecure.example" }],
  };
  assert.equal(validate(httpUrl), false);
});

// plan section 9: no private reviewer/customer/rule data in any response field
test("responses expose only the five public item fields", () => {
  const feed = buildPolicyFeed(
    snapshotWith({
      US: {
        news: [
          officialItem({
            id: "mapped-1",
            reviewerName: "private person",
            internalDecisionRule: "secret",
          }),
        ],
      },
    }),
    { "mapped-1": "stablecoin-pre-listing" },
  );

  assert.deepEqual(Object.keys(feed).sort(), [
    "generatedAt",
    "items",
    "schemaVersion",
  ]);
  assert.deepEqual(Object.keys(feed.items[0]).sort(), [
    "date",
    "jurisdiction",
    "playbookId",
    "sourceUrl",
    "summary",
  ]);
});
