// scripts/smoke/web-search-dryrun.ts
/**
 * Print the queries buildQueries() would emit against the current
 * summaries.json. Does NOT touch summaries.json.
 *
 * With --fetch: actually GET each query, parse, run Layer-1 filter
 * (same regex news-rss.ts uses for non-trusted feeds), and print
 * candidate / kept counts per query. Still does not write anything.
 */
import "../env.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildQueries, hostToEntity } from "../sync/news-web-search.js";
import { fetchFeed, parseFeed, type NewsFile } from "../sync/news-rss.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const NEWS_PATH = join(ROOT, "data/news/summaries.json");

const RELEVANCE_RE = new RegExp(
  // Mirror of news-rss.ts RELEVANCE_RE (kept minimal — this smoke only
  // needs to estimate Layer-1 survival, not be byte-identical).
  "stablecoin|stable coin|digital asset|cryptoasset|crypto-asset|virtual asset|tokenized|tokenised|e-money|MiCA|GENIUS Act|STABLE Act|payment stablecoin|reserve",
  "i",
);

async function main() {
  const news = JSON.parse(readFileSync(NEWS_PATH, "utf8")) as NewsFile;
  const plans = buildQueries(news, Date.now());
  console.log(`web-search-dryrun: ${plans.length} planned queries`);
  for (const p of plans) {
    console.log(`  [${p.kind}] (defaultEntity=${p.defaultEntity}) ${p.query}`);
  }

  if (!process.argv.includes("--fetch")) return;

  console.log("\n--fetch: running each query…");
  for (const p of plans) {
    const xml = await fetchFeed(p.url);
    if (!xml) {
      console.log(`  FAIL ${p.query}`);
      continue;
    }
    const parsed = parseFeed(xml).slice(0, 20);
    const kept = parsed.filter((item) => RELEVANCE_RE.test(item.title));
    const entityHits = parsed
      .map((item) => hostToEntity(item.link, p.defaultEntity))
      .reduce<Record<string, number>>((acc, e) => {
        acc[e] = (acc[e] ?? 0) + 1;
        return acc;
      }, {});
    const entitySummary = Object.entries(entityHits)
      .map(([e, n]) => `${e}=${n}`)
      .join(", ");
    console.log(
      `  ${p.kind.padEnd(7)} candidates=${String(parsed.length).padStart(3)} layer1_kept=${String(kept.length).padStart(3)} ${entitySummary} :: ${p.query}`,
    );
  }
}

main().catch((err) => {
  console.error("web-search-dryrun crashed:", err);
  process.exit(2);
});
