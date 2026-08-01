import { sha256 } from "../../data/integrity";
import type {
  OfficialSourceRegistryEntry,
  OfficialSourceSnapshot,
  ProvisionCandidate,
} from "./types";

const MAX_SOURCE_BYTES = 5 * 1024 * 1024;

export async function fetchEurLexSource(
  source: OfficialSourceRegistryEntry,
  options: { fetchImpl?: typeof fetch; retrievedAt?: string } = {},
): Promise<OfficialSourceSnapshot> {
  assertOfficialUrl(source.fetchUrl, source.officialDomains);
  const response = await (options.fetchImpl ?? fetch)(source.fetchUrl, {
    headers: { Accept: "application/xhtml+xml" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`EUR-Lex fetch failed (${response.status})`);
  }
  if (response.url) assertOfficialUrl(response.url, source.officialDomains);
  const contentType = response.headers.get("content-type")?.split(";")[0] ?? "";
  if (contentType !== "text/html" && contentType !== "application/xhtml+xml") {
    throw new Error(`unexpected EUR-Lex content type: ${contentType || "missing"}`);
  }
  const body = new Uint8Array(await response.arrayBuffer());
  if (body.byteLength === 0 || body.byteLength > MAX_SOURCE_BYTES) {
    throw new Error(`EUR-Lex body size outside allowed range: ${body.byteLength}`);
  }
  const html = new TextDecoder().decode(body);
  if (!html.includes(source.officialDocumentId) && !html.includes("art_1")) {
    throw new Error("EUR-Lex response does not contain expected legal text markers");
  }
  const checksumSha256 = sha256(body);
  const versionId = `${source.documentId}:en:${checksumSha256.slice(0, 24)}`;
  const provisions = extractEurLexArticles(html, versionId, source.languageCode);
  if (provisions.length < source.minimumProvisionCount) {
    throw new Error(
      `EUR-Lex provision count below registry floor: ${provisions.length}/${source.minimumProvisionCount}`,
    );
  }
  const objectKey = `official-sources/eur-lex/${source.officialDocumentId.toLowerCase().replace(":", "-")}/${checksumSha256}.xhtml`;
  return {
    source,
    body,
    contentType,
    checksumSha256,
    retrievedAt: options.retrievedAt ?? new Date().toISOString(),
    objectKey,
    objectId: `object:source:${checksumSha256.slice(0, 32)}`,
    versionId,
    provisions,
  };
}

export function extractEurLexArticles(
  html: string,
  versionId: string,
  languageCode = "en",
): ProvisionCandidate[] {
  const openings = [...html.matchAll(/<div\b[^>]*\bid="art_(\d+)"[^>]*>/gi)];
  return openings.map((opening, ordinal) => {
    const articleNumber = opening[1];
    const block = balancedDiv(html, opening.index ?? 0);
    const heading = firstClassText(block, "oj-sti-art");
    const provisionText = htmlToText(block);
    if (!provisionText.startsWith(`Article ${articleNumber}`)) {
      throw new Error(`article ${articleNumber} is missing its official heading`);
    }
    const locator = `Article ${articleNumber}`;
    const textChecksumSha256 = sha256(Buffer.from(provisionText, "utf8"));
    return {
      provisionId: `${versionId}:article:${articleNumber}`,
      locator,
      heading,
      languageCode,
      provisionText,
      textChecksumSha256,
      ordinal,
      excerptPermission: "UNKNOWN",
    };
  });
}

function balancedDiv(html: string, start: number): string {
  const tags = /<\/?div\b[^>]*>/gi;
  tags.lastIndex = start;
  let depth = 0;
  let match: RegExpExecArray | null;
  while ((match = tags.exec(html))) {
    depth += /^<\/div/i.test(match[0]) ? -1 : 1;
    if (depth === 0) return html.slice(start, tags.lastIndex);
  }
  throw new Error("unterminated EUR-Lex article div");
}

function firstClassText(block: string, className: string): string | null {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = block.match(
    new RegExp(`<[^>]+class="[^"]*\\b${escaped}\\b[^"]*"[^>]*>([\\s\\S]*?)<\\/[^>]+>`, "i"),
  );
  return match ? htmlToText(match[1]) : null;
}

function htmlToText(value: string): string {
  return decodeEntities(
    value
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--([\s\S]*?)-->/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/[\s\u00a0]+/g, " ")
      .trim(),
  );
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (code[0] !== "#") return named[code.toLowerCase()] ?? entity;
    const radix = code[1]?.toLowerCase() === "x" ? 16 : 10;
    const digits = radix === 16 ? code.slice(2) : code.slice(1);
    const point = Number.parseInt(digits, radix);
    return Number.isFinite(point) ? String.fromCodePoint(point) : entity;
  });
}

function assertOfficialUrl(rawUrl: string, officialDomains: string[]): void {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" || !officialDomains.includes(url.hostname)) {
    throw new Error(`source URL is outside the official allowlist: ${url.hostname}`);
  }
}
