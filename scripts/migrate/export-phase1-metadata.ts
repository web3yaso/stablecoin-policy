import "../env.js";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  readSupabaseConfig,
  SupabaseHttpClient,
} from "../../lib/data/supabase-client.js";

const DEFAULT_OUTPUT =
  "/private/tmp/stablecoin-policy-pre-phase2-metadata.json";
const TABLES = [
  "storage_objects",
  "reports",
  "report_releases",
  "datasets",
  "dataset_releases",
] as const;

async function main() {
  const args = process.argv.slice(2);
  const outputPath = readOutputPath(args);
  const sourceVersionIds = readRepeatedValues(args, "--source-version");
  const config = readSupabaseConfig();
  const client = new SupabaseHttpClient(config);
  const tables: Record<string, unknown[]> = {};

  for (const table of TABLES) {
    tables[table] = await client.rest<unknown[]>(`${table}?select=*`);
  }
  const sourceVersions = await Promise.all(
    sourceVersionIds.map((versionId) =>
      client.rpc<Record<string, unknown> | null>(
        "get_official_source_ingestion_status",
        { p_version_id: versionId },
      )
    ),
  );

  const backup = {
    formatVersion: "1.0.0",
    exportedAt: new Date().toISOString(),
    projectHost: new URL(config.url).hostname,
    tables,
    sourceVersions,
  };
  const body = `${JSON.stringify(backup, null, 2)}\n`;
  await writeFile(outputPath, body, { encoding: "utf8", mode: 0o600 });

  const counts = Object.fromEntries(
    Object.entries(tables).map(([table, rows]) => [table, rows.length]),
  );
  console.log(
    JSON.stringify({
      outputPath,
      checksumSha256: createHash("sha256").update(body).digest("hex"),
      counts,
      sourceVersionCount: sourceVersions.length,
    }),
  );
}

function readRepeatedValues(args: string[], name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== name) continue;
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
    values.push(value);
    index += 1;
  }
  return values;
}

function readOutputPath(args: string[]): string {
  const outputIndex = args.indexOf("--output");
  const raw = outputIndex >= 0 ? args[outputIndex + 1] : DEFAULT_OUTPUT;
  if (!raw || !path.isAbsolute(raw)) {
    throw new Error("backup output must be an absolute path");
  }
  return path.normalize(raw);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
