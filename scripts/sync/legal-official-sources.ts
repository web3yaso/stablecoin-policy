import "../env.js";

import registryJson from "../../data/legal-corpus/source-registry.json";
import { readSupabaseConfig, SupabaseHttpClient } from "../../lib/data/supabase-client.js";
import { fetchEurLexSource } from "../../lib/legal-corpus/ingestion/eurlex.js";
import { fetchHkelSource } from "../../lib/legal-corpus/ingestion/hkel.js";
import { fetchSsoSource } from "../../lib/legal-corpus/ingestion/sso.js";
import { SupabaseOfficialSourcePublisher } from "../../lib/legal-corpus/ingestion/supabase-publisher.js";
import type { OfficialSourceRegistryEntry } from "../../lib/legal-corpus/ingestion/types.js";

const publish = process.argv.includes("--publish");
const requestedId = argumentValue("--source");

async function main() {
  const sources = registryJson.sources as OfficialSourceRegistryEntry[];
  const matching = requestedId
    ? sources.filter((source) => source.sourceId === requestedId)
    : sources;
  if (matching.length === 0) throw new Error(`unknown source: ${requestedId}`);
  const selected = requestedId
    ? matching
    : matching.filter((source) => source.ingestionState !== "BLOCKED");
  if (!requestedId) {
    for (const source of matching.filter((entry) => entry.ingestionState === "BLOCKED")) {
      console.warn(`skipped blocked source ${source.sourceId}: ${source.blocker ?? "manual review required"}`);
    }
  }

  const publisher = publish
    ? new SupabaseOfficialSourcePublisher(new SupabaseHttpClient(readSupabaseConfig()))
    : null;

  for (const source of selected) {
    const snapshot = source.provider === "eur-lex"
      ? await fetchEurLexSource(source)
      : source.provider === "hkel"
        ? await fetchHkelSource(source)
        : source.provider === "sso"
          ? await fetchSsoSource(source)
        : (() => { throw new Error(`unsupported source provider: ${source.provider}`); })();
    console.log(
      `${publish ? "publish" : "dry-run"} ${source.sourceId}: checksum=${snapshot.checksumSha256} provisions=${snapshot.provisions.length} object=${snapshot.objectKey}`,
    );
    if (publisher) {
      const versionId = await publisher.publish(snapshot);
      console.log(`ingested ${source.sourceId}: version=${versionId} state=OBSERVED`);
    }
  }

  if (!publish) console.log("no storage or database writes performed; pass --publish to ingest");
}

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
