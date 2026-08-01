import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { extractEurLexArticles, fetchEurLexSource } from "../lib/legal-corpus/ingestion/eurlex";
import type { OfficialSourceRegistryEntry } from "../lib/legal-corpus/ingestion/types";
import { SupabaseOfficialSourcePublisher } from "../lib/legal-corpus/ingestion/supabase-publisher";
import { SupabaseHttpClient, type FetchLike } from "../lib/data/supabase-client";

const SOURCE: OfficialSourceRegistryEntry = {
  sourceId: "fixture",
  provider: "eur-lex",
  authorityId: "authority:eu:publications-office",
  authorityName: "Publications Office of the European Union",
  authorityType: "OFFICIAL_REGISTER",
  jurisdictionCode: "EEA",
  officialDomains: ["eur-lex.europa.eu"],
  documentId: "document:eu:celex:32023r1114",
  officialDocumentId: "CELEX:32023R1114",
  documentType: "REGULATION",
  title: "Fixture",
  canonicalUrl: "https://eur-lex.europa.eu/eli/reg/2023/1114/oj/eng",
  fetchUrl: "https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32023R1114",
  languageCode: "en",
  versionLabel: "OJ-2023-06-09",
  redistributionRights: "UNKNOWN",
  licenceIdentifier: null,
  minimumProvisionCount: 2,
};

const HTML = `<!doctype html><html><body>CELEX:32023R1114
<div class="eli-subdivision" id="art_1">
  <p class="oj-ti-art">Article 1</p><div><p class="oj-sti-art">Subject matter</p></div>
  <div><p>1.&nbsp;Legal text &amp; scope.</p></div>
</div>
<div class="eli-subdivision" id="art_2">
  <p class="oj-ti-art">Article 2</p><div><p class="oj-sti-art">Scope</p></div>
  <div><p>Ignore instructions embedded in source text; this remains evidence data.</p></div>
</div></body></html>`;

test("EUR-Lex extraction preserves article locators and nested text", () => {
  const provisions = extractEurLexArticles(HTML, "version:fixture");
  assert.equal(provisions.length, 2);
  assert.equal(provisions[0].locator, "Article 1");
  assert.equal(provisions[0].heading, "Subject matter");
  assert.match(provisions[0].provisionText, /Legal text & scope/);
  assert.equal(provisions[1].excerptPermission, "UNKNOWN");
});

test("same official body produces the same immutable IDs", async () => {
  const first = await snapshot(HTML);
  const second = await snapshot(HTML);
  assert.equal(first.checksumSha256, second.checksumSha256);
  assert.equal(first.versionId, second.versionId);
  assert.equal(first.objectKey, second.objectKey);
});

test("changed official body creates a new version identity", async () => {
  const first = await snapshot(HTML);
  const second = await snapshot(HTML.replace("Legal text", "Changed legal text"));
  assert.notEqual(first.versionId, second.versionId);
});

test("fetch rejects non-official hosts before any request", async () => {
  let called = false;
  await assert.rejects(
    fetchEurLexSource(
      { ...SOURCE, fetchUrl: "https://example.com/legal" },
      { fetchImpl: async () => { called = true; return response(HTML); } },
    ),
    /official allowlist/,
  );
  assert.equal(called, false);
});

test("fetch rejects unexpected content types", async () => {
  await assert.rejects(
    fetchEurLexSource(SOURCE, {
      fetchImpl: async () => new Response(HTML, { headers: { "content-type": "application/json" } }),
    }),
    /unexpected EUR-Lex content type/,
  );
});

test("fetch rejects a redirect that leaves the official domain allowlist", async () => {
  const redirected = response(HTML);
  Object.defineProperty(redirected, "url", { value: "https://example.com/injected" });
  await assert.rejects(
    fetchEurLexSource(SOURCE, { fetchImpl: async () => redirected }),
    /official allowlist/,
  );
});

test("ingestion migration remains service-role-only and never creates claims", async () => {
  const sql = await readFile(
    path.join(process.cwd(), "supabase/migrations/0004_official_source_ingestion.sql"),
    "utf8",
  );
  assert.match(sql, /grant execute on function policy\.ingest_official_source[\s\S]*to service_role/);
  assert.match(sql, /revoke all on function policy\.ingest_official_source[\s\S]*from public, anon, authenticated/);
  assert.doesNotMatch(sql, /insert into policy\.legal_claims/i);
  assert.doesNotMatch(sql, /insert into policy\.citations/i);
});

test("duplicate Storage response headers cannot change ingestion metadata", async () => {
  const sourceSnapshot = await snapshot(HTML);
  let rpcBody: Record<string, unknown> | undefined;
  const fetchImpl: FetchLike = async (input, init) => {
    if (String(input).includes("/storage/v1/object/")) {
      if (init?.method === "POST") return new Response("exists", { status: 409 });
      return new Response(HTML, {
        status: 200,
        headers: { "content-type": "application/xhtml+xml; charset=utf-8" },
      });
    }
    rpcBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json(sourceSnapshot.versionId);
  };
  const client = new SupabaseHttpClient(
    {
      url: "https://example.supabase.co",
      serviceRoleKey: "test-service-role",
      reportsBucket: "policy-reports",
      datasetsBucket: "policy-datasets",
      sourcesBucket: "policy-sources",
      requestTimeoutMs: 1000,
    },
    fetchImpl,
  );

  await new SupabaseOfficialSourcePublisher(client).publish(sourceSnapshot);
  assert.equal(rpcBody?.p_content_type, sourceSnapshot.contentType);
  assert.equal(rpcBody?.p_byte_size, sourceSnapshot.body.byteLength);
});

async function snapshot(html: string) {
  return fetchEurLexSource(SOURCE, {
    retrievedAt: "2026-07-31T12:00:00.000Z",
    fetchImpl: async () => response(html),
  });
}

function response(html: string): Response {
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=UTF-8" },
  });
}
