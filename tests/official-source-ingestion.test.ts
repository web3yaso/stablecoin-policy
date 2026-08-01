import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { extractEurLexArticles, fetchEurLexSource } from "../lib/legal-corpus/ingestion/eurlex";
import type { OfficialSourceRegistryEntry } from "../lib/legal-corpus/ingestion/types";
import {
  assertSourceStorageRights,
  SupabaseOfficialSourcePublisher,
} from "../lib/legal-corpus/ingestion/supabase-publisher";
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
  redistributionRights: "FULL_TEXT",
  licenceIdentifier: "Fixture commercial reuse terms",
  storageRights: "ALLOWED",
  rightsReviewedAt: "2026-07-31T00:00:00.000Z",
  rightsBasis: "Fixture rights review",
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
  assert.ok(first.provisions.every((provision) => provision.excerptPermission === "ALLOWED"));
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

test("ingestion status RPC is service-only and exposes no provision text", async () => {
  const sql = await readFile(
    path.join(process.cwd(), "supabase/migrations/0005_official_source_ingestion_status.sql"),
    "utf8",
  );
  assert.match(sql, /grant execute on function policy\.get_official_source_ingestion_status\(text\)[\s\S]*to service_role/);
  assert.match(sql, /revoke all on function policy\.get_official_source_ingestion_status\(text\)[\s\S]*from public, anon, authenticated/);
  assert.doesNotMatch(sql, /provision_text/i);
  assert.doesNotMatch(sql, /legal_claims/i);
  assert.doesNotMatch(sql, /review_records/i);
});

test("storage-rights migration fails closed in the database and stays service-only", async () => {
  const sql = await readFile(
    path.join(process.cwd(), "supabase/migrations/0007_source_storage_rights_gate.sql"),
    "utf8",
  );
  assert.match(sql, /storage_rights <> 'ALLOWED'/);
  assert.match(sql, /rights_reviewed_at is not null/);
  assert.match(sql, /official source storage rights do not permit ingestion/);
  assert.match(sql, /grant execute on function policy\.ingest_official_source_v3[\s\S]*to service_role/);
  assert.match(sql, /from public, anon, authenticated/);
  assert.doesNotMatch(sql, /insert into policy\.legal_claims/i);
  assert.doesNotMatch(sql, /insert into policy\.citations/i);
});

test("rights reconciliation only promotes observed unknown permissions", async () => {
  const sql = await readFile(
    path.join(process.cwd(), "supabase/migrations/0008_source_rights_reconciliation.sql"),
    "utf8",
  );
  assert.match(sql, /v_document\.redistribution_rights not in \('UNKNOWN', v_redistribution_rights\)/);
  assert.match(sql, /v_version\.lifecycle_state <> 'OBSERVED'/);
  assert.match(sql, /existing\.excerpt_permission = 'UNKNOWN'/);
  assert.match(sql, /source provision excerpt-permission conflict/);
  assert.match(sql, /grant execute on function policy\.ingest_official_source_v4[\s\S]*to service_role/);
  assert.match(sql, /from public, anon, authenticated/);
  assert.doesNotMatch(sql, /insert into policy\.legal_claims/i);
});

test("provision rights reviews overlay immutable extraction-time permissions", async () => {
  const sql = await readFile(
    path.join(process.cwd(), "supabase/migrations/0009_provision_rights_review_overlay.sql"),
    "utf8",
  );
  assert.match(sql, /create table regulatory\.provision_rights_reviews/);
  assert.match(sql, /existing\.excerpt_permission = 'UNKNOWN'/);
  assert.match(sql, /coalesce\(review\.excerpt_permission, provision\.excerpt_permission\)/);
  assert.match(sql, /reject_immutable_row_change/);
  assert.match(sql, /grant execute on function policy\.ingest_official_source_v5[\s\S]*to service_role/);
  assert.doesNotMatch(sql, /update regulatory\.provisions/i);
  assert.doesNotMatch(sql, /insert into policy\.legal_claims/i);
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
  assert.equal(rpcBody?.p_version && (rpcBody.p_version as Record<string, unknown>).storageRights, "ALLOWED");
});

test("publisher rejects unreviewed storage rights before Storage or RPC calls", async () => {
  const sourceSnapshot = await snapshot(HTML);
  let calls = 0;
  const client = new SupabaseHttpClient(
    {
      url: "https://example.supabase.co",
      serviceRoleKey: "test-service-role",
      reportsBucket: "policy-reports",
      datasetsBucket: "policy-datasets",
      sourcesBucket: "policy-sources",
      requestTimeoutMs: 1000,
    },
    async () => {
      calls += 1;
      return new Response(null, { status: 500 });
    },
  );

  await assert.rejects(
    new SupabaseOfficialSourcePublisher(client).publish({
      ...sourceSnapshot,
      source: {
        ...sourceSnapshot.source,
        storageRights: "REVIEW_REQUIRED",
        rightsReviewedAt: undefined,
        rightsBasis: undefined,
      },
    }),
    /storage rights do not permit upload/,
  );
  assert.equal(calls, 0);
});

test("allowed storage rights require a dated review and recorded basis", () => {
  assert.throws(
    () => assertSourceStorageRights({
      sourceId: "missing-review",
      storageRights: "ALLOWED",
    }),
    /rights review is incomplete/,
  );
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
