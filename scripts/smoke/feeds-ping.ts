// scripts/smoke/feeds-ping.ts
/**
 * Health-check every feed in data/news/feeds.json.
 *
 * - Direct RSS feeds: HEAD must return 2xx OR the body must contain at least
 *   one <item>/<entry>.
 * - Google News RSS feeds (URL host news.google.com): GET and require at
 *   least 1 <item>.
 *
 * Exits non-zero if any feed fails so this can run on CI.
 */
import "../env.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const FEEDS_PATH = join(ROOT, "data/news/feeds.json");
const TIMEOUT_MS = 15_000;
const USER_AGENT = "gov-index/1.0 (rss feed smoke)";

interface FeedConfig {
  url: string;
  name: string;
  entity: string;
  topicHint?: string;
  trustedSource?: boolean;
}
interface FeedsFile { feeds: FeedConfig[]; }

async function check(feed: FeedConfig): Promise<{ ok: boolean; status: string; items: number }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(feed.url, {
      signal: ctl.signal,
      redirect: "follow",
      headers: {
        "user-agent": USER_AGENT,
        accept: "application/rss+xml,application/atom+xml,application/xml,text/xml,*/*",
      },
    });
    if (!res.ok) return { ok: false, status: `HTTP ${res.status}`, items: 0 };
    const body = await res.text();
    const items = (body.match(/<item\b/gi)?.length ?? 0) + (body.match(/<entry\b/gi)?.length ?? 0);
    return { ok: items > 0, status: items > 0 ? `HTTP ${res.status}` : `HTTP ${res.status} (0 items)`, items };
  } catch (err) {
    return { ok: false, status: (err as Error).name === "AbortError" ? "TIMEOUT" : `ERR ${(err as Error).message}`, items: 0 };
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  const feeds = (JSON.parse(readFileSync(FEEDS_PATH, "utf8")) as FeedsFile).feeds;
  console.log(`feeds-ping: checking ${feeds.length} feed(s)`);
  let failures = 0;
  // Light concurrency to be polite.
  const CONCURRENCY = 6;
  const results: { feed: FeedConfig; result: Awaited<ReturnType<typeof check>> }[] = [];
  let i = 0;
  const runners: Promise<void>[] = [];
  for (let k = 0; k < Math.min(CONCURRENCY, feeds.length); k++) {
    runners.push((async () => {
      while (i < feeds.length) {
        const idx = i++;
        const feed = feeds[idx];
        const result = await check(feed);
        results.push({ feed, result });
        if (!result.ok) failures++;
        const flag = feed.trustedSource ? " [trusted]" : "";
        console.log(`  ${result.ok ? "OK  " : "FAIL"} items=${String(result.items).padStart(3, " ")} ${result.status.padEnd(20, " ")} ${feed.name}${flag}`);
      }
    })());
  }
  await Promise.all(runners);
  console.log(`feeds-ping: ${results.length - failures}/${results.length} ok, ${failures} failure(s)`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error("feeds-ping crashed:", err);
  process.exit(2);
});
