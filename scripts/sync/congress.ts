/**
 * Congress.gov API client.
 *
 * Free tier: 5,000 requests/hour (no monthly cap).
 * This module enforces:
 *   - Hard stop at 1,000 requests per run.
 *   - Logs every 25 calls.
 *   - Persists a per-hour counter to data/meta/congress-query-count.json.
 *   - Automatically resets when the UTC hour changes.
 *
 * Set CONGRESS_API_KEY in .env.local.
 * Register at https://api.congress.gov/sign-up/
 *
 * Usage:
 *   import { fetchCongress } from "./congress.js";
 *   const data = await fetchCongress("/bill", { query: "stablecoin", limit: 20 });
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const COUNTER_PATH = join(ROOT, "data/meta/congress-query-count.json");

const BASE_URL = "https://api.congress.gov/v3";
const HARD_STOP_PER_RUN = 1000;
const HOURLY_SOFT_LIMIT = 4500;

interface CounterState {
  hour: string;
  count: number;
}

function currentHour(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}T${String(now.getUTCHours()).padStart(2, "0")}`;
}

function loadCounter(): CounterState {
  if (!existsSync(COUNTER_PATH)) {
    mkdirSync(dirname(COUNTER_PATH), { recursive: true });
    const initial: CounterState = { hour: currentHour(), count: 0 };
    writeFileSync(COUNTER_PATH, JSON.stringify(initial, null, 2));
    return initial;
  }
  const state = JSON.parse(readFileSync(COUNTER_PATH, "utf8")) as CounterState;
  if (state.hour !== currentHour()) {
    const reset: CounterState = { hour: currentHour(), count: 0 };
    writeFileSync(COUNTER_PATH, JSON.stringify(reset, null, 2));
    return reset;
  }
  return state;
}

function saveCounter(state: CounterState) {
  writeFileSync(COUNTER_PATH, JSON.stringify(state, null, 2));
}

let runCounter = 0;
let cachedHourly: CounterState | null = null;

export function ensureBudgetOk() {
  if (!cachedHourly) cachedHourly = loadCounter();
  if (cachedHourly.count >= HOURLY_SOFT_LIMIT) {
    throw new Error(
      `[congress] hourly count ${cachedHourly.count} is above soft limit ${HOURLY_SOFT_LIMIT}. Refusing to run.`,
    );
  }
}

const INTER_REQUEST_DELAY_MS = 300;
const MAX_RETRIES = 3;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchCongress<T = unknown>(
  path: string,
  params: Record<string, string | number> = {},
): Promise<T> {
  if (!cachedHourly) cachedHourly = loadCounter();

  if (runCounter >= HARD_STOP_PER_RUN) {
    throw new Error(`[congress] per-run hard stop of ${HARD_STOP_PER_RUN} hit. Aborting.`);
  }
  if (cachedHourly.count >= HOURLY_SOFT_LIMIT) {
    throw new Error(`[congress] hourly count ${cachedHourly.count} above soft limit. Aborting.`);
  }

  const key = process.env.CONGRESS_API_KEY;
  if (!key) throw new Error("[congress] CONGRESS_API_KEY not set");

  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set("api_key", key);
  url.searchParams.set("format", "json");
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }

  // Throttle between requests so Congress.gov doesn't close the connection
  await sleep(INTER_REQUEST_DELAY_MS);

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url.toString());
      runCounter += 1;
      cachedHourly.count += 1;
      saveCounter(cachedHourly);

      if (runCounter % 25 === 0 || runCounter <= 3) {
        console.log(`[congress] run ${runCounter}/${HARD_STOP_PER_RUN} · hour ${cachedHourly.count}`);
      }

      if (!res.ok) {
        throw new Error(`[congress] ${path} failed: ${res.status} ${res.statusText}`);
      }

      return res.json() as Promise<T>;
    } catch (e) {
      lastError = e as Error;
      const isTransient =
        lastError.message.includes("terminated") ||
        lastError.message.includes("ECONNRESET") ||
        lastError.message.includes("fetch failed");
      if (!isTransient || attempt === MAX_RETRIES) throw lastError;
      const backoff = attempt * 1000;
      console.warn(`[congress] attempt ${attempt} failed ("${lastError.message}"), retrying in ${backoff}ms...`);
      await sleep(backoff);
    }
  }
  throw lastError!;
}

/** Fetch all pages of a paginated endpoint, up to maxPages. */
export async function fetchCongressPaged<T = unknown>(
  path: string,
  params: Record<string, string | number> = {},
  maxPages = 5,
): Promise<T[]> {
  const limit = Number(params.limit ?? 250);
  const results: T[] = [];
  let offset = 0;

  for (let page = 0; page < maxPages; page++) {
    const data = await fetchCongress<{ pagination?: { next?: string }; [key: string]: unknown }>(
      path,
      { ...params, limit, offset },
    );

    // Congress.gov wraps results in a key named after the resource
    const key = Object.keys(data).find((k) => Array.isArray(data[k]));
    if (!key) break;
    const items = data[key] as T[];
    results.push(...items);

    if (!data.pagination?.next || items.length < limit) break;
    offset += limit;
  }

  return results;
}

export function runCount(): number {
  return runCounter;
}

export function hourCount(): number {
  return cachedHourly?.count ?? 0;
}
