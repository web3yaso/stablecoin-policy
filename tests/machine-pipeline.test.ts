import assert from "node:assert/strict";
import test from "node:test";
import {
  compareCrossCheck,
  parseExtractionOutput,
  replayChecksum,
  runDeterministicChecks,
  toClaimDraftBundle,
  type DeterministicCheckInput,
  type ExtractedClaimDraft,
  type ExtractionRun,
} from "../lib/legal-corpus/machine-pipeline";
import { assertClaimDraftBundle } from "../lib/legal-corpus/claim-draft-import";
import type { SourceVerificationManifest } from "../lib/legal-corpus/verification";

const NOW = "2026-08-02T00:00:00.000Z";

function manifest(
  overrides: Partial<SourceVerificationManifest> = {},
): SourceVerificationManifest {
  return {
    schemaVersion: "1.0.0",
    versionId: "version:eea:fixture:1",
    documentId: "document:eea:fixture",
    versionLabel: "fixture-v1",
    rawObjectId: "object:fixture",
    checksumSha256: "b".repeat(64),
    officialUrl: "https://official.example.eu/instrument",
    publishedAt: "2024-06-01T00:00:00+00:00",
    effectiveFrom: "2024-06-30T00:00:00+00:00",
    effectiveTo: null,
    observedAt: "2026-07-30T00:00:00+00:00",
    retrievedAt: "2026-07-30T00:00:00+00:00",
    storageRights: "ALLOWED",
    rightsReviewedAt: "2026-07-30T00:00:00+00:00",
    rightsBasis: "Fixture rights basis",
    redistributionRights: "FULL_TEXT",
    licenceIdentifier: "Fixture licence",
    provisions: [
      {
        provisionId: "provision:eea:fixture:a36",
        locator: "Article 36(1)",
        languageCode: "en",
        textChecksumSha256: "c".repeat(64),
        ordinal: 0,
        effectiveExcerptPermission: "ALLOWED",
      },
      {
        provisionId: "provision:eea:fixture:a49",
        locator: "Article 49",
        languageCode: "en",
        textChecksumSha256: "d".repeat(64),
        ordinal: 1,
        effectiveExcerptPermission: "LINK_ONLY",
      },
    ],
    ...overrides,
  };
}

function draft(
  overrides: Partial<ExtractedClaimDraft> = {},
): ExtractedClaimDraft {
  return {
    claimId: "claim:eea:fixture:1",
    jurisdictionCode: "EEA",
    topic: "issuance-authorization",
    proposition: "Sanitized fixture proposition about authorization.",
    legalStatus: "REQUIREMENT",
    effectiveFrom: "2024-06-30T00:00:00+00:00",
    citations: [
      { provisionId: "provision:eea:fixture:a36", locator: "Article 36(1)" },
    ],
    confidence: 0.88,
    ...overrides,
  };
}

function checkInput(
  overrides: Partial<DeterministicCheckInput> = {},
): DeterministicCheckInput {
  return {
    manifest: manifest(),
    draft: draft(),
    expectedJurisdiction: "EEA",
    now: NOW,
    freshnessMaxDays: 30,
    ...overrides,
  };
}

// --- extraction output parsing (model output is untrusted) ---

test("parses valid model output into claim drafts", () => {
  const drafts = parseExtractionOutput([draft()]);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].claimId, "claim:eea:fixture:1");
});

test("rejects model output with unknown status, bad confidence, or missing citations", () => {
  assert.throws(() => parseExtractionOutput([{ ...draft(), legalStatus: "LEGAL" }]));
  assert.throws(() => parseExtractionOutput([{ ...draft(), confidence: 1.5 }]));
  assert.throws(() => parseExtractionOutput([{ ...draft(), citations: [] }]));
  assert.throws(() => parseExtractionOutput("not-an-array"));
});

// --- bundle projection reuses the migration-0015 import channel ---

test("extraction runs project to a valid 0015 draft bundle without review fields", () => {
  const run: ExtractionRun = {
    sourceVersionId: "version:eea:fixture:1",
    jurisdictionCode: "EEA",
    model: "test-model",
    promptTemplateId: "claim-extraction",
    promptTemplateVersion: "1.0.0",
    parametersVersion: "1.0.0",
    drafts: [draft()],
  };
  const bundle = toClaimDraftBundle(run, "batch:eea:fixture:1", "2026-07-30T00:00:00+00:00");
  assertClaimDraftBundle(bundle);
  assert.equal(bundle.jurisdictionCode, "EEA");
  for (const claim of bundle.claims) {
    assert.ok(!("reviewState" in claim) && !("review_state" in claim));
    assert.ok(!("reviewerRef" in claim));
  }
});

