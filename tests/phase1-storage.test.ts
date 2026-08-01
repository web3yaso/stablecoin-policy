import assert from "node:assert/strict";
import test from "node:test";
import type {
  DatasetReleaseRepository,
  ImmutableObjectStore,
} from "../lib/data/contracts";
import {
  DatasetService,
  DualReadDatasetService,
  type DatasetReader,
} from "../lib/data/dataset-service";
import type { DatasetRelease, DatasetSnapshot } from "../lib/data/dataset-types";
import { isPublicDatasetId } from "../lib/data/dataset-types";
import { DataIntegrityError, DataParityError } from "../lib/data/external-storage-errors";
import { ImmutableObjectConflictError } from "../lib/data/file-object-store";
import { sha256 } from "../lib/data/integrity";
import { ResilientCache } from "../lib/data/resilient-cache";
import { SupabaseHttpClient, type FetchLike } from "../lib/data/supabase-client";
import { SupabaseDatasetReleaseRepository } from "../lib/data/supabase-dataset-repository";
import { SupabaseObjectStore } from "../lib/data/supabase-object-store";
import { SupabaseReportRepository } from "../lib/data/supabase-report-repository";
import { createImmutableObjectKey } from "../lib/data/supabase-release-publisher";

const CHECKSUM = "a".repeat(64);
const GENERATED_AT = "2026-07-31T12:00:00.000Z";

test("resilient cache serves verified stale data only inside the configured window", async () => {
  let now = 0;
  const cache = new ResilientCache<string>({
    freshForMs: 10,
    maxStaleMs: 100,
    now: () => now,
  });

  const origin = await cache.read("news", async () => "release-1");
  assert.equal(origin.state, "origin");

  now = 20;
  const stale = await cache.read("news", async () => {
    throw new Error("temporary outage");
  });
  assert.equal(stale.value, "release-1");
  assert.equal(stale.state, "stale-cache");
  assert.match(stale.staleBecause?.message ?? "", /temporary outage/);

  now = 101;
  await assert.rejects(
    () =>
      cache.read("news", async () => {
        throw new Error("continued outage");
      }),
    /continued outage/,
  );
});

