/**
 * Targeted blurb refresher: regenerate the contextBlurb for the named
 * state files (slugs matching their JSON filenames), grounded in the
 * current legislation list. Use this when a blurb has gone stale
 * relative to the bills it's supposed to summarize.
 *
 * Run:
 *   npx tsx scripts/cleanup/refresh-blurbs.ts south-dakota texas washington
 *
 * Prints the diff per state. Bypasses the formulaic-prefix gate that
 * scripts/cleanup/rewrite-blurbs.ts uses, since stale blurbs are
 * already in editorial form.
 */

import "../env.js";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const STATES_DIR = join(ROOT, "data/legislation/states");

const MODEL = "claude-sonnet-4-6";

interface Bill {
  billCode: string;
  title: string;
  category: string;
  stage: string;
  impactTags: string[];
}

interface StateFile {
  state: string;
  stance?: string;
  contextBlurb: string;
  legislation: Bill[];
}

const client = new Anthropic();

function buildPrompt(data: StateFile): string {
  const lines = data.legislation
    .map(
      (b) =>
        `  ${b.billCode}: ${b.title} [${b.category}, stage=${b.stage}, tags: ${(b.impactTags ?? []).join(", ") || "none"}]`,
    )
    .join("\n");
  return `Write a 2–3 sentence context blurb for ${data.state}'s AI and data center policy landscape. This appears in a side panel when a user clicks the state on a map.

The state's current stance is: ${data.stance ?? "unknown"}
Bills:
${lines}

Hard rules:
- Do NOT contradict the bill list. If any bills are stage=Enacted, the blurb must NOT claim "no enacted law" / "nothing has passed" / similar.
- Do NOT start with "${data.state} has X bills" — the user can already see them.
- DO mention specific bill codes when they're significant (moratoriums, landmark legislation, enacted laws).
- DO explain what makes this state DISTINCTIVE.
- 2–3 sentences max. Plain factual prose.

Return ONLY the blurb text, no quotes or formatting.`;
}

async function refresh(slug: string) {
  const path = join(STATES_DIR, `${slug}.json`);
  const data = JSON.parse(readFileSync(path, "utf8")) as StateFile;
  const before = data.contextBlurb;
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 320,
    messages: [{ role: "user", content: buildPrompt(data) }],
  });
  const blurb = res.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("\n")
    .trim();
  if (!blurb) {
    console.warn(`  ${slug}: empty response, skipping`);
    return;
  }
  data.contextBlurb = blurb;
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
  console.log(`\n=== ${data.state} ===\nBEFORE: ${before}\nAFTER:  ${blurb}`);
}

async function main() {
  const slugs = process.argv.slice(2);
  if (slugs.length === 0) {
    console.error("usage: tsx scripts/cleanup/refresh-blurbs.ts <slug> [<slug>...]");
    process.exit(1);
  }
  for (const slug of slugs) {
    try {
      await refresh(slug);
    } catch (err) {
      console.error(`  ${slug} failed:`, (err as Error).message);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
