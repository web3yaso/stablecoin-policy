import assert from "node:assert/strict";
import test from "node:test";
import {
  MVP_PLAYBOOKS,
  businessModelBoundaryPlaybook,
  preListingPlaybook,
} from "../lib/playbooks/definitions";
import {
  evaluatePlaybook,
  sealPlaybookPackage,
  type EvaluationEvidence,
} from "../lib/playbooks/runtime";
import type { BusinessProfile, EvidenceClaim } from "../lib/playbooks/contracts";
import { loadDossierFile } from "../lib/dossiers";

const NOW = "2026-08-03T00:00:00.000Z";

function claim(overrides: Partial<EvidenceClaim>): EvidenceClaim {
  return {
    claimId: "claim:eea:mica:fixture:1",
    topic: "fixture-topic",
    legalStatus: "REQUIREMENT",
    proposition: "Sanitized fixture proposition.",
    citations: [{ provisionId: "provision:fixture:1", locator: "Article 1" }],
    releaseId: "provisional:eea:mica:2026-08-02",
    asOf: "2026-08-02T00:00:00.000Z",
    knowledgeCutoff: "2026-08-01T00:00:00.000Z",
    confidence: 0.9,
    limitations: ["Machine-generated draft; not human-reviewed legal advice."],
    ...overrides,
  };
}

function eeaClaims(): EvidenceClaim[] {
  return [
    claim({
      claimId: "claim:eea:mica:e-money-token-authorisation:18",
      topic: "e-money-token-authorisation",
    }),
    claim({
      claimId: "claim:eea:mica:e-money-token-interest:20",
      topic: "e-money-token-interest",
      legalStatus: "PROHIBITION",
    }),
    claim({
      claimId: "claim:eea:mica:crypto-asset-service-provider-authorisation:21",
      topic: "crypto-asset-service-provider-authorisation",
    }),
    claim({
      claimId: "claim:eea:mica:custody-client-assets:28",
      topic: "custody-client-assets",
    }),
    claim({
      claimId: "claim:eea:mica:casp-client-asset-safeguarding:25",
      topic: "casp-client-asset-safeguarding",
    }),
    claim({
      claimId: "claim:eea:mica:trading-platform-proprietary-trading:29",
      topic: "trading-platform-proprietary-trading",
    }),
  ];
}

async function evidence(
  overrides: Partial<EvaluationEvidence> = {},
): Promise<EvaluationEvidence> {
  return {
    claims: eeaClaims(),
    dossier: await loadDossierFile("data/dossiers/usdc-eea.json"),
    now: NOW,
    maxEvidenceAgeDays: 90,
    ...overrides,
  };
}

function boundaryProfile(activities: string[]): BusinessProfile {
  return {
    operatorJurisdiction: "SG",
    targetJurisdiction: "EEA",
    activities,
    asset: null,
  };
}

function preListingProfile(networks: string[]): BusinessProfile {
  return {
    operatorJurisdiction: "SG",
    targetJurisdiction: "EEA",
    activities: ["list-for-trading", "custody-for-clients"],
    asset: { symbol: "USDC", networks },
  };
}

// --- Business Model Regulatory Boundary ---

test("issuing an EMT is CONDITIONAL on authorization with exact claim evidence", async () => {
  const results = evaluatePlaybook(
    businessModelBoundaryPlaybook,
    boundaryProfile(["issue-emt"]),
    await evidence(),
  );
  const result = results.find((r) => r.capabilityId === "issue-emt");
  assert.ok(result);
  assert.equal(result.conclusion, "CONDITIONAL");
  assert.ok(result.reasonCodes.includes("AUTHORIZATION_REQUIRED"));
  assert.ok(
    result.evidenceClaimIds.includes(
      "claim:eea:mica:e-money-token-authorisation:18",
    ),
  );
});

test("paying interest on EMTs is PROHIBITED with the prohibition claim cited", async () => {
  const results = evaluatePlaybook(
    businessModelBoundaryPlaybook,
    boundaryProfile(["pay-emt-interest"]),
    await evidence(),
  );
  const result = results.find((r) => r.capabilityId === "pay-emt-interest");
  assert.equal(result?.conclusion, "PROHIBITED");
  assert.ok(result?.reasonCodes.includes("PROHIBITION_APPLIES"));
  assert.ok(
    result?.evidenceClaimIds.includes("claim:eea:mica:e-money-token-interest:20"),
  );
});

