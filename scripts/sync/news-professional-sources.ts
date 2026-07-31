/**
 * Structured first-party discovery for the stablecoin policy news pipeline.
 *
 * This module deliberately has no runtime import from news-rss.ts. Its only
 * dependency on that module is the PendingItem type, which prevents the
 * news-rss -> professional-sources -> news-rss cycle that would otherwise
 * occur when news-rss invokes runProfessionalSources().
 *
 * Sources:
 *   - Federal Register (no key)
 *   - Regulations.gov (any configured api.data.gov key; optional)
 *   - GovInfo Search + Congress.gov (any api.data.gov key; optional)
 *   - legislation.gov.uk full-text search (no key)
 *   - Financial Services Agency, Japan official press-release index (no key)
 *
 * Every source fails softly. A failed or unconfigured source is represented
 * in `results`; candidates from the remaining sources are still returned.
 */

import "../env.js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PendingItem } from "./news-rss.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const CONFIG_PATH = join(ROOT, "data/news/professional-sources.json");
const FETCH_TIMEOUT_MS = 15_000;
const DETAIL_CONCURRENCY = 4;
const DAY_MS = 24 * 60 * 60 * 1000;

type ProfessionalSourceId =
  | "federal-register"
  | "regulations-gov"
  | "us-congress"
  | "uk-legislation"
  | "japan-fsa";

interface ProfessionalSourceConfig {
  id: ProfessionalSourceId;
  enabled?: boolean;
  queryTerms: string[];
  lookbackDays: number;
  maxItems: number;
}

interface ProfessionalSourcesConfigFile {
  version: number;
  sources: ProfessionalSourceConfig[];
}

type ProfessionalSourceStatus = "ok" | "partial" | "skipped" | "failed";

export interface ProfessionalSourceResult {
  sourceId: ProfessionalSourceId;
  status: ProfessionalSourceStatus;
  queryCount: number;
  rawItemCount: number;
  candidateCount: number;
  mergedIntoOtherSources: number;
  durationMs: number;
  errors: string[];
  note?: string;
}

export interface ProfessionalSourcesRun {
  candidates: PendingItem[];
  results: ProfessionalSourceResult[];
}

interface AdapterOutput {
  candidates: PendingItem[];
  queryCount: number;
  rawItemCount: number;
  errors: string[];
  skippedReason?: string;
}

interface ProfessionalFeedMetadata {
  sourceId: ProfessionalSourceId;
  sourceType: "official-api";
  sourceAuthority: string;
}

interface ProfessionalParsedMetadata {
  contentText?: string;
  prequalified?: boolean;
  officialDocumentId?: string;
  sourceVersion?: string;
  documentType?: string;
  officialPdfUrl?: string;
  commentCloseDate?: string;
  openForComment?: boolean;
  retrievedAt?: string;
  federalRegisterNumber?: string;
  relatedDocumentIds?: string[];
}

type ProfessionalCandidate = PendingItem & {
  feed: PendingItem["feed"] & ProfessionalFeedMetadata;
  parsed: PendingItem["parsed"] & ProfessionalParsedMetadata;
};

type Adapter = (
  config: ProfessionalSourceConfig,
  runAt: Date,
) => Promise<AdapterOutput>;

const SOURCE_IDS = new Set<ProfessionalSourceId>([
  "federal-register",
  "regulations-gov",
  "us-congress",
  "uk-legislation",
  "japan-fsa",
]);

function readConfig(): ProfessionalSourcesConfigFile {
  const parsed = JSON.parse(
    readFileSync(CONFIG_PATH, "utf8"),
  ) as Partial<ProfessionalSourcesConfigFile>;

  if (parsed.version !== 1 || !Array.isArray(parsed.sources)) {
    throw new Error("professional-sources config must have version=1 and a sources array");
  }

  const seen = new Set<string>();
  const sources = parsed.sources.map((raw, index) => {
    if (!raw || typeof raw !== "object") {
      throw new Error(`professional-sources config entry ${index} is not an object`);
    }
    if (!SOURCE_IDS.has(raw.id)) {
      throw new Error(`professional-sources config entry ${index} has unknown id "${String(raw.id)}"`);
    }
    if (seen.has(raw.id)) {
      throw new Error(`professional-sources config has duplicate source "${raw.id}"`);
    }
    seen.add(raw.id);

    const queryTerms = Array.isArray(raw.queryTerms)
      ? raw.queryTerms
          .filter((term): term is string => typeof term === "string")
          .map((term) => term.trim())
          .filter(Boolean)
      : [];
    if (queryTerms.length === 0) {
      throw new Error(`professional source "${raw.id}" needs at least one query term`);
    }

    const lookbackDays = Number(raw.lookbackDays);
    const maxItems = Number(raw.maxItems);
    if (!Number.isFinite(lookbackDays) || lookbackDays < 1) {
      throw new Error(`professional source "${raw.id}" has invalid lookbackDays`);
    }
    if (!Number.isFinite(maxItems) || maxItems < 1) {
      throw new Error(`professional source "${raw.id}" has invalid maxItems`);
    }

    return {
      id: raw.id,
      enabled: raw.enabled !== false,
      queryTerms,
      lookbackDays: Math.min(3_650, Math.floor(lookbackDays)),
      maxItems: Math.min(200, Math.floor(maxItems)),
    };
  });

  return { version: 1, sources };
}

