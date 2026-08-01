import { inflateRawSync } from "node:zlib";
import { sha256 } from "../../data/integrity";
import type {
  OfficialSourceRegistryEntry,
  OfficialSourceSnapshot,
  ProvisionCandidate,
} from "./types";

const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
const MAX_XML_BYTES = 5 * 1024 * 1024;

export async function fetchHkelSource(
  source: OfficialSourceRegistryEntry,
  options: { fetchImpl?: typeof fetch; retrievedAt?: string } = {},
): Promise<OfficialSourceSnapshot> {
  if (source.ingestionState === "BLOCKED") {
    throw new Error(`source is blocked: ${source.blocker ?? source.sourceId}`);
  }
  if (!source.archiveEntry || !source.expectedEmbeddedDocumentId || !source.expectedEmbeddedIdentifier) {
    throw new Error(`HKeL source registry entry is incomplete: ${source.sourceId}`);
  }
  assertOfficialUrl(source.fetchUrl, source.officialDomains);
  const response = await (options.fetchImpl ?? fetch)(source.fetchUrl, {
    headers: { Accept: "application/zip,application/octet-stream" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`HKeL fetch failed (${response.status})`);
  if (response.url) assertOfficialUrl(response.url, source.officialDomains);
  const responseType = response.headers.get("content-type")?.split(";")[0] ?? "";
  if (!["application/zip", "application/x-zip-compressed", "application/octet-stream"].includes(responseType)) {
    throw new Error(`unexpected HKeL content type: ${responseType || "missing"}`);
  }
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_ARCHIVE_BYTES) {
    throw new Error(`HKeL archive exceeds allowed size: ${declaredLength}`);
  }
  const archive = new Uint8Array(await response.arrayBuffer());
  if (archive.byteLength === 0 || archive.byteLength > MAX_ARCHIVE_BYTES) {
    throw new Error(`HKeL archive size outside allowed range: ${archive.byteLength}`);
  }
  const archiveChecksumSha256 = sha256(archive);
  const body = extractZipEntry(archive, source.archiveEntry, MAX_XML_BYTES);
  const xml = new TextDecoder().decode(body);
  assertHkelIdentity(xml, source);

  const checksumSha256 = sha256(body);
  const versionId = `${source.documentId}:en:${checksumSha256.slice(0, 24)}`;
  const provisions = extractHkelSections(
    xml,
    versionId,
    source.languageCode,
    source.redistributionRights === "LINK_ONLY" ? "LINK_ONLY" : "UNKNOWN",
  );
  if (provisions.length < source.minimumProvisionCount) {
    throw new Error(
      `HKeL provision count below registry floor: ${provisions.length}/${source.minimumProvisionCount}`,
    );
  }
  const slug = source.officialDocumentId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-$/, "");
  return {
    source,
    body,
    contentType: "application/xml",
    checksumSha256,
    retrievedAt: options.retrievedAt ?? new Date().toISOString(),
    objectKey: `official-sources/hkel/${slug}/${checksumSha256}.xml`,
    objectId: `object:source:${checksumSha256.slice(0, 32)}`,
    versionId,
    provisions,
    retrievalMetadata: {
      containerUrl: source.fetchUrl,
      containerChecksumSha256: archiveChecksumSha256,
      archiveEntry: source.archiveEntry,
      structuredTextLegalStatus: "REFERENCE_ONLY",
    },
  };
}

export function assertHkelIdentity(
  xml: string,
  source: Pick<
    OfficialSourceRegistryEntry,
    "expectedEmbeddedDocumentId" | "expectedEmbeddedIdentifier" | "versionLabel"
  >,
): void {
  const documentId = tagText(xml, "docNumber");
  const identifier = rootAttribute(xml, "identifier");
  const versionDate = tagText(xml, "dc:date");
  if (documentId !== source.expectedEmbeddedDocumentId || identifier !== source.expectedEmbeddedIdentifier) {
    throw new Error(
      `HKeL embedded identity mismatch: document=${documentId ?? "missing"} identifier=${identifier ?? "missing"}`,
    );
  }
  if (versionDate !== source.versionLabel) {
    throw new Error(`HKeL version mismatch: ${versionDate ?? "missing"}/${source.versionLabel}`);
  }
}

export function extractHkelSections(
  xml: string,
  versionId: string,
  languageCode = "en",
  excerptPermission: "LINK_ONLY" | "UNKNOWN" = "LINK_ONLY",
): ProvisionCandidate[] {
  const sections = [...xml.matchAll(/<section\b([^>]*)>([\s\S]*?)<\/section>/gi)];
  const seen = new Set<string>();
  return sections.map((match, ordinal) => {
    const temporalId = attribute(match[1], "temporalId");
    const officialNodeId = attribute(match[1], "id");
    if (!temporalId || !officialNodeId) {
      throw new Error("HKeL section has missing temporalId or official node id");
    }
    const context = sectionContext(xml, match.index ?? 0, temporalId);
    const identity = `${context.scheduleTemporalId ?? "main"}:${context.partTemporalId ?? "none"}:${temporalId}:${officialNodeId}`;
    if (seen.has(identity)) throw new Error(`HKeL section identity is duplicated: ${identity}`);
    seen.add(identity);
    const body = match[2];
    const heading = tagText(body, "heading");
    const provisionText = xmlToText(body);
    const locator = hkelLocator(temporalId, context.scheduleTemporalId, context.partTemporalId);
    return {
      provisionId: `${versionId}:provision:${officialNodeId.toLowerCase()}`,
      locator,
      heading,
      languageCode,
      provisionText,
      textChecksumSha256: sha256(Buffer.from(provisionText, "utf8")),
      ordinal,
      excerptPermission,
    };
  });
}

