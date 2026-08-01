import "../env.js";
import assert from "node:assert/strict";
import {
  readSupabaseConfig,
  safeResponseText,
  SupabaseHttpClient,
} from "../../lib/data/supabase-client.js";
import { SupabasePublicLegalCorpusRepository } from "../../lib/legal-corpus/supabase-public-repository.js";

async function main() {
  const config = readSupabaseConfig();
  const client = new SupabaseHttpClient(config);
  const repository = new SupabasePublicLegalCorpusRepository(client);

  const [coverage, missingSource, changes, bucket] = await Promise.all([
    repository.getCoverage(),
    repository.findSource("document:smoke:missing"),
    repository.listChanges(),
    fetch(new URL(`/storage/v1/bucket/${config.sourcesBucket}`, config.url), {
      headers: {
        apikey: config.serviceRoleKey,
        Authorization: `Bearer ${config.serviceRoleKey}`,
      },
      signal: AbortSignal.timeout(config.requestTimeoutMs),
    }),
  ]);

  if (!bucket.ok) {
    throw new Error(
      `source bucket unavailable (${bucket.status}): ${await safeResponseText(bucket)}`,
    );
  }
  const bucketBody = (await bucket.json()) as { id?: unknown; public?: unknown };
  assert.equal(bucketBody.id, config.sourcesBucket);
  assert.equal(bucketBody.public, false);
  assert.deepEqual(
    coverage.markets.map((market) => market.jurisdictionCode),
    ["EEA", "HK", "SG"],
  );
  assert.ok(
    coverage.markets.every(
      (market) =>
        market.coverageState === "IN_PROGRESS" &&
        market.reviewedClaimCount === 0 &&
        market.corpusReleaseId === null,
    ),
  );
  assert.equal(missingSource, null);
  assert.deepEqual(changes.changes, []);

  console.log(
    JSON.stringify({
      bucket: { id: bucketBody.id, public: bucketBody.public },
      markets: coverage.markets.map((market) => ({
        jurisdictionCode: market.jurisdictionCode,
        coverageState: market.coverageState,
        reviewedClaimCount: market.reviewedClaimCount,
      })),
      sourceBoundary: "missing-source-hidden",
      publishedChangeCount: changes.changes.length,
    }),
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
