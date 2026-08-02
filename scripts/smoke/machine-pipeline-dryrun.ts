import assert from "node:assert/strict";
import {
  compareCrossCheck,
  parseExtractionOutput,
  replayChecksum,
  runDeterministicChecks,
  toClaimDraftBundle,
} from "../../lib/legal-corpus/machine-pipeline.js";
import { assertClaimDraftBundle } from "../../lib/legal-corpus/claim-draft-import.js";
import { machineAssuranceCanAdvance } from "../../lib/legal-corpus/machine-assurance.js";
import { provisionalReleaseInputErrors } from "../../lib/legal-corpus/provisional-release.js";
import type { SourceVerificationManifest } from "../../lib/legal-corpus/verification.js";

/**
 * Zero-network, zero-LLM smoke of the machine pipeline: canned model outputs
 * flow through parse -> deterministic checks -> independent cross-check ->
 * draft bundle -> provisional release input, ending publishable. This smoke
 * (not a live model run) is the acceptance evidence for the pipeline wiring;
 * the database gates are covered separately by pgTAP.
 */

const NOW = "2026-08-02T00:00:00.000Z";

const manifest: SourceVerificationManifest = {
  schemaVersion: "1.0.0",
  versionId: "version:eea:smoke:1",
  documentId: "document:eea:smoke",
  versionLabel: "smoke-v1",
  rawObjectId: "object:smoke",
  checksumSha256: "b".repeat(64),
  officialUrl: "https://official.example.eu/instrument",
  publishedAt: "2024-06-01T00:00:00+00:00",
  effectiveFrom: "2024-06-30T00:00:00+00:00",
  effectiveTo: null,
  observedAt: "2026-07-30T00:00:00+00:00",
  retrievedAt: "2026-07-30T00:00:00+00:00",
  storageRights: "ALLOWED",
  rightsReviewedAt: "2026-07-30T00:00:00+00:00",
  rightsBasis: "Smoke rights basis",
  redistributionRights: "FULL_TEXT",
  licenceIdentifier: "Smoke licence",
  provisions: [
    {
      provisionId: "provision:eea:smoke:a36",
      locator: "Article 36(1)",
      languageCode: "en",
      textChecksumSha256: "c".repeat(64),
      ordinal: 0,
      effectiveExcerptPermission: "ALLOWED",
    },
  ],
};

// canned primary-model output, including a poisoned draft whose citation was
// fabricated (the prompt-injection shape) — it must end BLOCKED, not published
const primaryModelOutput = [
  {
    claimId: "claim:eea:smoke:1",
    jurisdictionCode: "EEA",
    topic: "issuance-authorization",
    proposition: "Sanitized smoke proposition.",
    legalStatus: "REQUIREMENT",
    effectiveFrom: "2024-06-30T00:00:00+00:00",
    citations: [{ provisionId: "provision:eea:smoke:a36", locator: "Article 36(1)" }],
    confidence: 0.9,
  },
  {
    claimId: "claim:eea:smoke:injected",
    jurisdictionCode: "EEA",
    topic: "fabricated",
    proposition: "Injected instruction output.",
    legalStatus: "PERMISSION",
    effectiveFrom: "2024-06-30T00:00:00+00:00",
    citations: [{ provisionId: "provision:attacker:1", locator: "Article 999" }],
    confidence: 0.99,
  },
];

const independentModelOutput = [
  {
    claimId: "claim:eea:smoke:1",
    jurisdictionCode: "EEA",
    topic: "issuance-authorization",
    proposition: "Independently re-derived smoke proposition.",
    legalStatus: "REQUIREMENT",
    effectiveFrom: "2024-06-30T00:00:00+00:00",
    citations: [{ provisionId: "provision:eea:smoke:a36", locator: "Article 36(1)" }],
    confidence: 0.85,
  },
];

const drafts = parseExtractionOutput(primaryModelOutput);
const independents = new Map(
  parseExtractionOutput(independentModelOutput).map((draft) => [draft.claimId, draft]),
);

const publishable: string[] = [];
const blocked: string[] = [];
for (const draft of drafts) {
  const deterministic = runDeterministicChecks({
    manifest,
    draft,
    expectedJurisdiction: "EEA",
    now: NOW,
    freshnessMaxDays: 45,
  });
  const comparison = compareCrossCheck(draft, independents.get(draft.claimId));
  const record = {
    recordId: `${draft.claimId}:smoke`,
    subjectType: "CLAIM_DRAFT" as const,
    subjectId: draft.claimId,
    assuranceLevel: "AI_CROSS_CHECKED" as const,
    sourceVersionFingerprint: "a".repeat(64),
    claimFingerprint: replayChecksum(draft),
    model: "smoke-model-b",
    promptTemplateId: "claim-crosscheck",
    promptTemplateVersion: "1.0.0",
    parametersVersion: "1.0.0",
    confidence: draft.confidence,
    checks: {
      ...deterministic.checks,
      contradiction: comparison.agreed ? ("PASS" as const) : ("FAIL" as const),
    },
    inputChecksumSha256: replayChecksum(manifest),
    outputChecksumSha256: replayChecksum(draft),
    blockers: [...deterministic.blockers, ...comparison.blockers],
    limitations: deterministic.limitations,
  };
  if (machineAssuranceCanAdvance(record)) publishable.push(draft.claimId);
  else blocked.push(draft.claimId);
}

assert.deepEqual(publishable, ["claim:eea:smoke:1"], "clean claim must be publishable");
assert.deepEqual(
  blocked,
  ["claim:eea:smoke:injected"],
  "fabricated-citation claim must be blocked",
);

// the clean claim projects into a valid import bundle
const bundle = toClaimDraftBundle(
  {
    sourceVersionId: manifest.versionId,
    jurisdictionCode: "EEA",
    model: "smoke-model-a",
    promptTemplateId: "claim-extraction",
    promptTemplateVersion: "1.0.0",
    parametersVersion: "1.0.0",
    drafts: drafts.filter((draft) => publishable.includes(draft.claimId)),
  },
  "batch:eea:smoke:1",
  manifest.retrievedAt,
);
assertClaimDraftBundle(bundle);

// and the release input over publishable membership is valid
const releaseErrors = provisionalReleaseInputErrors({
  releaseId: "provisional:eea:smoke",
  jurisdictionCode: "EEA",
  asOf: NOW,
  knowledgeCutoff: manifest.retrievedAt,
  claimIds: publishable,
});
assert.deepEqual(releaseErrors, []);

// replay determinism: the same canned inputs produce identical checksums
assert.equal(replayChecksum(primaryModelOutput), replayChecksum(primaryModelOutput));

console.log(
  JSON.stringify({
    smoke: "machine-pipeline-dryrun",
    result: "PASS",
    publishable,
    blocked,
    network: "none",
    llm: "none",
  }),
);
