/**
 * OpenStates API v3 client.
 *
 * Free tier: 500 requests/day, ~1 request/second burst limit.
 * Set OPENSTATES_API_KEY (or STATE_API_KEY) in .env.local.
 * Register at https://openstates.org/accounts/profile/
 *
 * Docs: https://docs.openstates.org/api-v3/
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const COUNTER_PATH = join(ROOT, "data/meta/openstates-query-count.json");

const BASE_URL = "https://v3.openstates.org";
const DAILY_SOFT_LIMIT = 225; // actual free tier limit is 250/day
const HARD_STOP_PER_RUN = 200;
// Free tier: 10 req/min. 7s spacing keeps us safely under that limit.
const INTER_REQUEST_DELAY_MS = 7000;
const MAX_RETRIES = 4;
// On 429, wait >60s to clear the rate-limit window (respects Retry-After if present).
const RATE_LIMIT_BACKOFF_MS = 65_000;

interface CounterState { day: string; count: number }

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function loadCounter(): CounterState {
  if (!existsSync(COUNTER_PATH)) {
    mkdirSync(dirname(COUNTER_PATH), { recursive: true });
    const s = { day: today(), count: 0 };
    writeFileSync(COUNTER_PATH, JSON.stringify(s, null, 2));
    return s;
  }
  const s = JSON.parse(readFileSync(COUNTER_PATH, "utf8")) as CounterState;
  if (s.day !== today()) {
    const reset = { day: today(), count: 0 };
    writeFileSync(COUNTER_PATH, JSON.stringify(reset, null, 2));
    return reset;
  }
  return s;
}

function saveCounter(s: CounterState) {
  writeFileSync(COUNTER_PATH, JSON.stringify(s, null, 2));
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

let runCounter = 0;
let cachedDaily: CounterState | null = null;

export function ensureBudgetOk() {
  if (!cachedDaily) cachedDaily = loadCounter();
  if (cachedDaily.count >= DAILY_SOFT_LIMIT) {
    throw new Error(`[openstates] daily count ${cachedDaily.count} above soft limit ${DAILY_SOFT_LIMIT}.`);
  }
}

export async function fetchOpenStates<T = unknown>(
  path: string,
  params: Record<string, string | number> = {},
): Promise<T> {
  if (!cachedDaily) cachedDaily = loadCounter();
  if (runCounter >= HARD_STOP_PER_RUN) throw new Error(`[openstates] per-run hard stop hit.`);
  if (cachedDaily.count >= DAILY_SOFT_LIMIT) throw new Error(`[openstates] daily limit reached.`);

  const key = process.env.STATE_API_KEY ?? process.env.OPENSTATES_API_KEY;
  if (!key) throw new Error("[openstates] STATE_API_KEY not set");

  const url = new URL(`${BASE_URL}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  await sleep(INTER_REQUEST_DELAY_MS);

  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    let res: Response;
    try {
      res = await fetch(url.toString(), { headers: { "X-API-KEY": key } });
    } catch (e) {
      lastErr = e as Error;
      const transient = lastErr.message.includes("terminated") || lastErr.message.includes("ECONNRESET") || lastErr.message.includes("fetch failed");
      if (!transient || attempt === MAX_RETRIES) throw lastErr;
      await sleep(attempt * 1000);
      continue;
    }

    // Count every response (429 included) against daily quota
    runCounter += 1;
    cachedDaily.count += 1;
    saveCounter(cachedDaily);

    if (runCounter % 20 === 0 || runCounter <= 2) {
      console.log(`[openstates] run ${runCounter}/${HARD_STOP_PER_RUN} · day ${cachedDaily.count}`);
    }

    if (res.status === 429) {
      const retryAfter = res.headers.get("Retry-After");
      const waitMs = retryAfter ? Number(retryAfter) * 1000 : RATE_LIMIT_BACKOFF_MS;
      console.warn(`[openstates] 429 rate-limited on attempt ${attempt} — waiting ${waitMs / 1000}s...`);
      if (attempt === MAX_RETRIES) throw new Error(`[openstates] ${path} → 429 Too Many Requests (exhausted retries)`);
      await sleep(waitMs);
      continue;
    }

    // 502/503/504 are transient server errors — retry with backoff
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      const waitMs = attempt * 10_000;
      console.warn(`[openstates] ${res.status} on attempt ${attempt} — retrying in ${waitMs / 1000}s...`);
      if (attempt === MAX_RETRIES) throw new Error(`[openstates] ${path} → ${res.status} ${res.statusText} (exhausted retries)`);
      await sleep(waitMs);
      continue;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`[openstates] ${path} → ${res.status} ${res.statusText}\n${body}`);
    }
    return res.json() as Promise<T>;
  }
  throw lastErr ?? new Error(`[openstates] ${path} failed after ${MAX_RETRIES} attempts`);
}

export function runCount() { return runCounter; }
export function dayCount() { return cachedDaily?.count ?? 0; }