test("an activity outside the rule set is UNDETERMINED, never guessed", async () => {
  const results = evaluatePlaybook(
    businessModelBoundaryPlaybook,
    boundaryProfile(["run-a-casino"]),
    await evidence(),
  );
  const result = results.find((r) => r.capabilityId === "run-a-casino");
  assert.equal(result?.conclusion, "UNDETERMINED");
  assert.ok(result?.reasonCodes.includes("UNSUPPORTED_ACTIVITY"));
});

test("missing claim evidence yields UNDETERMINED", async () => {
  const results = evaluatePlaybook(
    businessModelBoundaryPlaybook,
    boundaryProfile(["issue-emt"]),
    await evidence({ claims: [] }),
  );
  assert.equal(results[0].conclusion, "UNDETERMINED");
  assert.ok(results[0].reasonCodes.includes("NO_DIRECT_EVIDENCE"));
});

test("stale corpus evidence degrades to CONDITIONAL with EVIDENCE_STALE", async () => {
  const staleClaims = eeaClaims().map((c) => ({
    ...c,
    asOf: "2026-01-01T00:00:00.000Z",
  }));
  const results = evaluatePlaybook(
    businessModelBoundaryPlaybook,
    boundaryProfile(["issue-emt"]),
    await evidence({ claims: staleClaims }),
  );
  assert.equal(results[0].conclusion, "CONDITIONAL");
  assert.ok(results[0].reasonCodes.includes("EVIDENCE_STALE"));
});

// --- Stablecoin Pre-listing & Product Launch ---

test("listing USDC on a supported network is CONDITIONAL with dossier facts attached", async () => {
  const results = evaluatePlaybook(
    preListingPlaybook,
    preListingProfile(["base"]),
    await evidence(),
  );
  const listing = results.find((r) => r.capabilityId === "list-for-trading");
  assert.equal(listing?.conclusion, "CONDITIONAL");
  assert.ok(listing?.reasonCodes.includes("AUTHORIZATION_REQUIRED"));
  assert.ok(listing?.dossierFacts.some((fact) => fact.includes("base")));
  assert.ok(listing?.dossierFacts.some((fact) => fact.includes("E_MONEY_TOKEN")));
});

test("an unverified network deployment yields UNDETERMINED", async () => {
  const results = evaluatePlaybook(
    preListingPlaybook,
    preListingProfile(["tron"]),
    await evidence(),
  );
  const listing = results.find((r) => r.capabilityId === "list-for-trading");
  assert.equal(listing?.conclusion, "UNDETERMINED");
  assert.ok(listing?.reasonCodes.includes("DEPLOYMENT_NOT_VERIFIED"));
});

test("a profile without networks is UNDETERMINED with MISSING_INPUT", async () => {
  const results = evaluatePlaybook(
    preListingPlaybook,
    preListingProfile([]),
    await evidence(),
  );
  const listing = results.find((r) => r.capabilityId === "list-for-trading");
  assert.equal(listing?.conclusion, "UNDETERMINED");
  assert.ok(listing?.reasonCodes.includes("MISSING_INPUT"));
});

// --- package sealing ---

test("sealed packages pin every version, propagate provisional, and are reproducible", async () => {
  const ev = await evidence();
  const profile = preListingProfile(["base"]);
  const conclusions = evaluatePlaybook(preListingPlaybook, profile, ev);
  const pkg = sealPlaybookPackage(preListingPlaybook, profile, conclusions, ev);

  assert.equal(pkg.schemaVersion, "1.0.0");
  assert.equal(pkg.assurance.reviewStatus, "PROVISIONAL");
  assert.equal(pkg.assurance.humanReviewed, false);
  assert.ok(pkg.assurance.limitations.length > 0);
  assert.ok(pkg.assurance.counselTriggers.length > 0);
  assert.equal(pkg.versions.corpusReleaseId, "provisional:eea:mica:2026-08-02");
  assert.equal(pkg.versions.dossierId, "usdc-eea");
  assert.ok(pkg.versions.rulesVersion.length > 0);
  assert.ok(pkg.versions.templateVersion.length > 0);
  assert.match(pkg.integritySha256, /^[0-9a-f]{64}$/);

  const again = sealPlaybookPackage(
    preListingPlaybook,
    profile,
    evaluatePlaybook(preListingPlaybook, profile, ev),
    ev,
  );
  assert.equal(again.integritySha256, pkg.integritySha256);
  assert.equal(again.packageId, pkg.packageId);
});

test("the MVP registry exposes exactly the two launch playbooks", () => {
  assert.deepEqual(
    MVP_PLAYBOOKS.map((playbook) => playbook.playbookId).sort(),
    ["business-model-regulatory-boundary", "stablecoin-pre-listing"],
  );
});
