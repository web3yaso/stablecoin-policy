import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  assertHkelIdentity,
  extractHkelSections,
  extractZipEntry,
  fetchHkelSource,
} from "../lib/legal-corpus/ingestion/hkel";
import type { OfficialSourceRegistryEntry } from "../lib/legal-corpus/ingestion/types";

const ENTRY = "cap_656A_en_c\\cap_656A_20250801000000_en_c.xml";
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<subLeg identifier="/hk/cap656A!en" xml:lang="en">
  <meta><docNumber>656A</docNumber><dc:date>2025-08-01</dc:date></meta>
  <main>
    <section id="ID_main_1" name="s1" temporalId="s1"><num>1.</num><heading>Application</heading><content>First rule.</content></section>
    <schedule temporalId="sch1"><part temporalId="sch1_P2"><num>Part 2</num></part><section id="ID_schedule_2" name="s2" temporalId="sch1_s2"><num>2.</num><heading>Schedule rule</heading><content>Source instructions remain data.</content></section></schedule>
  </main>
</subLeg>`;

const SOURCE: OfficialSourceRegistryEntry = {
  sourceId: "hk-fixture",
  provider: "hkel",
  ingestionState: "ACTIVE",
  authorityId: "authority:hk:department-of-justice",
  authorityName: "Department of Justice, Hong Kong SAR",
  authorityType: "OFFICIAL_REGISTER",
  jurisdictionCode: "HK",
  officialDomains: ["resource.data.one.gov.hk"],
  documentId: "document:hk:cap:656a",
  officialDocumentId: "Cap. 656A",
  documentType: "SUBSIDIARY_LEGISLATION",
  title: "Fixture",
  canonicalUrl: "https://www.elegislation.gov.hk/hk/cap656A!en",
  fetchUrl: "https://resource.data.one.gov.hk/doj/data/archive.zip",
  archiveEntry: ENTRY,
  expectedEmbeddedDocumentId: "656A",
  expectedEmbeddedIdentifier: "/hk/cap656A!en",
  languageCode: "en",
  versionLabel: "2025-08-01",
  effectiveFrom: "2025-08-01T00:00:00.000Z",
  redistributionRights: "LINK_ONLY",
  licenceIdentifier: null,
  minimumProvisionCount: 2,
};

test("HKeL ZIP extraction verifies entry bytes and integrity", () => {
  const archive = storedZip(ENTRY, Buffer.from(XML));
  assert.equal(new TextDecoder().decode(extractZipEntry(archive, ENTRY, 1_000_000)), XML);
  const corrupted = new Uint8Array(archive);
  corrupted[30 + Buffer.byteLength(ENTRY) + 5] ^= 1;
  assert.throws(() => extractZipEntry(corrupted, ENTRY, 1_000_000), /integrity check/);
});

test("HKeL extraction uses stable section and schedule locators", () => {
  const provisions = extractHkelSections(XML, "version:fixture");
  assert.deepEqual(provisions.map((item) => item.locator), [
    "Section 1",
    "Schedule 1, Part 2, Section 2",
  ]);
  assert.equal(provisions[0].heading, "Application");
  assert.equal(provisions[0].excerptPermission, "LINK_ONLY");
});

test("HKeL identity guard fails closed on the observed Cap. 656 mismatch", () => {
  const mismatched = XML
    .replace("/hk/cap656A!en", "/hk/cap155!en")
    .replace("<docNumber>656A</docNumber>", "<docNumber>155</docNumber>");
  assert.throws(() => assertHkelIdentity(mismatched, SOURCE), /embedded identity mismatch/);
});

test("blocked HKeL registry sources never reach the network", async () => {
  let called = false;
  await assert.rejects(
    fetchHkelSource(
      { ...SOURCE, ingestionState: "BLOCKED", blocker: "identity mismatch" },
      { fetchImpl: async () => { called = true; return zipResponse(storedZip(ENTRY, Buffer.from(XML))); } },
    ),
    /source is blocked/,
  );
  assert.equal(called, false);
});

test("HKeL snapshot pins archive and extracted XML provenance", async () => {
  const archive = storedZip(ENTRY, Buffer.from(XML));
  const snapshot = await fetchHkelSource(SOURCE, {
    retrievedAt: "2026-08-01T00:00:00.000Z",
    fetchImpl: async () => zipResponse(archive),
  });
  assert.equal(snapshot.provisions.length, 2);
  assert.equal(snapshot.contentType, "application/xml");
  assert.equal(snapshot.retrievalMetadata.archiveEntry, ENTRY);
  assert.match(String(snapshot.retrievalMetadata.containerChecksumSha256), /^[0-9a-f]{64}$/);
  assert.match(snapshot.objectKey, /official-sources\/hkel\/cap-656a\/[0-9a-f]{64}\.xml/);
});

test("retrieval provenance migration is service-only and append-safe", async () => {
  const sql = await readFile(
    path.join(process.cwd(), "supabase/migrations/0006_source_retrieval_provenance.sql"),
    "utf8",
  );
  assert.match(sql, /add column retrieval_metadata jsonb not null/);
  assert.match(sql, /grant execute on function policy\.ingest_official_source_v2[\s\S]*to service_role/);
  assert.match(sql, /from public, anon, authenticated/);
  assert.doesNotMatch(sql, /insert into policy\.legal_claims/i);
});

function zipResponse(body: Uint8Array): Response {
  return new Response(body.slice().buffer as ArrayBuffer, {
    status: 200,
    headers: { "content-type": "application/zip" },
  });
}

function storedZip(name: string, body: Uint8Array): Uint8Array {
  const nameBytes = Buffer.from(name, "utf8");
  const checksum = crc32(body);
  const local = Buffer.alloc(30 + nameBytes.length + body.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 8);
  local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(body.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  nameBytes.copy(local, 30);
  Buffer.from(body).copy(local, 30 + nameBytes.length);

  const central = Buffer.alloc(46 + nameBytes.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 10);
  central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(body.length, 20);
  central.writeUInt32LE(body.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  nameBytes.copy(central, 46);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(local.length, 16);
  return new Uint8Array(Buffer.concat([local, central, end]));
}

function crc32(body: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