// --- deterministic checks (contradiction stays NOT_EVALUATED here) ---

test("clean drafts pass every deterministic check with zero blockers", () => {
  const result = runDeterministicChecks(checkInput());
  assert.deepEqual(result.checks, {
    contradiction: "NOT_EVALUATED",
    freshness: "PASS",
    rights: "PASS",
    jurisdiction: "PASS",
    effectiveDates: "PASS",
    citationLocator: "PASS",
  });
  assert.deepEqual(result.blockers, []);
  assert.ok(result.limitations.length > 0);
});

test("a fabricated or mismatched citation fails the locator check", () => {
  const fabricated = runDeterministicChecks(
    checkInput({
      draft: draft({
        citations: [{ provisionId: "provision:injected:999", locator: "Article 999" }],
      }),
    }),
  );
  assert.equal(fabricated.checks.citationLocator, "FAIL");
  assert.ok(fabricated.blockers.includes("CITATION_LOCATOR_MISMATCH"));

  const wrongLocator = runDeterministicChecks(
    checkInput({
      draft: draft({
        citations: [{ provisionId: "provision:eea:fixture:a36", locator: "Article 1" }],
      }),
    }),
  );
  assert.equal(wrongLocator.checks.citationLocator, "FAIL");
});

test("link-only or unknown excerpt rights fail the rights check", () => {
  const linkOnly = runDeterministicChecks(
    checkInput({
      draft: draft({
        citations: [{ provisionId: "provision:eea:fixture:a49", locator: "Article 49" }],
      }),
    }),
  );
  assert.equal(linkOnly.checks.rights, "FAIL");
  assert.ok(linkOnly.blockers.includes("EXCERPT_RIGHTS_BLOCKED"));

  const storageBlocked = runDeterministicChecks(
    checkInput({ manifest: manifest({ storageRights: "REVIEW_REQUIRED" }) }),
  );
  assert.equal(storageBlocked.checks.rights, "FAIL");
});

test("a stale source fails the freshness check", () => {
  const result = runDeterministicChecks(
    checkInput({ manifest: manifest({ retrievedAt: "2026-06-01T00:00:00+00:00" }) }),
  );
  assert.equal(result.checks.freshness, "FAIL");
  assert.ok(result.blockers.includes("SOURCE_STALE"));
});

test("a jurisdiction mismatch fails the jurisdiction check", () => {
  const result = runDeterministicChecks(
    checkInput({ draft: draft({ jurisdictionCode: "SG" }) }),
  );
  assert.equal(result.checks.jurisdiction, "FAIL");
});

test("an effective date after the version window fails; earlier laws pass", () => {
  // laws routinely take effect long before a consolidation snapshot: earlier
  // effectiveFrom is normal and must PASS
  const earlier = runDeterministicChecks(
    checkInput({ draft: draft({ effectiveFrom: "2020-01-01T00:00:00+00:00" }) }),
  );
  assert.equal(earlier.checks.effectiveDates, "PASS");

  // but a claim cannot take effect after the version's window closes
  const late = runDeterministicChecks(
    checkInput({
      manifest: manifest({ effectiveTo: "2025-01-01T00:00:00+00:00" }),
      draft: draft({ effectiveFrom: "2025-06-01T00:00:00+00:00" }),
    }),
  );
  assert.equal(late.checks.effectiveDates, "FAIL");

  const unparsable = runDeterministicChecks(
    checkInput({ draft: draft({ effectiveFrom: "not-a-date" }) }),
  );
  assert.equal(unparsable.checks.effectiveDates, "FAIL");
});

// --- independent cross-check comparison ---

test("cross-check agrees when the independent model matches citations and status", () => {
  const result = compareCrossCheck(draft(), draft({ confidence: 0.7 }));
  assert.equal(result.agreed, true);
  assert.deepEqual(result.blockers, []);
});

test("cross-check fails on status disagreement or a missing counterpart", () => {
  const contradiction = compareCrossCheck(
    draft(),
    draft({ legalStatus: "PROHIBITION" }),
  );
  assert.equal(contradiction.agreed, false);
  assert.ok(contradiction.blockers.includes("CROSS_MODEL_CONTRADICTION"));

  const missing = compareCrossCheck(draft(), undefined);
  assert.equal(missing.agreed, false);
  assert.ok(missing.blockers.includes("CROSS_CHECK_MISSING"));
});

// --- replay determinism ---

test("replay checksums are stable across key order and repeated runs", () => {
  const a = replayChecksum({ x: 1, y: [1, 2], z: "s" });
  const b = replayChecksum({ z: "s", y: [1, 2], x: 1 });
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, replayChecksum({ x: 2, y: [1, 2], z: "s" }));
});
