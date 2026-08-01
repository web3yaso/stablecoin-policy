import "../env.js";

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { JsonReportRepository } from "../../lib/data/json-report-repository.js";
import { SupabaseHttpClient, readSupabaseConfig } from "../../lib/data/supabase-client.js";
import { SupabaseReleasePublisher } from "../../lib/data/supabase-release-publisher.js";

const ROOT = process.cwd();
const DRY_RUN = process.argv.includes("--dry-run");
const REPORTS_ONLY = process.argv.includes("--reports-only");
const DATASETS_ONLY = process.argv.includes("--datasets-only");

async function main() {
  if (REPORTS_ONLY && DATASETS_ONLY) {
    throw new Error("choose at most one of --reports-only and --datasets-only");
  }

  const plan = await createPublishPlan();
  printPlan(plan);
  if (DRY_RUN) {
    console.log("phase1 publish dry-run complete; no network writes performed");
    return;
  }

  const client = new SupabaseHttpClient(readSupabaseConfig());
  const publisher = new SupabaseReleasePublisher(client);

  if (!DATASETS_ONLY) {
    for (const report of plan.reports) {
      const published = await publisher.publishReport(report.meta, report.body);
      console.log(
        `published report ${report.meta.slug} release=${published.releaseId} checksum=${published.checksumSha256}`,
      );
    }
  }

  if (!REPORTS_ONLY) {
    for (const dataset of plan.datasets) {
      const published = await publisher.publishDataset(dataset);
      console.log(
        `published dataset ${dataset.datasetId} release=${published.releaseId} checksum=${published.checksumSha256}`,
      );
    }
  }
}

async function createPublishPlan() {
  const reportsDirectory = path.join(ROOT, "data", "reports");
  const repository = new JsonReportRepository(
    path.join(reportsDirectory, "index.json"),
  );
  const reportMetadata = await repository.listReports();
  const reports = await Promise.all(
    reportMetadata.map(async (meta) => ({
      meta,
      body: new Uint8Array(
        await readFile(path.join(reportsDirectory, meta.encryptedContentFile)),
      ),
    })),
  );

  const datasets = [
    await jsonDataset(
      "news-summaries",
      "data/news/summaries.json",
      "Versioned official-source news and regional summaries",
    ),
    await jsonDataset(
      "news-source-health",
      "data/news/source-health.json",
      "Per-run official source health checkpoint",
    ),
    ...(await dailyReportDatasets()),
  ];

  return { reports, datasets };
}

async function jsonDataset(
  datasetId: string,
  relativePath: string,
  description: string,
) {
  const fullPath = path.join(ROOT, relativePath);
  const [body, fileStat] = await Promise.all([readFile(fullPath), stat(fullPath)]);
  const parsed = JSON.parse(body.toString("utf8")) as Record<string, unknown>;
  const generatedAt = firstTimestamp(
    parsed.generatedAt,
    parsed.checkedAt,
    fileStat.mtime.toISOString(),
  );
  return {
    datasetId,
    body: new Uint8Array(body),
    contentType: "application/json",
    schemaVersion: "1.0.0",
    generatedAt,
    publishedAt: generatedAt,
    description,
    metadata: { sourcePath: relativePath },
    extension: "json",
  };
}

async function dailyReportDatasets() {
  const directory = path.join(ROOT, "data", "reports", "daily");
  const names = (await readdir(directory))
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .sort();
  const releases = [];
  for (const name of names) {
    releases.push(
      await jsonDataset(
        "daily-report",
        path.posix.join("data/reports/daily", name),
        "Public preview metadata and official-source daily report snapshot",
      ),
    );
  }
  return releases;
}

function firstTimestamp(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && Number.isFinite(Date.parse(value))) {
      return new Date(value).toISOString();
    }
  }
  throw new Error("dataset has no valid generated timestamp");
}

function printPlan(plan: Awaited<ReturnType<typeof createPublishPlan>>) {
  if (!DATASETS_ONLY) {
    console.log(`phase1 publish plan: ${plan.reports.length} report artifact(s)`);
    for (const report of plan.reports) {
      console.log(`  report ${report.meta.slug}: ${report.body.byteLength} bytes`);
    }
  }
  if (!REPORTS_ONLY) {
    console.log(`phase1 publish plan: ${plan.datasets.length} dataset release(s)`);
    for (const dataset of plan.datasets) {
      console.log(
        `  dataset ${dataset.datasetId}@${dataset.generatedAt}: ${dataset.body.byteLength} bytes`,
      );
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
