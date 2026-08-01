import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import {
  claimAppliesAsOf,
  evaluateClaimPublication,
  toSourceDocumentCandidate,
} from "../lib/legal-corpus/policy";
import type { LegalClaim } from "../lib/legal-corpus/types";
import { SupabaseHttpClient, type FetchLike } from "../lib/data/supabase-client";
import { SupabasePublicLegalCorpusRepository } from "../lib/legal-corpus/supabase-public-repository";

const CHECKSUM = "a".repeat(64);

test("existing official-feed output remains discovery-only until provision review", () => {
  const candidate = toSourceDocumentCandidate({
    id: "federal-register:2026-12345",
    source: "Federal Register",
    date: "2026-07-31T12:00:00.000Z",
    url: "https://www.federalregister.gov/documents/2026/07/31/2026-12345/example",
    sourceId: "federal-register",
    sourceType: "official-api",
    sourceAuthority: "Federal Register",
    officialDocumentId: "2026-12345",
    sourceVersion: "2026-07-31",
    documentType: "rule",
    retrievedAt: "2026-07-31T13:00:00.000Z",
  });

  assert.equal(candidate.evidenceLayer, "NEWS_DISCOVERY");
  assert.equal(candidate.evidenceUse, "DISCOVERY_ONLY");
  assert.equal(candidate.officialDocumentId, "2026-12345");
});

test("permission requires reviewed direct official provision evidence", () => {
  const claim = fixtureClaim();
  assert.deepEqual(evaluateClaimPublication(claim), { publishable: true });

  claim.citations[0].evidence.evidenceUse = "DISCOVERY_ONLY";
  assert.deepEqual(evaluateClaimPublication(claim), {
    publishable: false,
    reason: "NON_AUTHORITATIVE_PERMISSION_EVIDENCE",
  });
});

test("contradicting evidence blocks publication and requires review", () => {
  const claim = fixtureClaim();
  claim.citations.push({
    ...claim.citations[0],
    citationId: "citation:contradiction",
    relation: "CONTRADICTS",
  });
  assert.deepEqual(evaluateClaimPublication(claim), {
    publishable: false,
    reason: "CONFLICTING_EVIDENCE",
  });
});

test("as-of selection uses a half-open legal effective interval", () => {
  const claim = fixtureClaim();
  claim.effectiveFrom = "2026-01-01T00:00:00.000Z";
  claim.effectiveTo = "2027-01-01T00:00:00.000Z";

  assert.equal(claimAppliesAsOf(claim, "2025-12-31"), false);
  assert.equal(claimAppliesAsOf(claim, "2026-01-01"), true);
  assert.equal(claimAppliesAsOf(claim, "2026-12-31"), true);
  assert.equal(claimAppliesAsOf(claim, "2027-01-01"), false);
});

test("reviewed legal claim wire payload satisfies the v1 contract", async () => {
  const schema = JSON.parse(
    await readFile(
      path.join(process.cwd(), "contracts/v1/legal-claim.schema.json"),
      "utf8",
    ),
  );
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const payload = { schemaVersion: "1.0.0", ...fixtureClaim() };

  assert.equal(validate(payload), true, JSON.stringify(validate.errors));
});

test("phase2 migration keeps reviewer data out of public views", async () => {
  const sql = await readFile(
    path.join(process.cwd(), "db/migrations/0003_phase2_legal_corpus_foundation.sql"),
    "utf8",
  );
  const publicViews = sql.slice(sql.indexOf("create view policy.public_legal_evidence"));

  assert.match(sql, /create schema if not exists regulatory/);
  assert.match(sql, /alter table policy\.review_records enable row level security/);
  assert.doesNotMatch(publicViews, /reviewer_ref/);
  assert.doesNotMatch(publicViews, /private_notes/);
  assert.doesNotMatch(publicViews, /decision_rule/i);
  assert.doesNotMatch(publicViews, /playbook_action/i);
});

test("public corpus repository maps launch coverage without inventing completeness", async () => {
  const fetchImpl: FetchLike = async () =>
    Response.json([
      {
        jurisdiction_code: "EEA",
        display_name: "European Economic Area",
        coverage_state: "IN_PROGRESS",
        completeness_percent: 0,
        freshness_state: "UNKNOWN",
        reviewed_at: null,
        public_note: "Baseline legal corpus under review.",
        release_id: null,
        as_of: null,
        knowledge_cutoff: null,
        reviewed_claim_count: 0,
        source_document_count: 0,
        last_verified_at: null,
      },
    ]);
  const repository = new SupabasePublicLegalCorpusRepository(client(fetchImpl));
  const response = await repository.getCoverage();

  assert.equal(response.dataAsOf, null);
  assert.equal(response.markets[0].coverageState, "IN_PROGRESS");
  assert.equal(response.markets[0].reviewedClaimCount, 0);
});