test("Supabase object storage is idempotent and rejects changed immutable content", async () => {
  const objects = new Map<string, Uint8Array>();
  const fetchImpl: FetchLike = async (input, init) => {
    const url = new URL(String(input));
    const key = url.pathname;
    if (init?.method === "POST") {
      if (objects.has(key)) return new Response("duplicate", { status: 409 });
      objects.set(key, new Uint8Array(await new Response(init.body).arrayBuffer()));
      return Response.json({ Key: key });
    }
    const body = objects.get(key);
    return body
      ? new Response(Buffer.from(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      : new Response("missing", { status: 404 });
  };
  const store = new SupabaseObjectStore(createClient(fetchImpl), "policy-reports");

  const first = await store.putObject({
    key: "reports/example/2026/release.md.enc",
    body: Buffer.from("first"),
    contentType: "application/json",
  });
  const repeated = await store.putObject({
    key: first.key,
    body: Buffer.from("first"),
    contentType: "application/json",
  });
  assert.equal(repeated.checksumSha256, first.checksumSha256);

  await assert.rejects(
    () =>
      store.putObject({
        key: first.key,
        body: Buffer.from("changed"),
        contentType: "application/json",
      }),
    ImmutableObjectConflictError,
  );
});

test("Supabase report metadata maps storage integrity fields without exposing provider details", async () => {
  const fetchImpl: FetchLike = async () =>
    Response.json([
      {
        slug: "global-stablecoin-policy-report",
        title: "Daily report",
        title_en: null,
        summary: "Reviewed official-source update.",
        category: "policy",
        jurisdictions: ["GLOBAL"],
        published_at: "2026-07-31T12:00:00+00:00",
        word_count: 120,
        price_usd: "0.10",
        encrypted_content_file: "global-stablecoin-policy-report.md.enc",
        artifact_key: "reports/global/release.md.enc",
        artifact_checksum_sha256: CHECKSUM,
        source_url: null,
      },
    ]);
  const repository = new SupabaseReportRepository(createClient(fetchImpl));
  const reports = await repository.listReports();

  assert.equal(reports[0].priceUSD, 0.1);
  assert.equal(reports[0].artifactChecksumSha256, CHECKSUM);
  assert.equal(reports[0].artifactKey, "reports/global/release.md.enc");
  assert.equal(reports[0].publishedAt, GENERATED_AT);
});

test("Supabase dataset metadata canonicalizes PostgreSQL timestamps", async () => {
  const fetchImpl: FetchLike = async () =>
    Response.json([
      {
        dataset_id: "news-summaries",
        release_id: "release-1",
        object_key: "datasets/news/release-1.json",
        checksum_sha256: CHECKSUM,
        byte_size: "42",
        content_type: "application/json",
        schema_version: "1.0.0",
        generated_at: "2026-07-31T12:00:00+00:00",
        published_at: "2026-07-31T12:00:00+00:00",
      },
    ]);
  const repository = new SupabaseDatasetReleaseRepository(createClient(fetchImpl));
  const release = await repository.findActiveRelease("news-summaries");

  assert.equal(release?.generatedAt, GENERATED_AT);
  assert.equal(release?.publishedAt, GENERATED_AT);
});

test("dataset reads verify checksums and can replay a previous release", async () => {
  const active = release("release-2", "datasets/news/release-2.json", { value: 2 });
  const previous = release("release-1", "datasets/news/release-1.json", { value: 1 });
  const repository: DatasetReleaseRepository = {
    findActiveRelease: async () => active.meta,
    findRelease: async (_datasetId, releaseId) =>
      releaseId === previous.meta.releaseId ? previous.meta : null,
  };
  const store: ImmutableObjectStore = {
    getObject: async (key) => {
      const item = key === active.meta.objectKey ? active : previous;
      return {
        key,
        body: item.body,
        contentType: "application/json",
        byteSize: item.body.byteLength,
        checksumSha256: sha256(item.body),
      };
    },
    putObject: async () => {
      throw new Error("not used");
    },
  };
  const service = new DatasetService(repository, store, {
    freshForMs: 0,
    maxStaleMs: 0,
  });

  const current = await service.getActiveDataset<{ value: number }>("news-summaries");
  const replay = await service.getDatasetRelease<{ value: number }>(
    "news-summaries",
    "release-1",
  );
  assert.equal(current?.data.value, 2);
  assert.equal(replay?.data.value, 1);

  active.meta.checksumSha256 = "f".repeat(64);
  await assert.rejects(
    () => service.getActiveDataset("other-cache-key"),
    DataIntegrityError,
  );
});

test("strict dual-read blocks mismatched external data while observation mode serves file data", async () => {
  const primary = fixedDatasetReader({ value: "file" });
  const secondary = fixedDatasetReader({ value: "external" });
  const issues: Error[] = [];
  const observe = new DualReadDatasetService(
    primary,
    secondary,
    false,
    (error) => issues.push(error),
  );
  const observed = await observe.getActiveDataset<{ value: string }>("news-summaries");
  assert.equal(observed?.data.value, "file");
  assert.equal(issues[0] instanceof DataParityError, true);

  const strict = new DualReadDatasetService(primary, secondary, true);
  await assert.rejects(
    () => strict.getActiveDataset("news-summaries"),
    DataParityError,
  );
});

test("immutable object keys pin timestamp and checksum", () => {
  const key = createImmutableObjectKey({
    kind: "datasets",
    id: "news-summaries",
    timestamp: GENERATED_AT,
    checksumSha256: CHECKSUM,
    extension: "json",
  });
  assert.equal(
    key,
    `datasets/news-summaries/2026-07-31T12-00-00-000Z/${CHECKSUM}.json`,
  );
  assert.throws(
    () =>
      createImmutableObjectKey({
        kind: "datasets",
        id: "news-summaries",
        timestamp: "not-a-date",
        checksumSha256: CHECKSUM,
        extension: "json",
      }),
    /invalid timestamp/,
  );
});

test("full daily report datasets are never exposed by the public allowlist", () => {
  assert.equal(isPublicDatasetId("news-summaries"), true);
  assert.equal(isPublicDatasetId("daily-report"), false);
});

function createClient(fetchImpl: FetchLike) {
  return new SupabaseHttpClient(
    {
      url: "https://example.supabase.co",
      serviceRoleKey: "test-service-role-key",
      reportsBucket: "policy-reports",
      datasetsBucket: "policy-datasets",
      requestTimeoutMs: 1000,
    },
    fetchImpl,
  );
}

function release(releaseId: string, objectKey: string, data: unknown) {
  const body = Buffer.from(JSON.stringify(data));
  const meta: DatasetRelease = {
    datasetId: "news-summaries",
    releaseId,
    objectKey,
    checksumSha256: sha256(body),
    byteSize: body.byteLength,
    contentType: "application/json",
    schemaVersion: "1.0.0",
    generatedAt: GENERATED_AT,
    publishedAt: GENERATED_AT,
  };
  return { meta, body };
}

function fixedDatasetReader(data: unknown): DatasetReader {
  const snapshot: DatasetSnapshot = {
    release: release("release-1", "datasets/news/release-1.json", data).meta,
    data,
    cacheState: "origin",
    cachedAt: GENERATED_AT,
  };
  return {
    getActiveDataset: async <T>() => snapshot as DatasetSnapshot<T>,
    getDatasetRelease: async <T>() => snapshot as DatasetSnapshot<T>,
  };
}