function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().includes("key") || key.toLowerCase().includes("token")) {
        url.searchParams.set(key, "REDACTED");
      }
    }
    return url.toString();
  } catch {
    return raw.replace(/(api[_-]?key=)[^&\s]+/gi, "$1REDACTED");
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") {
    return `request timed out after ${FETCH_TIMEOUT_MS}ms`;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

async function fetchJson<T>(
  rawUrl: string,
  init: RequestInit = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(rawUrl, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...init.headers,
      },
    });
    if (!response.ok) {
      throw new Error(
        `${response.status} ${response.statusText} from ${redactUrl(rawUrl)}`,
      );
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(
  rawUrl: string,
  init: RequestInit = {},
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(rawUrl, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml,text/plain,*/*",
        ...init.headers,
      },
    });
    if (!response.ok) {
      throw new Error(
        `${response.status} ${response.statusText} from ${redactUrl(rawUrl)}`,
      );
    }
    return response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function mapPool<T, R>(
  values: T[],
  concurrency: number,
  worker: (value: T) => Promise<R>,
): Promise<R[]> {
  if (values.length === 0) return [];
  const output = new Array<R>(values.length);
  let cursor = 0;
  const runners = Array.from(
    { length: Math.min(Math.max(1, concurrency), values.length) },
    async () => {
      while (cursor < values.length) {
        const index = cursor++;
        output[index] = await worker(values[index]);
      }
    },
  );
  await Promise.all(runners);
  return output;
}

function cutoffDate(runAt: Date, lookbackDays: number): Date {
  return new Date(runAt.getTime() - lookbackDays * DAY_MS);
}

function isWithinLookback(raw: unknown, cutoff: Date): boolean {
  if (typeof raw !== "string" || !raw.trim()) return false;
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) && timestamp >= cutoff.getTime();
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function stringValues(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => (typeof item === "string" ? [item] : []));
  }
  return typeof value === "string" ? [value] : [];
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, value: string) =>
      String.fromCodePoint(Number(value)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, value: string) =>
      String.fromCodePoint(Number.parseInt(value, 16)),
    )
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function cleanText(value: unknown): string {
  if (typeof value !== "string") return "";
  return decodeEntities(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function joinText(...values: unknown[]): string {
  const parts = uniqueStrings(values.map(cleanText).filter(Boolean));
  return parts.join("\n\n").slice(0, 12_000);
}

function normalizedTerm(term: string): string {
  return term
    .toLowerCase()
    .replace(/[“”"'`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDocumentType(raw: unknown): string {
  const value = cleanText(raw).toLowerCase();
  if (!value) return "official-document";
  if (value === "rule" || value.includes("final rule")) return "rule";
  if (
    value === "prorule" ||
    value.includes("proposed rule") ||
    value.includes("proposed-rule")
  ) {
    return "proposed-rule";
  }
  if (value === "presdocu" || value.includes("presidential")) {
    return "presidential-document";
  }
  if (value.includes("notice")) return "notice";
  if (value.includes("supporting")) return "supporting-material";
  if (value.includes("act")) return "act";
  if (value.includes("bill")) return "bill";
  return value.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function dateOnly(raw: unknown): string | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString().slice(0, 10);
}

function isCommentOpen(
  closeDate: string | undefined,
  runAt: Date,
  explicit?: boolean,
): boolean | undefined {
  if (explicit === false) return false;
  if (closeDate) {
    const close = Date.parse(`${closeDate}T23:59:59Z`);
    if (Number.isFinite(close)) return close >= runAt.getTime();
  }
  return explicit;
}

function hasCommentDeadlinePassed(
  closeDate: string | undefined,
  runAt: Date,
): boolean {
  if (!closeDate) return false;
  const close = Date.parse(`${closeDate}T23:59:59Z`);
  return Number.isFinite(close) && close < runAt.getTime();
}

function commentStateVersion(
  closeDate: string | undefined,
  openForComment: boolean | undefined,
): string[] {
  return uniqueStrings([
    closeDate ? `comment-close:${closeDate}` : undefined,
    typeof openForComment === "boolean"
      ? `comment-state:${openForComment ? "open" : "closed"}`
      : undefined,
  ]);
}

function makeCandidate(args: {
  feedUrl: string;
  feedName: string;
  entity: string;
  sourceId: ProfessionalSourceId;
  sourceAuthority: string;
  title: string;
  link: string;
  pubDate: string;
  metadata: ProfessionalParsedMetadata;
}): PendingItem {
  const candidate: ProfessionalCandidate = {
    feed: {
      url: args.feedUrl,
      name: args.feedName,
      entity: args.entity,
      topicHint: "stablecoin-policy",
      trustedSource: true,
      sourceId: args.sourceId,
      sourceType: "official-api",
      sourceAuthority: args.sourceAuthority,
    },
    parsed: {
      title: args.title,
      link: args.link,
      pubDate: args.pubDate,
      ...args.metadata,
    },
  };
  return candidate;
}

function viewCandidate(item: PendingItem): ProfessionalCandidate {
  return item as ProfessionalCandidate;
}

function candidateKey(item: PendingItem): string {
  const { feed, parsed } = viewCandidate(item);
  if (parsed.officialDocumentId) {
    return [
      feed.sourceId,
      parsed.officialDocumentId,
      parsed.sourceVersion ?? "unversioned",
    ].join(":");
  }
  return `${feed.sourceId}:${parsed.link}`;
}

function dedupeAndLimit(
  candidates: PendingItem[],
  maxItems: number,
): PendingItem[] {
  const deduped = new Map<string, PendingItem>();
  for (const candidate of candidates) {
    const key = candidateKey(candidate);
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, candidate);
      continue;
    }
    const oldDate = Date.parse(existing.parsed.pubDate) || 0;
    const newDate = Date.parse(candidate.parsed.pubDate) || 0;
    if (newDate > oldDate) deduped.set(key, candidate);
  }
  return [...deduped.values()]
    .sort(
      (left, right) =>
        (Date.parse(right.parsed.pubDate) || 0) -
        (Date.parse(left.parsed.pubDate) || 0),
    )
    .slice(0, maxItems);
}

function collectDocumentNumbers(value: unknown, out = new Set<string>()): string[] {
  if (!value || typeof value !== "object") return [...out];
  if (Array.isArray(value)) {
    for (const item of value) collectDocumentNumbers(item, out);
    return [...out];
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (
      ["document_number", "documentNumber", "frDocNum"].includes(key) &&
      typeof nested === "string" &&
      nested.trim()
    ) {
      out.add(nested.trim());
      continue;
    }
    if (nested && typeof nested === "object") collectDocumentNumbers(nested, out);
  }
  return [...out];
}

function findPdfUrl(value: unknown, depth = 0): string | undefined {
  if (depth > 5 || value == null) return undefined;
  if (typeof value === "string") {
    if (/^https?:\/\//i.test(value) && /\.pdf(?:$|[?#])/i.test(value)) {
      return value;
    }
    return undefined;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findPdfUrl(item, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof value === "object") {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      const found = findPdfUrl(nested, depth + 1);
      if (found) return found;
    }
  }
  return undefined;
}

// ─── Federal Register ────────────────────────────────────────────────────────

interface FederalRegisterAgency {
  name?: string;
  raw_name?: string;
  slug?: string;
}

interface FederalRegisterDocument {
  title?: string;
  abstract?: string;
  action?: string;
  type?: string;
  document_number?: string;
  citation?: string;
  publication_date?: string;
  effective_on?: string;
  comments_close_on?: string;
  html_url?: string;
  pdf_url?: string;
  raw_text_url?: string;
  full_text_xml_url?: string;
  excerpts?: string[] | string;
  agencies?: FederalRegisterAgency[];
  docket_ids?: string[];
  regulation_id_numbers?: string[];
  correction_of?: unknown;
  corrections?: unknown;
}

interface FederalRegisterSearchResponse {
  count?: number;
  results?: FederalRegisterDocument[];
}

const FEDERAL_REGISTER_FIELDS = [
  "title",
  "abstract",
  "action",
  "type",
  "document_number",
  "citation",
  "publication_date",
  "effective_on",
  "comments_close_on",
  "html_url",
  "pdf_url",
  "raw_text_url",
  "full_text_xml_url",
  "excerpts",
  "agencies",
  "docket_ids",
  "regulation_id_numbers",
  "correction_of",
  "corrections",
];

async function runFederalRegister(
  config: ProfessionalSourceConfig,
  runAt: Date,
): Promise<AdapterOutput> {
  const errors: string[] = [];
  const rawDocuments: FederalRegisterDocument[] = [];
  const cutoff = cutoffDate(runAt, config.lookbackDays);

  const queryOutputs = await Promise.all(
    config.queryTerms.map(async (term) => {
      const url = new URL("https://www.federalregister.gov/api/v1/documents.json");
      url.searchParams.set("conditions[term]", term);
      url.searchParams.set(
        "conditions[publication_date][gte]",
        cutoff.toISOString().slice(0, 10),
      );
      url.searchParams.set("order", "newest");
      url.searchParams.set("per_page", String(Math.min(1_000, config.maxItems)));
      for (const field of FEDERAL_REGISTER_FIELDS) {
        url.searchParams.append("fields[]", field);
      }
      try {
        const response = await fetchJson<FederalRegisterSearchResponse>(
          url.toString(),
        );
        return response.results ?? [];
      } catch (error) {
        errors.push(`query "${term}": ${errorMessage(error)}`);
        return [];
      }
    }),
  );
  rawDocuments.push(...queryOutputs.flat());

  const retrievedAt = runAt.toISOString();
  const candidates = rawDocuments.flatMap<PendingItem>((document) => {
    const documentNumber = asString(document.document_number);
    const title = cleanText(document.title);
    const publicationDate = dateOnly(document.publication_date);
    const link = asString(document.html_url);
    if (!documentNumber || !title || !publicationDate || !link) return [];
    if (!isWithinLookback(document.publication_date, cutoff)) return [];

    const agencyNames = uniqueStrings(
      (document.agencies ?? []).map(
        (agency) => asString(agency.name) ?? asString(agency.raw_name),
      ),
    );
    const relatedDocumentIds = uniqueStrings([
      ...collectDocumentNumbers(document.correction_of),
      ...collectDocumentNumbers(document.corrections),
      ...(document.docket_ids ?? []),
      ...(document.regulation_id_numbers ?? []),
    ]).filter((id) => id !== documentNumber);
    const commentCloseDate = dateOnly(document.comments_close_on);
    const openForComment = isCommentOpen(commentCloseDate, runAt);
    const sourceVersion = uniqueStrings([
      publicationDate,
      ...commentStateVersion(commentCloseDate, openForComment),
    ]).join("@");
    const eventDate = hasCommentDeadlinePassed(commentCloseDate, runAt)
      ? latestDate([publicationDate, commentCloseDate]) ?? publicationDate
      : publicationDate;

    return [
      makeCandidate({
        feedUrl: "https://www.federalregister.gov/developers/documentation/api/v1",
        feedName: agencyNames.length
          ? `Federal Register — ${agencyNames.join(", ")}`
          : "Federal Register",
        entity: "United States",
        sourceId: "federal-register",
        sourceAuthority:
          "Office of the Federal Register / National Archives and Records Administration",
        title,
        link,
        pubDate: eventDate,
        metadata: {
          contentText: joinText(
            title,
            document.abstract,
            document.action,
            ...stringValues(document.excerpts),
            document.citation,
            agencyNames.join(", "),
          ),
          prequalified: true,
          officialDocumentId: documentNumber,
          sourceVersion,
          documentType: normalizeDocumentType(document.type),
          officialPdfUrl: asString(document.pdf_url),
          commentCloseDate,
          openForComment,
          retrievedAt,
          federalRegisterNumber: documentNumber,
          relatedDocumentIds,
        },
      }),
    ];
  });

  return {
    candidates: dedupeAndLimit(candidates, config.maxItems),
    queryCount: config.queryTerms.length,
    rawItemCount: rawDocuments.length,
    errors,
  };
}

// ─── Regulations.gov ────────────────────────────────────────────────────────

interface RegulationsDocumentAttributes {
  title?: string;
  docAbstract?: string;
  summary?: string;
  agencyId?: string;
  docketId?: string;
  documentType?: string;
  subtype?: string;
  postedDate?: string;
  lastModifiedDate?: string;
  commentStartDate?: string;
  commentEndDate?: string;
  openForComment?: boolean;
  frDocNum?: string;
  withdrawn?: boolean;
  [key: string]: unknown;
}

interface RegulationsDocumentResource {
  id?: string;
  type?: string;
  attributes?: RegulationsDocumentAttributes;
  [key: string]: unknown;
}

interface RegulationsSearchResponse {
  data?: RegulationsDocumentResource[];
  included?: unknown[];
  meta?: Record<string, unknown>;
}

interface RegulationsDetailResponse {
  data?: RegulationsDocumentResource;
  included?: unknown[];
}

function regulationsKey(): string | undefined {
  return (
    asString(process.env.REGULATIONS_API_KEY) ??
    asString(process.env.CONGRESS_API_KEY) ??
    asString(process.env.GOVINFO_API_KEY)
  );
}

async function regulationsJson<T>(
  rawUrl: string,
  key: string,
): Promise<T> {
  const url = new URL(rawUrl);
  url.searchParams.set("api_key", key);
  return fetchJson<T>(url.toString());
}

async function runRegulationsGov(
  config: ProfessionalSourceConfig,
  runAt: Date,
): Promise<AdapterOutput> {
  const key = regulationsKey();
  if (!key) {
    return {
      candidates: [],
      queryCount: 0,
      rawItemCount: 0,
      errors: [],
      skippedReason:
        "REGULATIONS_API_KEY, CONGRESS_API_KEY, and GOVINFO_API_KEY are unavailable",
    };
  }

  const errors: string[] = [];
  const cutoff = cutoffDate(runAt, config.lookbackDays);
  const rawResources: RegulationsDocumentResource[] = [];

  const queryOutputs = await Promise.all(
    config.queryTerms.map(async (term) => {
      const url = new URL("https://api.regulations.gov/v4/documents");
      url.searchParams.set("filter[searchTerm]", term);
      url.searchParams.set(
        "filter[postedDate][ge]",
        cutoff.toISOString().slice(0, 10),
      );
      url.searchParams.set(
        "filter[postedDate][le]",
        runAt.toISOString().slice(0, 10),
      );
      url.searchParams.set("sort", "-postedDate");
      url.searchParams.set("page[number]", "1");
      url.searchParams.set(
        "page[size]",
        String(Math.min(250, config.maxItems)),
      );
      try {
        const response = await regulationsJson<RegulationsSearchResponse>(
          url.toString(),
          key,
        );
        return response.data ?? [];
      } catch (error) {
        errors.push(`query "${term}": ${errorMessage(error)}`);
        return [];
      }
    }),
  );
  rawResources.push(...queryOutputs.flat());

  const distinct = new Map<string, RegulationsDocumentResource>();
  for (const resource of rawResources) {
    const id = asString(resource.id);
    if (id && !distinct.has(id)) distinct.set(id, resource);
  }
  const selected = [...distinct.values()]
    .filter((resource) =>
      isWithinLookback(resource.attributes?.postedDate, cutoff),
    )
    .sort(
      (left, right) =>
        (Date.parse(right.attributes?.postedDate ?? "") || 0) -
        (Date.parse(left.attributes?.postedDate ?? "") || 0),
    )
    .slice(0, config.maxItems);

  const enriched = await mapPool(
    selected,
    DETAIL_CONCURRENCY,
    async (summary): Promise<{
      summary: RegulationsDocumentResource;
      detail?: RegulationsDetailResponse;
    }> => {
      const id = asString(summary.id);
      if (!id) return { summary };
      try {
        const detail = await regulationsJson<RegulationsDetailResponse>(
          `https://api.regulations.gov/v4/documents/${encodeURIComponent(id)}`,
          key,
        );
        return { summary, detail };
      } catch (error) {
        errors.push(`document ${id}: ${errorMessage(error)}`);
        return { summary };
      }
    },
  );

  const retrievedAt = runAt.toISOString();
  const candidates = enriched.flatMap<PendingItem>(({ summary, detail }) => {
    const resource = detail?.data ?? summary;
    const id = asString(resource.id) ?? asString(summary.id);
    const attributes = {
      ...(summary.attributes ?? {}),
      ...(resource.attributes ?? {}),
    };
    const title = cleanText(attributes.title);
    const postedDate = dateOnly(attributes.postedDate);
    if (!id || !title || !postedDate) return [];

    const commentCloseDate = dateOnly(attributes.commentEndDate);
    const federalRegisterNumber = asString(attributes.frDocNum);
    const baseSourceVersion =
      asString(attributes.lastModifiedDate) ??
      asString(attributes.postedDate) ??
      postedDate;
    const openForComment = isCommentOpen(
      commentCloseDate,
      runAt,
      asBoolean(attributes.openForComment),
    );
    const sourceVersion = uniqueStrings([
      baseSourceVersion,
      ...commentStateVersion(commentCloseDate, openForComment),
    ]).join("@");
    const lastModifiedDate = dateOnly(attributes.lastModifiedDate);
    const eventDate =
      latestDate([
        postedDate,
        lastModifiedDate,
        hasCommentDeadlinePassed(commentCloseDate, runAt)
          ? commentCloseDate
          : undefined,
      ]) ?? postedDate;
    const relatedDocumentIds = uniqueStrings([
      asString(attributes.docketId),
      ...collectDocumentNumbers(detail?.included),
    ]).filter((relatedId) => relatedId !== id);

    return [
      makeCandidate({
        feedUrl: "https://open.gsa.gov/api/regulationsgov/",
        feedName: attributes.agencyId
          ? `Regulations.gov — ${attributes.agencyId}`
          : "Regulations.gov",
        entity: "United States",
        sourceId: "regulations-gov",
        sourceAuthority:
          "Regulations.gov / U.S. General Services Administration",
        title,
        link: `https://www.regulations.gov/document/${encodeURIComponent(id)}`,
        pubDate: eventDate,
        metadata: {
          contentText: joinText(
            title,
            attributes.docAbstract,
            attributes.summary,
            attributes.highlightedContent,
            attributes.subtype,
            attributes.documentType,
            attributes.agencyId,
            attributes.docketId,
            commentCloseDate
              ? `Comment deadline: ${commentCloseDate}`
              : undefined,
            typeof attributes.openForComment === "boolean"
              ? `Open for comment: ${String(attributes.openForComment)}`
              : undefined,
          ),
          prequalified: true,
          officialDocumentId: id,
          sourceVersion,
          documentType: normalizeDocumentType(attributes.documentType),
          officialPdfUrl: findPdfUrl(detail),
          commentCloseDate,
          openForComment,
          retrievedAt,
          federalRegisterNumber,
          relatedDocumentIds,
        },
      }),
    ];
  });

  return {
    candidates: dedupeAndLimit(candidates, config.maxItems),
    queryCount: config.queryTerms.length,
    rawItemCount: rawResources.length,
    errors,
  };
}

// ─── U.S. Congress: GovInfo discovery + Congress.gov state ──────────────────

interface CongressBill {
  congress?: number;
  type?: string;
  number?: string;
  title?: string;
  introducedDate?: string;
  updateDate?: string;
  updateDateIncludingText?: string;
  url?: string;
  latestAction?: {
    actionDate?: string;
    text?: string;
  };
  policyArea?: {
    name?: string;
  };
  sponsors?: Array<{
    fullName?: string;
    party?: string;
    state?: string;
  }>;
  laws?: Array<{
    type?: string;
    number?: string;
  }>;
}

interface CongressBillDetailResponse {
  bill?: CongressBill;
}

interface CongressSummary {
  actionDate?: string;
  actionDesc?: string;
  text?: string;
  updateDate?: string;
  versionCode?: string;
}

interface CongressSummariesResponse {
  summaries?: CongressSummary[];
}

interface GovInfoDownloadLinks {
  pdfLink?: string;
  txtLink?: string;
  xmlLink?: string;
  modsLink?: string;
  premisLink?: string;
  zipLink?: string;
}

interface GovInfoSearchResult {
  title?: string;
  packageId?: string;
  lastModified?: string;
  dateIssued?: string;
  dateIngested?: string;
  collectionCode?: string;
  governmentAuthor?: string[];
  download?: GovInfoDownloadLinks;
  relatedLink?: string;
  resultLink?: string;
}

interface GovInfoSearchResponse {
  count?: number;
  nextOffsetMark?: string;
  results?: GovInfoSearchResult[];
}

interface GovInfoBillReference {
  packageId: string;
  congress: number;
  type: string;
  number: string;
  versionCode: string;
}

function govInfoApiKey(): string | undefined {
  return (
    asString(process.env.GOVINFO_API_KEY) ??
    asString(process.env.CONGRESS_API_KEY) ??
    asString(process.env.REGULATIONS_API_KEY)
  );
}

function congressApiKey(): string | undefined {
  return (
    asString(process.env.CONGRESS_API_KEY) ??
    asString(process.env.GOVINFO_API_KEY) ??
    asString(process.env.REGULATIONS_API_KEY)
  );
}

async function congressJson<T>(rawUrl: string, key: string): Promise<T> {
  const url = new URL(rawUrl);
  url.searchParams.set("format", "json");
  return fetchJson<T>(url.toString(), {
    headers: { "X-Api-Key": key },
  });
}

async function govInfoSearch(
  query: string,
  pageSize: number,
  key: string,
): Promise<GovInfoSearchResponse> {
  return fetchJson<GovInfoSearchResponse>("https://api.govinfo.gov/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": key,
    },
    body: JSON.stringify({
      query,
      pageSize: String(pageSize),
      offsetMark: "*",
      sorts: [{ field: "publishdate", sortOrder: "DESC" }],
    }),
  });
}

function congressBillPath(type: string): string {
  const normalized = type.toUpperCase();
  const paths: Record<string, string> = {
    HR: "house-bill",
    S: "senate-bill",
    HJRES: "house-joint-resolution",
    SJRES: "senate-joint-resolution",
    HCONRES: "house-concurrent-resolution",
    SCONRES: "senate-concurrent-resolution",
    HRES: "house-resolution",
    SRES: "senate-resolution",
  };
  return paths[normalized] ?? normalized.toLowerCase();
}

function govInfoQueryTerm(term: string): string {
  const escaped = term.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return /\s/.test(escaped) ? `"${escaped}"` : escaped;
}

function parseGovInfoBillPackage(
  rawPackageId: unknown,
): GovInfoBillReference | undefined {
  const packageId = asString(rawPackageId);
  if (!packageId) return undefined;
  const match = packageId.match(
    /^BILLS-(\d+)(hconres|sconres|hjres|sjres|hres|sres|hr|s)(\d+)([a-z0-9]+)$/i,
  );
  if (!match) return undefined;
  const congress = Number(match[1]);
  if (!Number.isInteger(congress) || congress < 1) return undefined;
  return {
    packageId,
    congress,
    type: match[2].toLowerCase(),
    number: match[3],
    versionCode: match[4].toLowerCase(),
  };
}

function govInfoPublicUrl(packageId: string): string {
  return `https://www.govinfo.gov/app/details/${encodeURIComponent(packageId)}`;
}

function govInfoHtmlUrl(packageId: string): string {
  const encoded = encodeURIComponent(packageId);
  return `https://www.govinfo.gov/content/pkg/${encoded}/html/${encoded}.htm`;
}

function govInfoPdfUrl(packageId: string): string {
  const encoded = encodeURIComponent(packageId);
  return `https://www.govinfo.gov/content/pkg/${encoded}/pdf/${encoded}.pdf`;
}

function relevantTextExcerpts(rawText: string, terms: string[]): string {
  const text = cleanText(rawText);
  const haystack = text.toLowerCase();
  const excerpts: string[] = [];
  for (const term of terms) {
    const needle = normalizedTerm(term);
    if (!needle) continue;
    let cursor = 0;
    while (excerpts.length < 8) {
      const index = haystack.indexOf(needle, cursor);
      if (index < 0) break;
      const start = Math.max(0, index - 350);
      const end = Math.min(text.length, index + needle.length + 650);
      excerpts.push(text.slice(start, end));
      cursor = index + needle.length;
    }
    if (excerpts.length >= 8) break;
  }
  return uniqueStrings(excerpts).join("\n…\n").slice(0, 8_000);
}

async function runUsCongress(
  config: ProfessionalSourceConfig,
  runAt: Date,
): Promise<AdapterOutput> {
  const govInfoKey = govInfoApiKey();
  const congressKey = congressApiKey();
  if (!govInfoKey || !congressKey) {
    return {
      candidates: [],
      queryCount: 0,
      rawItemCount: 0,
      errors: [],
      skippedReason:
        "GOVINFO_API_KEY, CONGRESS_API_KEY, and REGULATIONS_API_KEY are unavailable",
    };
  }

  const errors: string[] = [];
  const cutoff = cutoffDate(runAt, config.lookbackDays);
  const rangeStart = cutoff.toISOString().slice(0, 10);
  const pageSize = Math.min(
    1_000,
    Math.max(100, config.maxItems * config.queryTerms.length * 2),
  );
  const queryOutputs = await Promise.all(
    config.queryTerms.map(async (term) => {
      const query = [
        "collection:(BILLS)",
        govInfoQueryTerm(term),
        `publishdate:range(${rangeStart},)`,
      ].join(" and ");
      try {
        const response = await govInfoSearch(query, pageSize, govInfoKey);
        return response.results ?? [];
      } catch (error) {
        errors.push(`GovInfo query "${term}": ${errorMessage(error)}`);
        return [];
      }
    }),
  );
  const rawResults = queryOutputs.flat();
  const distinctPackages = new Map<string, GovInfoSearchResult>();
  for (const result of rawResults) {
    const packageId = asString(result.packageId);
    if (packageId && !distinctPackages.has(packageId)) {
      distinctPackages.set(packageId, result);
    }
  }
  const latestPackageByBill = new Map<string, GovInfoSearchResult>();
  for (const result of distinctPackages.values()) {
    const reference = parseGovInfoBillPackage(result.packageId);
    if (
      !reference ||
      !isWithinLookback(result.dateIssued ?? result.lastModified, cutoff)
    ) {
      continue;
    }
    const billKey =
      `${reference.congress}/${reference.type}/${reference.number}`;
    const existing = latestPackageByBill.get(billKey);
    const existingDate = Date.parse(
      existing?.dateIssued ?? existing?.lastModified ?? "",
    ) || 0;
    const resultDate =
      Date.parse(result.dateIssued ?? result.lastModified ?? "") || 0;
    if (!existing || resultDate > existingDate) {
      latestPackageByBill.set(billKey, result);
    }
  }
  const selected = [...latestPackageByBill.values()]
    .sort(
      (left, right) =>
        (Date.parse(right.dateIssued ?? right.lastModified ?? "") || 0) -
        (Date.parse(left.dateIssued ?? left.lastModified ?? "") || 0),
    )
    .slice(0, config.maxItems);

  const enriched = await mapPool(
    selected,
    DETAIL_CONCURRENCY,
    async (result): Promise<{
      result: GovInfoSearchResult;
      reference: GovInfoBillReference;
      bill?: CongressBill;
      summaries: CongressSummary[];
      officialText?: string;
    }> => {
      const reference = parseGovInfoBillPackage(result.packageId)!;
      const base = `https://api.congress.gov/v3/bill/${reference.congress}/${encodeURIComponent(reference.type)}/${encodeURIComponent(reference.number)}`;
      const [detailResult, summaryResult, textResult] =
        await Promise.allSettled([
          congressJson<CongressBillDetailResponse>(base, congressKey),
          congressJson<CongressSummariesResponse>(
            `${base}/summaries`,
            congressKey,
          ),
          fetchText(govInfoHtmlUrl(reference.packageId)),
        ]);
      if (detailResult.status === "rejected") {
        errors.push(
          `bill ${reference.congress}/${reference.type}/${reference.number} detail: ${errorMessage(detailResult.reason)}`,
        );
      }
      if (summaryResult.status === "rejected") {
        errors.push(
          `bill ${reference.congress}/${reference.type}/${reference.number} summaries: ${errorMessage(summaryResult.reason)}`,
        );
      }
      if (textResult.status === "rejected") {
        errors.push(
          `GovInfo package ${reference.packageId} text: ${errorMessage(textResult.reason)}`,
        );
      }
      return {
        result,
        reference,
        bill:
          detailResult.status === "fulfilled"
            ? detailResult.value.bill
            : undefined,
        summaries:
          summaryResult.status === "fulfilled"
            ? summaryResult.value.summaries ?? []
            : [],
        officialText:
          textResult.status === "fulfilled" ? textResult.value : undefined,
      };
    },
  );

  const retrievedAt = runAt.toISOString();
  const candidates = enriched.flatMap<PendingItem>(
    ({ result, reference, bill, summaries, officialText }) => {
      const title = cleanText(result.title ?? bill?.title);
      if (!title) return [];
      const documentId =
        `${reference.congress}-${reference.type.toUpperCase()}-${reference.number}`;
      const sortedSummaries = [...summaries].sort(
        (left, right) =>
          (Date.parse(right.updateDate ?? right.actionDate ?? "") || 0) -
          (Date.parse(left.updateDate ?? left.actionDate ?? "") || 0),
      );
      const newestSummary = sortedSummaries[0];
      const latestSignal = latestDate([
        bill?.latestAction?.actionDate,
        bill?.updateDateIncludingText,
        bill?.updateDate,
        result.dateIssued,
      ]);
      const updateDate =
        dateOnly(latestSignal) ?? runAt.toISOString().slice(0, 10);
      const cleanedOfficialText = officialText
        ? cleanText(officialText)
        : undefined;
      const textHash = cleanedOfficialText
        ? createHash("sha256").update(cleanedOfficialText).digest("hex")
        : undefined;
      const sourceVersion = uniqueStrings([
        reference.packageId,
        textHash ? `sha256:${textHash}` : asString(result.lastModified),
        asString(bill?.updateDateIncludingText),
        asString(bill?.updateDate),
        asString(bill?.latestAction?.actionDate),
      ]).join("@");
      const congressUrl =
        `https://www.congress.gov/bill/${reference.congress}th-congress/` +
        `${congressBillPath(reference.type)}/${encodeURIComponent(reference.number)}`;
      const sponsors = uniqueStrings(
        (bill?.sponsors ?? []).map((sponsor) => {
          const identity = asString(sponsor.fullName);
          const affiliation = uniqueStrings([
            asString(sponsor.party),
            asString(sponsor.state),
          ]).join("-");
          return identity
            ? affiliation
              ? `${identity} (${affiliation})`
              : identity
            : undefined;
        }),
      );

      return [
        makeCandidate({
          feedUrl: "https://api.govinfo.gov/search",
          feedName: "GovInfo + Congress.gov",
          entity: "United States",
          sourceId: "us-congress",
          sourceAuthority:
            "U.S. Government Publishing Office / Library of Congress",
          title,
          link: govInfoPublicUrl(reference.packageId),
          pubDate: updateDate,
          metadata: {
            contentText: joinText(
              title,
              relevantTextExcerpts(officialText ?? "", config.queryTerms),
              bill?.latestAction?.text,
              newestSummary?.actionDesc,
              newestSummary?.text,
              bill?.policyArea?.name
                ? `Policy area: ${bill.policyArea.name}`
                : undefined,
              sponsors.length ? `Sponsors: ${sponsors.join(", ")}` : undefined,
              `GovInfo text version: ${reference.versionCode}`,
              `Congress.gov status: ${congressUrl}`,
            ),
            prequalified: true,
            officialDocumentId: documentId,
            sourceVersion: sourceVersion || reference.packageId,
            documentType: "bill",
            officialPdfUrl: govInfoPdfUrl(reference.packageId),
            retrievedAt,
            relatedDocumentIds: [reference.packageId],
          },
        }),
      ];
    },
  );

  return {
    candidates: dedupeAndLimit(candidates, config.maxItems),
    queryCount: config.queryTerms.length,
    rawItemCount: rawResults.length,
    errors,
  };
}

// ─── UK legislation.gov.uk full-text search ─────────────────────────────────

interface UkLegislationEntry {
  id: string;
  title: string;
  updated?: string;
  published?: string;
  summary?: string;
  documentMainType?: string;
  versionUrl?: string;
  xmlUrl?: string;
  pdfUrl?: string;
  categories: string[];
  relatedDocumentIds: string[];
}

function xmlElementText(block: string, localName: string): string | undefined {
  const escaped = localName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = block.match(
    new RegExp(
      `<(?:[A-Za-z0-9_-]+:)?${escaped}\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_-]+:)?${escaped}>`,
      "i",
    ),
  );
  return match ? cleanText(match[1]) || undefined : undefined;
}

function xmlAttributes(fragment: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern =
    /([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const match of fragment.matchAll(pattern)) {
    attributes[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? "");
  }
  return attributes;
}

function httpsUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol === "http:") url.protocol = "https:";
    return url.toString();
  } catch {
    return undefined;
  }
}

function legislationDocumentId(raw: string | undefined): string | undefined {
  const url = httpsUrl(raw);
  if (!url) return undefined;
  const marker = "/id/";
  const index = new URL(url).pathname.indexOf(marker);
  if (index < 0) return undefined;
  return decodeURIComponent(new URL(url).pathname.slice(index + marker.length))
    .replace(/^\/|\/$/g, "") || undefined;
}

function normalizeUkLegislationType(raw: string | undefined): string {
  const value = (raw ?? "").toLowerCase();
  if (value.includes("draft") && value.includes("statutoryinstrument")) {
    return "draft-statutory-instrument";
  }
  if (value.includes("statutoryinstrument")) return "statutory-instrument";
  if (value.includes("act")) return "act";
  return normalizeDocumentType(raw);
}

function parseUkLegislationFeed(rawXml: string): UkLegislationEntry[] {
  const entries: UkLegislationEntry[] = [];
  for (const match of rawXml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)) {
    const block = match[1];
    const idUrl = httpsUrl(xmlElementText(block, "id"));
    const id = legislationDocumentId(idUrl);
    const title = xmlElementText(block, "title");
    if (!id || !title) continue;

    const links = [...block.matchAll(/<link\b([^>]*)\/?>/gi)].map((link) =>
      xmlAttributes(link[1]),
    );
    const versionUrl = httpsUrl(
      links.find(
        (link) => link.href && !link.rel && !link.type,
      )?.href,
    );
    const xmlUrl = httpsUrl(
      links.find(
        (link) =>
          link.rel === "alternate" &&
          link.type === "application/xml",
      )?.href,
    );
    const pdfUrl = httpsUrl(
      links.find(
        (link) =>
          link.rel === "alternate" &&
          link.type === "application/pdf",
      )?.href,
    );
    const mainTypeTag = block.match(/<ukm:DocumentMainType\b([^>]*)\/?>/i);
    const categories = [...block.matchAll(/<category\b([^>]*)\/?>/gi)]
      .map((category) => xmlAttributes(category[1]).term)
      .filter((category): category is string => Boolean(category));
    const relatedDocumentIds = uniqueStrings(
      [...block.matchAll(/https?:\/\/www\.legislation\.gov\.uk\/id\/([^"' <]+)/gi)]
        .map((related) => decodeURIComponent(related[1]).replace(/\/$/, ""))
        .filter((related) => related !== id),
    );

    entries.push({
      id,
      title,
      updated: xmlElementText(block, "updated"),
      published: xmlElementText(block, "published"),
      summary: xmlElementText(block, "summary"),
      documentMainType: mainTypeTag
        ? xmlAttributes(mainTypeTag[1]).value
        : undefined,
      versionUrl: versionUrl ?? idUrl,
      xmlUrl,
      pdfUrl,
      categories,
      relatedDocumentIds,
    });
  }
  return entries;
}

async function runUkLegislation(
  config: ProfessionalSourceConfig,
  runAt: Date,
): Promise<AdapterOutput> {
  const errors: string[] = [];
  const cutoff = cutoffDate(runAt, config.lookbackDays);
  const rawEntries: UkLegislationEntry[] = [];
  const maxPages = Math.max(1, Math.ceil(config.maxItems / 20));

  const queryOutputs = await Promise.all(
    config.queryTerms.map(async (term) => {
      const termEntries: UkLegislationEntry[] = [];
      for (let page = 1; page <= maxPages; page += 1) {
        const url = new URL(
          "https://www.legislation.gov.uk/all/data.feed",
        );
        url.searchParams.set("text", term);
        if (page > 1) url.searchParams.set("page", String(page));
        try {
          const pageEntries = parseUkLegislationFeed(
            await fetchText(url.toString(), {
              headers: { Accept: "application/atom+xml,application/xml" },
            }),
          );
          termEntries.push(...pageEntries);
          if (pageEntries.length < 20) break;
        } catch (error) {
          errors.push(
            `query "${term}" page ${page}: ${errorMessage(error)}`,
          );
          break;
        }
      }
      return termEntries;
    }),
  );
  rawEntries.push(...queryOutputs.flat());

  const distinct = new Map<string, UkLegislationEntry>();
  for (const entry of rawEntries) {
    const signal = entry.updated ?? entry.published;
    if (!isWithinLookback(signal, cutoff)) continue;
    const existing = distinct.get(entry.id);
    if (
      !existing ||
      (Date.parse(signal ?? "") || 0) >
        (Date.parse(existing.updated ?? existing.published ?? "") || 0)
    ) {
      distinct.set(entry.id, entry);
    }
  }
  const selected = [...distinct.values()]
    .sort(
      (left, right) =>
        (Date.parse(right.updated ?? right.published ?? "") || 0) -
        (Date.parse(left.updated ?? left.published ?? "") || 0),
    )
    .slice(0, config.maxItems);

  const enriched = await mapPool(
    selected,
    DETAIL_CONCURRENCY,
    async (entry): Promise<{ entry: UkLegislationEntry; officialText?: string }> => {
      if (!entry.xmlUrl) return { entry };
      try {
        return {
          entry,
          officialText: await fetchText(entry.xmlUrl, {
            headers: { Accept: "application/xml,text/xml" },
          }),
        };
      } catch (error) {
        errors.push(`document ${entry.id}: ${errorMessage(error)}`);
        return { entry };
      }
    },
  );

  const retrievedAt = runAt.toISOString();
  const candidates = enriched.flatMap<PendingItem>(({ entry, officialText }) => {
    const eventDate = dateOnly(entry.updated ?? entry.published);
    const link = entry.versionUrl ?? entry.xmlUrl;
    if (!eventDate || !link) return [];
    const cleanedOfficialText = officialText
      ? cleanText(officialText)
      : undefined;
    const textHash = cleanedOfficialText
      ? createHash("sha256").update(cleanedOfficialText).digest("hex")
      : undefined;
    const sourceVersion = uniqueStrings([
      entry.versionUrl,
      entry.updated,
      textHash ? `sha256:${textHash}` : undefined,
    ]).join("@");

    return [
      makeCandidate({
        feedUrl: "https://www.legislation.gov.uk/all/data.feed",
        feedName: "legislation.gov.uk",
        entity: "United Kingdom",
        sourceId: "uk-legislation",
        sourceAuthority: "The National Archives / legislation.gov.uk",
        title: entry.title,
        link,
        pubDate: eventDate,
        metadata: {
          contentText: joinText(
            entry.title,
            relevantTextExcerpts(officialText ?? "", config.queryTerms),
            entry.summary,
            entry.categories.length
              ? `Subjects: ${entry.categories.join(", ")}`
              : undefined,
          ),
          prequalified: true,
          officialDocumentId: entry.id,
          sourceVersion,
          documentType: normalizeUkLegislationType(entry.documentMainType),
          officialPdfUrl: entry.pdfUrl,
          retrievedAt,
          relatedDocumentIds: entry.relatedDocumentIds,
        },
      }),
    ];
  });

  return {
    candidates: dedupeAndLimit(candidates, config.maxItems),
    queryCount: config.queryTerms.length,
    rawItemCount: rawEntries.length,
    errors,
  };
}

// ─── Financial Services Agency, Japan ──────────────────────────────────────

function htmlLinks(html: string, baseUrl: string): string[] {
  const links: string[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)) {
    try {
      const url = new URL(decodeEntities(match[1]), baseUrl);
      if (url.hostname !== "www.fsa.go.jp") continue;
      if (!/^\/en\/news\/20\d{2}\//.test(url.pathname)) continue;
      url.hash = "";
      const canonical = url.toString();
      if (seen.has(canonical)) continue;
      seen.add(canonical);
      links.push(canonical);
    } catch {
      // Ignore malformed links in the official index.
    }
  }
  return links;
}

function pageTitle(html: string): string {
  const heading = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  return cleanText(heading);
}

function englishPageDate(text: string): string | undefined {
  const match = text.match(
    /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+20\d{2}\b/i,
  );
  return dateOnly(match?.[0]);
}

async function runJapanFsa(
  config: ProfessionalSourceConfig,
  runAt: Date,
): Promise<AdapterOutput> {
  const errors: string[] = [];
  const indexUrl = "https://www.fsa.go.jp/en/news/";
  const cutoff = cutoffDate(runAt, config.lookbackDays);
  const indexHtml = await fetchText(indexUrl);
  // The index is newest-first. Fetch enough detail pages to cover a busy
  // month, then enforce the configured date window using each page's date.
  const links = htmlLinks(indexHtml, indexUrl).slice(
    0,
    Math.max(60, config.maxItems * 5),
  );
  const pages = await mapPool(links, DETAIL_CONCURRENCY, async (link) => {
    try {
      return { link, html: await fetchText(link) };
    } catch (error) {
      errors.push(`${link}: ${errorMessage(error)}`);
      return null;
    }
  });

  const normalizedTerms = config.queryTerms.map(normalizedTerm);
  const retrievedAt = runAt.toISOString();
  const candidates = pages.flatMap<PendingItem>((page) => {
    if (!page) return [];
    const contentText = cleanText(page.html);
    const publicationDate = englishPageDate(contentText);
    if (!publicationDate || !isWithinLookback(publicationDate, cutoff)) return [];
    const searchable = normalizedTerm(contentText);
    if (!normalizedTerms.some((term) => searchable.includes(term))) return [];
    const title = pageTitle(page.html);
    if (!title) return [];
    const documentId = new URL(page.link).pathname.replace(/\/$/, "");
    return [
      makeCandidate({
        feedUrl: indexUrl,
        feedName: "Japan FSA — Official Press Releases",
        entity: "Japan",
        sourceId: "japan-fsa",
        sourceAuthority: "Financial Services Agency, Japan",
        title,
        link: page.link,
        pubDate: publicationDate,
        metadata: {
          contentText: contentText.slice(0, 12_000),
          prequalified: true,
          officialDocumentId: documentId,
          sourceVersion: publicationDate,
          documentType: "regulatory-announcement",
          retrievedAt,
        },
      }),
    ];
  });

  return {
    candidates: dedupeAndLimit(candidates, config.maxItems),
    queryCount: config.queryTerms.length,
    rawItemCount: pages.filter(Boolean).length,
    errors,
  };
}

// ─── Cross-source merge and public runner ───────────────────────────────────

const ADAPTERS: Record<ProfessionalSourceId, Adapter> = {
  "federal-register": runFederalRegister,
  "regulations-gov": runRegulationsGov,
  "us-congress": runUsCongress,
  "uk-legislation": runUkLegislation,
  "japan-fsa": runJapanFsa,
};

function normalizeFederalRegisterNumber(raw: string | undefined): string {
  return (raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function latestDate(values: Array<string | undefined>): string | undefined {
  return values
    .filter((value): value is string => Boolean(value && dateOnly(value)))
    .sort(
      (left, right) =>
        (Date.parse(right) || 0) - (Date.parse(left) || 0),
    )[0];
}

function mergeFederalRegisterAndRegulations(
  candidates: PendingItem[],
  runAt: Date,
): {
  candidates: PendingItem[];
  mergedBySource: Partial<Record<ProfessionalSourceId, number>>;
} {
  const passthrough: PendingItem[] = [];
  const groups = new Map<string, ProfessionalCandidate[]>();

  for (const item of candidates) {
    const candidate = viewCandidate(item);
    const isMergeableSource =
      candidate.feed.sourceId === "federal-register" ||
      candidate.feed.sourceId === "regulations-gov";
    const frNumber = normalizeFederalRegisterNumber(
      candidate.parsed.federalRegisterNumber,
    );
    if (!isMergeableSource || !frNumber) {
      passthrough.push(item);
      continue;
    }
    const group = groups.get(frNumber) ?? [];
    group.push(candidate);
    groups.set(frNumber, group);
  }

  const mergedBySource: Partial<Record<ProfessionalSourceId, number>> = {};
  for (const group of groups.values()) {
    const federal =
      group.find((candidate) => candidate.feed.sourceId === "federal-register") ??
      group[0];
    const regulations = group.find(
      (candidate) => candidate.feed.sourceId === "regulations-gov",
    );
    if (group.length === 1) {
      passthrough.push(federal);
      continue;
    }

    for (const candidate of group) {
      if (candidate === federal) continue;
      mergedBySource[candidate.feed.sourceId] =
        (mergedBySource[candidate.feed.sourceId] ?? 0) + 1;
    }

    const commentCloseDate = latestDate(
      group.map((candidate) => candidate.parsed.commentCloseDate),
    );
    const relatedDocumentIds = uniqueStrings(
      group.flatMap((candidate) => [
        ...(candidate.parsed.relatedDocumentIds ?? []),
        candidate.parsed.officialDocumentId,
      ]),
    ).filter((id) => id !== federal.parsed.officialDocumentId);
    const retrievedAt = latestDate(
      group.map((candidate) => candidate.parsed.retrievedAt),
    );
    const sourceVersion = uniqueStrings(
      group.map((candidate) => candidate.parsed.sourceVersion),
    )
      .sort()
      .join("|");
    const merged: ProfessionalCandidate = {
      feed: { ...federal.feed },
      parsed: {
        ...federal.parsed,
        pubDate:
          latestDate(group.map((candidate) => candidate.parsed.pubDate)) ??
          federal.parsed.pubDate,
        contentText: joinText(
          ...group.map((candidate) => candidate.parsed.contentText),
        ),
        officialPdfUrl:
          federal.parsed.officialPdfUrl ??
          group.find((candidate) => candidate.parsed.officialPdfUrl)?.parsed
            .officialPdfUrl,
        commentCloseDate,
        // Regulations.gov exposes an explicit docket state. It takes
        // precedence over Federal Register's deadline-derived state, including
        // an explicit false before a nominal future deadline.
        openForComment: isCommentOpen(
          commentCloseDate,
          runAt,
          regulations?.parsed.openForComment ??
            federal.parsed.openForComment,
        ),
        sourceVersion: sourceVersion || federal.parsed.sourceVersion,
        retrievedAt: retrievedAt ?? federal.parsed.retrievedAt,
        federalRegisterNumber:
          federal.parsed.federalRegisterNumber ??
          group.find((candidate) => candidate.parsed.federalRegisterNumber)
            ?.parsed.federalRegisterNumber,
        relatedDocumentIds,
      },
    };
    passthrough.push(merged);
  }

  const final = new Map<string, PendingItem>();
  for (const candidate of passthrough) {
    const key = candidateKey(candidate);
    if (!final.has(key)) final.set(key, candidate);
  }

  return {
    candidates: [...final.values()].sort(
      (left, right) =>
        (Date.parse(right.parsed.pubDate) || 0) -
        (Date.parse(left.parsed.pubDate) || 0),
    ),
    mergedBySource,
  };
}

async function runOneSource(
  config: ProfessionalSourceConfig,
  runAt: Date,
): Promise<{ output: AdapterOutput; result: ProfessionalSourceResult }> {
  const startedAt = Date.now();
  if (config.enabled === false) {
    const output: AdapterOutput = {
      candidates: [],
      queryCount: 0,
      rawItemCount: 0,
      errors: [],
      skippedReason: "disabled in professional-sources.json",
    };
    return {
      output,
      result: {
        sourceId: config.id,
        status: "skipped",
        queryCount: 0,
        rawItemCount: 0,
        candidateCount: 0,
        mergedIntoOtherSources: 0,
        durationMs: Date.now() - startedAt,
        errors: [],
        note: output.skippedReason,
      },
    };
  }

  try {
    const output = await ADAPTERS[config.id](config, runAt);
    const status: ProfessionalSourceStatus = output.skippedReason
      ? "skipped"
      : output.errors.length > 0
        ? output.candidates.length > 0
          ? "partial"
          : "failed"
        : "ok";
    return {
      output,
      result: {
        sourceId: config.id,
        status,
        queryCount: output.queryCount,
        rawItemCount: output.rawItemCount,
        candidateCount: output.candidates.length,
        mergedIntoOtherSources: 0,
        durationMs: Date.now() - startedAt,
        errors: output.errors,
        note: output.skippedReason,
      },
    };
  } catch (error) {
    const message = errorMessage(error);
    return {
      output: {
        candidates: [],
        queryCount: 0,
        rawItemCount: 0,
        errors: [message],
      },
      result: {
        sourceId: config.id,
        status: "failed",
        queryCount: 0,
        rawItemCount: 0,
        candidateCount: 0,
        mergedIntoOtherSources: 0,
        durationMs: Date.now() - startedAt,
        errors: [message],
      },
    };
  }
}

export async function runProfessionalSources(): Promise<ProfessionalSourcesRun> {
  const config = readConfig();
  const runAt = new Date();
  const sourceRuns = await Promise.all(
    config.sources.map((source) => runOneSource(source, runAt)),
  );

  const merged = mergeFederalRegisterAndRegulations(
    sourceRuns.flatMap((run) => run.output.candidates),
    runAt,
  );
  for (const run of sourceRuns) {
    run.result.mergedIntoOtherSources =
      merged.mergedBySource[run.result.sourceId] ?? 0;
  }

  return {
    candidates: merged.candidates,
    results: sourceRuns.map((run) => run.result),
  };
}