export function extractZipEntry(
  archive: Uint8Array,
  expectedName: string,
  maxUncompressedBytes: number,
): Uint8Array {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const eocd = findSignature(view, 0x06054b50, Math.max(0, archive.byteLength - 65_557));
  if (eocd < 0) throw new Error("HKeL archive has no ZIP end record");
  const entryCount = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("invalid ZIP central directory");
    const method = view.getUint16(offset + 10, true);
    const expectedCrc = view.getUint32(offset + 16, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(archive.subarray(offset + 46, offset + 46 + nameLength));
    if (name === expectedName) {
      if (uncompressedSize > maxUncompressedBytes) throw new Error("HKeL XML entry exceeds allowed size");
      if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error("invalid ZIP local header");
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = archive.subarray(start, start + compressedSize);
      const body = method === 0
        ? new Uint8Array(compressed)
        : method === 8
          ? new Uint8Array(inflateRawSync(compressed))
          : (() => { throw new Error(`unsupported ZIP compression method: ${method}`); })();
      if (body.byteLength !== uncompressedSize || crc32(body) !== expectedCrc) {
        throw new Error("HKeL ZIP entry integrity check failed");
      }
      return body;
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`HKeL archive entry not found: ${expectedName}`);
}

function hkelLocator(
  temporalId: string,
  scheduleTemporalId: string | null,
  partTemporalId: string | null,
): string {
  const main = temporalId.match(/^s(\d+)$/i);
  if (main && !scheduleTemporalId) return `Section ${main[1]}`;
  const schedule = (scheduleTemporalId ?? temporalId).match(/^sch(\d+)/i);
  const part = (partTemporalId ?? temporalId).match(/_P(\d+)/i);
  const section = temporalId.match(/_s(\d+)$/i) ?? temporalId.match(/^s(\d+)$/i);
  if (schedule) {
    const scheduleLabel = schedule[1] === "0" ? "Schedule" : `Schedule ${schedule[1]}`;
    return `${scheduleLabel}${part ? `, Part ${part[1]}` : ""}, Section ${section?.[1] ?? temporalId}`;
  }
  return temporalId;
}

function sectionContext(xml: string, position: number, temporalId: string): {
  scheduleTemporalId: string | null;
  partTemporalId: string | null;
} {
  const prefix = xml.slice(0, position);
  const scheduleOpen = prefix.lastIndexOf("<schedule");
  const scheduleClose = prefix.lastIndexOf("</schedule>");
  if (scheduleOpen < 0 || scheduleOpen < scheduleClose) {
    return { scheduleTemporalId: null, partTemporalId: null };
  }
  const scheduleTag = prefix.slice(scheduleOpen, prefix.indexOf(">", scheduleOpen) + 1);
  const partOpen = prefix.lastIndexOf("<part");
  const partTag = partOpen > scheduleOpen
    ? prefix.slice(partOpen, prefix.indexOf(">", partOpen) + 1)
    : "";
  return {
    scheduleTemporalId: attribute(scheduleTag, "temporalId") ?? temporalId.match(/^(sch\d+)/i)?.[1] ?? null,
    partTemporalId: attribute(partTag, "temporalId") ?? temporalId.match(/^(sch\d+_P\d+)/i)?.[1] ?? null,
  };
}

function rootAttribute(xml: string, name: string): string | null {
  const opening = xml.match(/<(?:ordinance|subLeg)\b([^>]*)>/i);
  return opening ? attribute(opening[1], name) : null;
}

function attribute(attributes: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return attributes.match(new RegExp(`\\b${escaped}="([^"]*)"`, "i"))?.[1] ?? null;
}

function tagText(xml: string, tag: string): string | null {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = xml.match(new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`, "i"));
  return match ? xmlToText(match[1]) : null;
}

function xmlToText(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = { amp: "&", apos: "'", gt: ">", lt: "<", quot: '"' };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (code[0] !== "#") return named[code.toLowerCase()] ?? entity;
    const radix = code[1]?.toLowerCase() === "x" ? 16 : 10;
    const point = Number.parseInt(radix === 16 ? code.slice(2) : code.slice(1), radix);
    return Number.isFinite(point) ? String.fromCodePoint(point) : entity;
  });
}

function assertOfficialUrl(rawUrl: string, officialDomains: string[]): void {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" || !officialDomains.includes(url.hostname)) {
    throw new Error(`source URL is outside the official allowlist: ${url.hostname}`);
  }
}

function findSignature(view: DataView, signature: number, minimumOffset: number): number {
  for (let offset = view.byteLength - 22; offset >= minimumOffset; offset -= 1) {
    if (view.getUint32(offset, true) === signature) return offset;
  }
  return -1;
}

function crc32(body: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