test("public source repository returns only the newest published corpus release", async () => {
  const requests: string[] = [];
  const fetchImpl: FetchLike = async (input) => {
    requests.push(String(input));
    return Response.json([
      evidenceRow("corpus:new", "claim:new"),
      evidenceRow("corpus:old", "claim:old"),
    ]);
  };
  const repository = new SupabasePublicLegalCorpusRepository(client(fetchImpl));
  const response = await repository.findSource("document:mica:2023-1114");

  assert.equal(response?.corpusReleaseId, "corpus:new");
  assert.deepEqual(response?.evidence.map((item) => item.claimId), ["claim:new"]);
  assert.match(requests[0], /document_id=eq\.document%3Amica%3A2023-1114/);
});

test("Phase 2 public API payloads satisfy their versioned contracts", async () => {
  const coverage = {
    schemaVersion: "1.0.0",
    dataAsOf: null,
    markets: [
      {
        jurisdictionCode: "HK",
        displayName: "Hong Kong",
        coverageState: "IN_PROGRESS",
        completenessPercent: 0,
        freshnessState: "UNKNOWN",
        reviewedAt: null,
        publicNote: "Baseline legal corpus under review.",
        corpusReleaseId: null,
        asOf: null,
        knowledgeCutoff: null,
        reviewedClaimCount: 0,
        sourceDocumentCount: 0,
        lastVerifiedAt: null,
      },
    ],
  };
  const sourceRepository = new SupabasePublicLegalCorpusRepository(
    client(async () => Response.json([evidenceRow("corpus:new", "claim:new")])),
  );
  const source = await sourceRepository.findSource("document:mica:2023-1114");
  const changes = { schemaVersion: "1.0.0", changes: [], nextCursor: null };

  await assertContract("coverage-response.schema.json", coverage);
  await assertContract("source-response.schema.json", source);
  await assertContract("changes-response.schema.json", changes);
});

function fixtureClaim(): LegalClaim {
  return {
    claimId: "claim:eea:market-access:1",
    jurisdictionCode: "EEA",
    topic: "market-access",
    proposition: "A reviewed fixture proposition.",
    legalStatus: "PERMISSION",
    reviewState: "REVIEWED",
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    knowledgeCutoff: "2026-07-31T00:00:00.000Z",
    citations: [
      {
        citationId: "citation:eea:market-access:1",
        relation: "DIRECT_SUPPORT",
        evidence: {
          provisionId: "provision:mica:48-1",
          sourceVersionId: "version:mica:2023-1114:oj",
          authorityId: "authority:eu:official-journal",
          locator: "Article 48(1)",
          canonicalUrl: "https://eur-lex.europa.eu/eli/reg/2023/1114/oj",
          evidenceLayer: "OFFICIAL_SOURCE",
          evidenceUse: "LEGAL_AUTHORITY",
          versionChecksumSha256: CHECKSUM,
        },
      },
    ],
  };
}

function client(fetchImpl: FetchLike): SupabaseHttpClient {
  return new SupabaseHttpClient(
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
}

function evidenceRow(releaseId: string, claimId: string) {
  return {
    release_id: releaseId,
    claim_id: claimId,
    jurisdiction_code: "EEA",
    topic: "market-access",
    proposition: "Fixture proposition",
    legal_status: "PERMISSION",
    effective_from: "2026-01-01T00:00:00+00:00",
    effective_to: null,
    citation_id: `citation:${claimId}`,
    support_relation: "DIRECT_SUPPORT",
    exact_locator: "Article 48(1)",
    allowed_excerpt: null,
    provision_id: "provision:mica:48-1",
    version_id: "version:mica:oj",
    version_checksum_sha256: CHECKSUM,
    published_at: "2023-06-09T00:00:00+00:00",
    retrieved_at: "2026-07-31T00:00:00+00:00",
    verified_at: "2026-07-31T00:00:00+00:00",
    document_id: "document:mica:2023-1114",
    document_title: "Regulation (EU) 2023/1114",
    document_type: "REGULATION",
    canonical_url: "https://eur-lex.europa.eu/eli/reg/2023/1114/oj",
    authority_id: "authority:eu:official-journal",
    authority_name: "Official Journal of the European Union",
  };
}

async function assertContract(schemaFile: string, payload: unknown) {
  const schema = JSON.parse(
    await readFile(path.join(process.cwd(), "contracts/v1", schemaFile), "utf8"),
  );
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  assert.equal(validate(payload), true, JSON.stringify(validate.errors));
}
