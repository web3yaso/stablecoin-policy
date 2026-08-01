import { sha256 } from "../../data/integrity";
import type {
  OfficialSourceRegistryEntry,
  OfficialSourceSnapshot,
  ProvisionCandidate,
} from "./types";

const MAX_FORM_BYTES = 2 * 1024 * 1024;
const MAX_EXPORT_BYTES = 15 * 1024 * 1024;
const MAX_PDF_BYTES = 15 * 1024 * 1024;
const USER_AGENT =
  "Mozilla/5.0 (compatible; CitelyOfficialSourceMonitor/1.0; +https://www.citely.info/)";

export async function fetchSsoSource(
  source: OfficialSourceRegistryEntry,
  options: { fetchImpl?: typeof fetch; retrievedAt?: string } = {},
): Promise<OfficialSourceSnapshot> {
  const { documentType, documentNumber, validDate, pdfUrl, expectedPdfChecksumSha256 } =
    assertSsoRegistry(source);
  const fetchImpl = options.fetchImpl ?? fetch;

  const formResponse = await fetchImpl(source.fetchUrl, {
    headers: { Accept: "text/html", "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(30_000),
  });
  const formHtml = await validatedHtmlResponse(
    formResponse,
    source,
    "print form",
    MAX_FORM_BYTES,
  );
  const csrfToken = jsonStringValue(formHtml, "ajaxToken");
  if (!csrfToken) throw new Error("SSO print form is missing its CSRF token");

  const exportUrl = new URL(source.fetchUrl);
  exportUrl.search = `?ValidDate=${encodeURIComponent(validDate)}`;
  const exportResponse = await fetchImpl(exportUrl, {
    method: "POST",
    headers: {
      Accept: "text/html",
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      "User-Agent": USER_AGENT,
    },
    body: new URLSearchParams({
      DocType: documentType,
      DocNo: documentNumber,
      DocStatus: "Current",
      ValidDate: validDate,
      ViewType: "Print",
      PrintType: "html",
      ProvIds: "all-.,toc-.",
      CSRF_Token: csrfToken,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const exportHtml = await validatedHtmlResponse(
    exportResponse,
    source,
    "HTML export",
    MAX_EXPORT_BYTES,
  );
  assertSsoIdentity(exportHtml, source);

  const pdfResponse = await fetchImpl(pdfUrl, {
    headers: { Accept: "application/pdf", "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(30_000),
  });
  if (!pdfResponse.ok) throw new Error(`SSO PDF fetch failed (${pdfResponse.status})`);
  if (pdfResponse.url) assertOfficialUrl(pdfResponse.url, source.officialDomains);
  const contentType = pdfResponse.headers.get("content-type")?.split(";")[0] ?? "";
  if (contentType !== "application/pdf") {
    throw new Error(`unexpected SSO PDF content type: ${contentType || "missing"}`);
  }
  const body = new Uint8Array(await pdfResponse.arrayBuffer());
  if (body.byteLength === 0 || body.byteLength > MAX_PDF_BYTES) {
    throw new Error(`SSO PDF size outside allowed range: ${body.byteLength}`);
  }
  if (new TextDecoder().decode(body.subarray(0, 5)) !== "%PDF-") {
    throw new Error("SSO PDF response is missing its PDF signature");
  }

  const checksumSha256 = sha256(body);
  if (checksumSha256 !== expectedPdfChecksumSha256) {
    throw new Error(
      `SSO PDF checksum mismatch: ${checksumSha256}/${expectedPdfChecksumSha256}`,
    );
  }
  const versionId = `${source.documentId}:en:${checksumSha256.slice(0, 24)}`;
  const provisions = extractSsoSections(
    exportHtml,
    versionId,
    source.languageCode,
    source.redistributionRights === "FULL_TEXT" ? "ALLOWED" : "UNKNOWN",
    source.ssoProvisionKind ?? "section",
  );
  if (provisions.length < source.minimumProvisionCount) {
    throw new Error(
      `SSO provision count below registry floor: ${provisions.length}/${source.minimumProvisionCount}`,
    );
  }
  const provisionSetChecksumSha256 = sha256(
    Buffer.from(
      JSON.stringify(
        provisions.map(({ locator, textChecksumSha256 }) => ({ locator, textChecksumSha256 })),
      ),
      "utf8",
    ),
  );
  const slug = documentNumber.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-$/, "");
  return {
    source,
    body,
    contentType,
    checksumSha256,
    retrievedAt: options.retrievedAt ?? new Date().toISOString(),
    objectKey: `official-sources/sso/${slug}/${checksumSha256}.pdf`,
    objectId: `object:source:${checksumSha256.slice(0, 32)}`,
    versionId,
    provisions,
    retrievalMetadata: {
      immutableArtifactUrl: pdfUrl,
      structuredTextUrl: exportUrl.toString(),
      provisionSetChecksumSha256,
      validDate,
      sourceTextAuthority: "OFFICIAL_UNOFFICIAL_CONSOLIDATION",
      copyrightNoticeRequired: true,
      latestVersionLinkRequired: true,
    },
  };
}

export function assertSsoIdentity(
  html: string,
  source: Pick<
    OfficialSourceRegistryEntry,
    "title" | "ssoDocumentNumber" | "ssoValidDate"
  >,
): void {
  const title = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim();
  if (title !== `${source.title} - Singapore Statutes Online`) {
    throw new Error(`SSO title identity mismatch: ${title ?? "missing"}`);
  }
  if (
    !source.ssoDocumentNumber ||
    !source.ssoValidDate ||
    !html.includes(`"DocNo":"${source.ssoDocumentNumber}"`) ||
    !html.includes(`"ValidDate":"${source.ssoValidDate}"`)
  ) {
    throw new Error("SSO document number or valid-date identity mismatch");
  }
}

export function extractSsoSections(
  html: string,
  versionId: string,
  languageCode = "en",
  excerptPermission: "ALLOWED" | "UNKNOWN" = "UNKNOWN",
  provisionKind: "section" | "regulation" | "paragraph" = "section",
): ProvisionCandidate[] {
  const openings = [
    ...html.matchAll(/<div\b[^>]*class="[^"]*\b(prov1|prov1Rep)\b[^"]*"[^>]*>/gi),
  ];
  const seen = new Set<string>();
  return openings.map((opening, ordinal) => {
    const block = balancedDiv(html, opening.index ?? 0);
    const standardNumber = block.match(
      /<td\b[^>]*class="[^"]*\bprov1Hdr\b[^"]*"[^>]*id="pr([0-9]+[A-Z]*)-"[^>]*>/i,
    )?.[1];
    const inactiveNumber = opening[0].match(/\bid="pr([0-9]+[A-Z]*)-"/i)?.[1];
    const provisionNumber = standardNumber ?? inactiveNumber;
    if (!provisionNumber) throw new Error("SSO provision is missing its official identifier");
    if (seen.has(provisionNumber)) {
      throw new Error(`SSO provision identity is duplicated: ${provisionNumber}`);
    }
    seen.add(provisionNumber);
    const provisionText = htmlToText(block);
    const heading = standardNumber
      ? firstClassText(block, "prov1Hdr")
      : provisionText.replace(new RegExp(`^${provisionNumber}\\.\\s*`), "").trim();
    if (!heading || !provisionText.includes(`${provisionNumber}.`)) {
      throw new Error(
        `SSO ${provisionKind} ${provisionNumber} is missing its official heading or number`,
      );
    }
    return {
      provisionId: `${versionId}:${provisionKind}:${provisionNumber.toLowerCase()}`,
      locator: `${capitalize(provisionKind)} ${provisionNumber}`,
      heading,
      languageCode,
      provisionText,
      textChecksumSha256: sha256(Buffer.from(provisionText, "utf8")),
      ordinal,
      excerptPermission,
    };
  });
}

function capitalize(value: string): string {
  return value[0].toUpperCase() + value.slice(1);
}

function assertSsoRegistry(source: OfficialSourceRegistryEntry): {
  documentType: "Act" | "SL";
  documentNumber: string;
  validDate: string;
  pdfUrl: string;
  expectedPdfChecksumSha256: string;
} {
  if (
    !source.ssoDocumentType ||
    !source.ssoDocumentNumber ||
    (source.ssoDocumentType === "SL" && !source.ssoProvisionKind) ||
    !source.ssoValidDate ||
    !/^\d{8}$/.test(source.ssoValidDate) ||
    !source.ssoPdfUrl ||
    !source.ssoExpectedPdfChecksumSha256 ||
    !/^[0-9a-f]{64}$/.test(source.ssoExpectedPdfChecksumSha256)
  ) {
    throw new Error(`SSO source registry entry is incomplete: ${source.sourceId}`);
  }
  assertOfficialUrl(source.fetchUrl, source.officialDomains);
  assertOfficialUrl(source.ssoPdfUrl, source.officialDomains);
  return {
    documentType: source.ssoDocumentType,
    documentNumber: source.ssoDocumentNumber,
    validDate: source.ssoValidDate,
    pdfUrl: source.ssoPdfUrl,
    expectedPdfChecksumSha256: source.ssoExpectedPdfChecksumSha256,
  };
}

async function validatedHtmlResponse(
  response: Response,
  source: OfficialSourceRegistryEntry,
  label: string,
  maximumBytes: number,
): Promise<string> {
  if (!response.ok) throw new Error(`SSO ${label} fetch failed (${response.status})`);
  if (response.url) assertOfficialUrl(response.url, source.officialDomains);
  const contentType = response.headers.get("content-type")?.split(";")[0] ?? "";
  if (contentType !== "text/html") {
    throw new Error(`unexpected SSO ${label} content type: ${contentType || "missing"}`);
  }
  const body = new Uint8Array(await response.arrayBuffer());
  if (body.byteLength === 0 || body.byteLength > maximumBytes) {
    throw new Error(`SSO ${label} size outside allowed range: ${body.byteLength}`);
  }
  return new TextDecoder().decode(body);
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
  throw new Error("unterminated SSO section div");
}

function firstClassText(block: string, className: string): string | null {
  const match = block.match(
    new RegExp(
      `<([a-z0-9]+)\\b[^>]*class="[^"]*\\b${className}\\b[^"]*"[^>]*>([\\s\\S]*?)<\\/\\1>`,
      "i",
    ),
  );
  return match ? htmlToText(match[2]) : null;
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
    const point = Number.parseInt(radix === 16 ? code.slice(2) : code.slice(1), radix);
    return Number.isFinite(point) ? String.fromCodePoint(point) : entity;
  });
}

function jsonStringValue(html: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`"${escaped}":"((?:\\\\.|[^"\\\\])*)"`));
  if (!match) return null;
  try {
    return JSON.parse(`"${match[1]}"`) as string;
  } catch {
    throw new Error(`SSO ${key} value is not valid JSON`);
  }
}

function assertOfficialUrl(rawUrl: string | URL, officialDomains: string[]): void {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" || !officialDomains.includes(url.hostname)) {
    throw new Error(`source URL is outside the official allowlist: ${url.hostname}`);
  }
}
