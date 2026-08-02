import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import {
  toProvisionalClaimResponse,
  toProvisionalCoverageResponse,
  type ProvisionalClaimRow,
  type ProvisionalCoverageRow,
} from "../lib/legal-corpus/provisional-public";

function claimRow(overrides: Partial<ProvisionalClaimRow> = {}): ProvisionalClaimRow {
  return {
    claim_id: "claim:eea:fixture:1",
    jurisdiction_code: "EEA",
    topic: "issuance-authorization",
    proposition: "Sanitized fixture proposition.",
    legal_status: "REQUIREMENT",
    effective_from: "2024-06-30T00:00:00+00:00",
    effective_to: null,
    release_id: "provisional:eea:1",
    as_of: "2026-08-01T00:00:00+00:00",
    knowledge_cutoff: "2026-07-30T00:00:00+00:00",
    assurance_level: "PROVISIONAL_PUBLISHED",
    human_reviewed: false,
    confidence: 0.87,
    limitations: ["Provisional machine-published evidence; not human-reviewed legal advice."],
    counsel_triggers: ["PROVISIONAL_EVIDENCE_REVIEW_RECOMMENDED"],
    source_version_id: "version:eea:fixture:1",
    source_checksum_sha256: "b".repeat(64),
    source_retrieved_at: "2026-07-30T00:00:00+00:00",
    source_official_url: "https://official.example.eu/instrument",
    citations: [
      { provisionId: "provision:eea:fixture:a36", locator: "Article 36(1)" },
    ],
    ...overrides,
  };
}

test("provisional claim responses carry the full mandatory envelope", () => {
  const response = toProvisionalClaimResponse(claimRow());
  assert.equal(response.schemaVersion, "1.0.0");
  assert.equal(response.assuranceLevel, "PROVISIONAL_PUBLISHED");
  assert.equal(response.reviewStatus, "PROVISIONAL");
  assert.equal(response.confidence, 0.87);
  assert.equal(response.asOf, "2026-08-01T00:00:00+00:00");
  assert.equal(response.sourceVersion.checksumSha256, "b".repeat(64));
  assert.equal(response.citations.length, 1);
  assert.ok(response.limitations.length > 0);
  assert.ok(response.counselTriggers.length > 0);
});

test("machine rows can never be labeled human-reviewed", () => {
  const response = toProvisionalClaimResponse(claimRow({ human_reviewed: false }));
  assert.equal(response.reviewStatus, "PROVISIONAL");
  // only an actual named-human review record row flips the label
  const upgraded = toProvisionalClaimResponse(claimRow({ human_reviewed: true }));
  assert.equal(upgraded.reviewStatus, "HUMAN_REVIEWED");
});

test("responses validate against the committed provisional-claim schema", async () => {
  const schema = JSON.parse(
    await readFile(
      path.join(process.cwd(), "contracts", "v1", "provisional-claim.schema.json"),
      "utf8",
    ),
  );
  const ajv = new Ajv2020({ strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  const response = toProvisionalClaimResponse(claimRow());
  assert.equal(validate(response), true, JSON.stringify(validate.errors));

  // every envelope field is required
  for (const field of [
    "assuranceLevel",
    "reviewStatus",
    "confidence",
    "asOf",
    "sourceVersion",
    "citations",
    "limitations",
    "counselTriggers",
  ]) {
    const broken = { ...response } as Record<string, unknown>;
    delete broken[field];
    assert.equal(validate(broken), false, `${field} must be required`);
  }

  const unknownField = { ...response, internalRule: "secret" };
  assert.equal(validate(unknownField), false);

  const humanLevelSmuggled = { ...response, assuranceLevel: "HUMAN_REVIEWED" };
  assert.equal(validate(humanLevelSmuggled), false, "assuranceLevel enum has no human value");
});

test("provisional coverage aggregates never claim reviewed completeness", async () => {
  const rows: ProvisionalCoverageRow[] = [
    {
      jurisdiction_code: "EEA",
      provisional_claim_count: 42,
      latest_release_id: "provisional:eea:1",
      as_of: "2026-08-01T00:00:00+00:00",
      knowledge_cutoff: "2026-07-30T00:00:00+00:00",
      published_at: "2026-08-02T00:00:00+00:00",
    },
  ];
  const response = toProvisionalCoverageResponse(rows);
  assert.equal(response.schemaVersion, "1.0.0");
  assert.equal(response.markets[0].reviewStatus, "PROVISIONAL");
  assert.equal(response.markets[0].provisionalClaimCount, 42);
  assert.ok(!("completenessPercent" in response.markets[0]));

  const schema = JSON.parse(
    await readFile(
      path.join(
        process.cwd(),
        "contracts",
        "v1",
        "provisional-coverage-response.schema.json",
      ),
      "utf8",
    ),
  );
  const ajv = new Ajv2020({ strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  assert.equal(validate(response), true, JSON.stringify(validate.errors));
});
