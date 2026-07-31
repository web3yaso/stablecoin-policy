// scripts/smoke/news-rss-dryrun.ts
/**
 * Exercise the full news-rss.ts pipeline (official feeds + professional
 * APIs → Layer-1 filter → version-aware dedupe) WITHOUT making any LLM call or writing
 * any tracked file. Sets NEWS_RSS_DRY_RUN=1 and NEWS_RSS_SKIP_AUTORUN=1
 * before importing news-rss.ts, then explicitly invokes the exported
 * run() function.
 *
 * Use this to verify the news pipeline end-to-end during development
 * without burning model budget.
 */
import "./skip-autorun.js";
import "../env.js";

const TMP = process.env.TMPDIR ?? "/tmp";

async function main() {
  process.env.NEWS_RSS_DRY_RUN = "1";
  const mod = await import("../sync/news-rss.js");
  if (typeof (mod as { run?: () => Promise<void> }).run !== "function") {
    throw new Error("news-rss.ts must export run()");
  }
  await (mod as { run: () => Promise<void> }).run();
  console.log(`news-rss-dryrun smoke: candidates written under ${TMP}/news-rss-dryrun-*.json`);
}

main().catch((err) => {
  console.error("news-rss-dryrun smoke crashed:", err);
  process.exit(2);
});
