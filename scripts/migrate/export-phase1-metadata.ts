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
  const outputPath = readOutputPath(process.argv.slice(2));
  const config = readSupabaseConfig();
  const client = new SupabaseHttpClient(config);
  const tables: Record<string, unknown[]> = {};

  for (const table of TABLES) {
    tables[table] = await client.rest<unknown[]>(`${table}?select=*`);
  }

  const backup = {
    formatVersion: "1.0.0",
    exportedAt: new Date().toISOString(),
    projectHost: new URL(config.url).hostname,
    tables,
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
    }),
  );
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
