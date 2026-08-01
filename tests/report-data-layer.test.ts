import assert from "node:assert/strict";
import { createCipheriv } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { createReportListResponse } from "../lib/contracts/report-list";
import {
  FileObjectStore,
  ImmutableObjectConflictError,
} from "../lib/data/file-object-store";
import { JsonReportRepository } from "../lib/data/json-report-repository";
import {
  ReportContentKeyMissingError,
  ReportService,
} from "../lib/data/report-service";
import type {
  EncryptedReportFile,
  ReportMeta,
} from "../lib/data/report-types";

const FIXED_TIME = "2026-07-31T12:00:00.000Z";

test("file compatibility adapters preserve latest report delivery", async () => {
  const fixture = await createReportFixture();

  try {
    const service = new ReportService(
      new JsonReportRepository(fixture.indexPath),
      new FileObjectStore(fixture.directory),
      () => fixture.key.toString("base64"),
    );

    const reports = await service.listReports();
    assert.equal(reports.length, 1);
    assert.equal(reports[0].slug, "global-stablecoin-policy-report");

    const latest = await service.getReportBySlug("latest");
    assert.equal(latest?.content, "# Reviewed policy report\n");
    assert.equal(latest?.meta.publishedAt, FIXED_TIME);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("report content fails closed when the decryption key is unavailable", async () => {
  const fixture = await createReportFixture();

  try {
    const service = new ReportService(
      new JsonReportRepository(fixture.indexPath),
      new FileObjectStore(fixture.directory),
      () => undefined,
    );

    await assert.rejects(
      () => service.getReportBySlug("latest"),
      ReportContentKeyMissingError,
    );
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("file object storage is idempotent but rejects an immutable overwrite", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "policy-objects-"));
  const store = new FileObjectStore(directory);

  try {
    const first = await store.putObject({
      key: "reports/v1/report.md.enc",
      body: Buffer.from("first", "utf8"),
      contentType: "application/json",
    });
    const repeated = await store.putObject({
      key: "reports/v1/report.md.enc",
      body: Buffer.from("first", "utf8"),
      contentType: "application/json",
      expectedChecksumSha256: first.checksumSha256,
    });

    assert.equal(repeated.checksumSha256, first.checksumSha256);
    await assert.rejects(
      () =>
        store.putObject({
          key: "reports/v1/report.md.enc",
          body: Buffer.from("changed", "utf8"),
          contentType: "application/json",
        }),
      ImmutableObjectConflictError,
    );
    await assert.rejects(() => store.getObject("../secret.txt"), /invalid object key/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("public report DTO matches the versioned contract and excludes storage fields", async () => {
  const meta = createReportMeta();
  const response = createReportListResponse(
    [meta],
    "https://stablecoin-policy.example",
    new Date("2026-01-01T00:00:00.000Z"),
  );
  const schemaPath = path.join(
    process.cwd(),
    "contracts",
    "v1",
    "report-list-response.schema.json",
  );
  const schema = JSON.parse(await readFile(schemaPath, "utf8")) as {
    required: string[];
    $defs: { publicReport: { required: string[] } };
  };
  const validator = createSchemaValidator().compile(schema);

  assert.equal(validator(response), true, JSON.stringify(validator.errors));
  assert.deepEqual(Object.keys(response).sort(), [...schema.required].sort());
  assert.deepEqual(
    Object.keys(response.reports[0]).sort(),
    [...schema.$defs.publicReport.required].sort(),
  );
  assert.equal(response.schemaVersion, "1.0.0");
  assert.equal(response.lastUpdated, FIXED_TIME);
  assert.equal(
    response.reports[0].fullContentUrl,
    "https://stablecoin-policy.example/api/reports/global-stablecoin-policy-report",
  );
  assert.equal("encryptedContentFile" in response.reports[0], false);
  assert.equal("artifactKey" in response.reports[0], false);
});

test("the checked-in report catalog satisfies the metadata JSON Schema", async () => {
  const [schemaRaw, catalogRaw] = await Promise.all([
    readFile(
      path.join(
        process.cwd(),
        "contracts",
        "v1",
        "report-metadata.schema.json",
      ),
      "utf8",
    ),
    readFile(path.join(process.cwd(), "data", "reports", "index.json"), "utf8"),
  ]);
  const validate = createSchemaValidator().compile(JSON.parse(schemaRaw));
  const catalog = JSON.parse(catalogRaw) as unknown[];

  for (const report of catalog) {
    assert.equal(validate(report), true, JSON.stringify(validate.errors));
  }
});

async function createReportFixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "policy-reports-"));
  const indexPath = path.join(directory, "index.json");
  const key = Buffer.alloc(32, 7);
  const meta = createReportMeta();
  const encrypted = encrypt("# Reviewed policy report\n", key);

  await writeFile(indexPath, JSON.stringify([meta]), "utf8");
  await writeFile(
    path.join(directory, meta.encryptedContentFile),
    JSON.stringify(encrypted),
    "utf8",
  );

  return { directory, indexPath, key };
}

function createReportMeta(): ReportMeta {
  return {
    slug: "global-stablecoin-policy-report",
    title: "Daily Stablecoin Policy Brief",
    summary: "Reviewed official-source update.",
    category: "policy",
    jurisdiction: ["GLOBAL"],
    publishedAt: FIXED_TIME,
    wordCount: 4,
    priceUSD: 0.1,
    encryptedContentFile: "global-stablecoin-policy-report.md.enc",
  };
}

function encrypt(content: string, key: Buffer): EncryptedReportFile {
  const iv = Buffer.alloc(12, 3);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(content, "utf8")),
    cipher.final(),
  ]);

  return {
    version: 1,
    algorithm: "aes-256-gcm",
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

function createSchemaValidator() {
  const validator = new Ajv2020({ allErrors: true, strict: true });
  addFormats(validator);
  return validator;
}
