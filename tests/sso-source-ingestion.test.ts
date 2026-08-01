import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSsoIdentity,
  extractSsoSections,
  fetchSsoSource,
} from "../lib/legal-corpus/ingestion/sso";
import type { OfficialSourceRegistryEntry } from "../lib/legal-corpus/ingestion/types";
import { sha256 } from "../lib/data/integrity";

const PDF = new TextEncoder().encode("%PDF-1.7\nfixture");

const SOURCE: OfficialSourceRegistryEntry = {
  sourceId: "sg-fixture",
  provider: "sso",
  ingestionState: "ACTIVE",
  authorityId: "authority:sg:attorney-generals-chambers",
  authorityName: "Attorney-General's Chambers, Singapore",
  authorityType: "OFFICIAL_REGISTER",
  jurisdictionCode: "SG",
  officialDomains: ["sso.agc.gov.sg"],
  documentId: "document:sg:act:psa2019",
  officialDocumentId: "PSA2019",
  documentType: "ACT",
  title: "Payment Services Act 2019",
  canonicalUrl: "https://sso.agc.gov.sg/Act/PSA2019?ValidDate=20250309",
  fetchUrl: "https://sso.agc.gov.sg/Act/PSA2019?ValidDate=20250309&ViewType=Print",
  ssoDocumentType: "Act",
  ssoDocumentNumber: "PSA2019",
  ssoValidDate: "20250309",
  ssoPdfUrl: "https://sso.agc.gov.sg/Act/PSA2019?ValidDate=20250309&ViewType=Pdf",
  ssoExpectedPdfChecksumSha256: sha256(PDF),
  languageCode: "en",
  versionLabel: "2025-03-09",
  effectiveFrom: "2025-03-09T00:00:00.000Z",
  redistributionRights: "FULL_TEXT",
  licenceIdentifier: "SSO Terms of Use clause 13",
  minimumProvisionCount: 2,
};

const FORM_HTML = `<html><div class="global-vars" data-json='{"ajaxToken":"fixture-token"}'></div></html>`;
const EXPORT_HTML = `<!doctype html><html><head>
<title>Payment Services Act 2019 - Singapore Statutes Online</title></head><body>
<div class="prov1"><table><tr><td class="prov1Hdr" id="pr1-"><span>Short title</span></td></tr></table>
<table><tr><td class="prov1Txt"><strong>1.</strong> This Act is the Payment Services Act 2019.</td></tr></table></div>
<div class="prov1"><table><tr><td class="prov1Hdr" id="pr21A-"><span>Digital payment token requirements</span></td></tr></table>
<table><tr><td class="prov1Txt"><strong>21A.</strong> Source instructions remain evidence data.</td></tr></table></div>
<div class="prov1Rep" id="pr22-"><table><tr><td class="prov1RepText"><strong>22.</strong> [Repealed]</td></tr></table></div>
<div class="global-vars" data-json='{"printViewFilter":{"DocNo":"PSA2019","ValidDate":"20250309"}}'></div>
</body></html>`;
test("SSO extraction preserves alphanumeric section locators and nested text", () => {
  const provisions = extractSsoSections(EXPORT_HTML, "version:fixture", "en", "ALLOWED");
  assert.deepEqual(provisions.map((item) => item.locator), ["Section 1", "Section 21A", "Section 22"]);
  assert.equal(provisions[1].heading, "Digital payment token requirements");
  assert.equal(provisions[2].heading, "[Repealed]");
  assert.match(provisions[1].provisionText, /Source instructions remain evidence data/);
  assert.equal(provisions[1].excerptPermission, "ALLOWED");
});

test("SSO identity guard pins title, document number and valid date", () => {
  assert.doesNotThrow(() => assertSsoIdentity(EXPORT_HTML, SOURCE));
  assert.throws(
    () => assertSsoIdentity(EXPORT_HTML.replace("PSA2019", "WRONG"), SOURCE),
    /identity mismatch/,
  );
});

test("SSO snapshot stores the stable PDF and deterministic provision-set provenance", async () => {
  const calls: Array<{ url: string; method: string; body: string }> = [];
  const snapshot = await fetchSsoSource(SOURCE, {
    retrievedAt: "2026-08-01T00:00:00.000Z",
    fetchImpl: async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: String(init?.body ?? "") });
      if (method === "POST") return htmlResponse(EXPORT_HTML);
      if (url.includes("ViewType=Pdf")) return pdfResponse(PDF);
      return htmlResponse(FORM_HTML);
    },
  });

  assert.equal(calls.length, 3);
  assert.equal(calls[1].method, "POST");
  assert.match(calls[1].body, /CSRF_Token=fixture-token/);
  assert.match(calls[1].body, /ProvIds=all-\.%2Ctoc-\./);
  assert.equal(snapshot.contentType, "application/pdf");
  assert.equal(new TextDecoder().decode(snapshot.body), new TextDecoder().decode(PDF));
  assert.equal(snapshot.provisions.length, 3);
  assert.match(snapshot.objectKey, /official-sources\/sso\/psa2019\/[0-9a-f]{64}\.pdf/);
  assert.match(
    String(snapshot.retrievalMetadata.provisionSetChecksumSha256),
    /^[0-9a-f]{64}$/,
  );
  assert.equal(snapshot.retrievalMetadata.sourceTextAuthority, "OFFICIAL_UNOFFICIAL_CONSOLIDATION");
});

test("same SSO PDF and legal text produce stable version metadata despite dynamic page fields", async () => {
  const first = await snapshot(EXPORT_HTML);
  const second = await snapshot(
    EXPORT_HTML.replace("</head>", '<script nonce="different-dynamic-value"></script></head>'),
  );
  assert.equal(first.versionId, second.versionId);
  assert.deepEqual(first.retrievalMetadata, second.retrievalMetadata);
});

test("SSO adapter rejects incomplete registry entries before the network", async () => {
  let called = false;
  await assert.rejects(
    fetchSsoSource(
      { ...SOURCE, ssoValidDate: undefined },
      { fetchImpl: async () => { called = true; return htmlResponse(FORM_HTML); } },
    ),
    /registry entry is incomplete/,
  );
  assert.equal(called, false);
});

test("SSO adapter fails closed when the pinned PDF bytes change", async () => {
  await assert.rejects(
    fetchSsoSource(
      { ...SOURCE, ssoExpectedPdfChecksumSha256: "a".repeat(64) },
      {
        fetchImpl: async (input, init) => {
          if (init?.method === "POST") return htmlResponse(EXPORT_HTML);
          if (String(input).includes("ViewType=Pdf")) return pdfResponse(PDF);
          return htmlResponse(FORM_HTML);
        },
      },
    ),
    /PDF checksum mismatch/,
  );
});

async function snapshot(exportHtml: string) {
  return fetchSsoSource(SOURCE, {
    retrievedAt: "2026-08-01T00:00:00.000Z",
    fetchImpl: async (input, init) => {
      if (init?.method === "POST") return htmlResponse(exportHtml);
      if (String(input).includes("ViewType=Pdf")) return pdfResponse(PDF);
      return htmlResponse(FORM_HTML);
    },
  });
}

function htmlResponse(html: string): Response {
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function pdfResponse(body: Uint8Array): Response {
  return new Response(body.slice().buffer as ArrayBuffer, {
    status: 200,
    headers: { "content-type": "application/pdf" },
  });
}
