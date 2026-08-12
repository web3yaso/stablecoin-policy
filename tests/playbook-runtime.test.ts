import assert from "node:assert/strict";
import test from "node:test";
import {
  MVP_PLAYBOOKS,
  businessModelBoundaryPlaybook,
  preListingPlaybook,
} from "../lib/playbooks/definitions";
import {
  assembleEvidenceBundle,
  evaluatePlaybook,
  sealPlaybookPackage,
  verifyPlaybookPackageIntegrity,
  type EvaluationEvidence,
} from "../lib/playbooks/runtime";
import {
  buildPlaybookRetrievalRequest,
  retrievePlaybookEvidence,
} from "../lib/playbooks/retrieval";
import type { BusinessProfile, EvidenceClaim } from "../lib/playbooks/contracts";
import type {
  EvidenceSearchRequest,
  EvidenceSearchResponse,
} from "../lib/retrieval/contracts";
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

function successfulRetrieval(): EvidenceSearchResponse {
  return {
    schemaVersion: "1.0.0",
    runId: "rag-run:playbook-test:0000000000000001",
    status: "SUCCESS",
    querySha256: "1".repeat(64),
    indexRelease: {
      indexReleaseId: "rag-index:eea:provisional:2026-08-03",
      corpusReleaseId: "provisional:eea:mica:2026-08-02",
      assuranceTier: "PROVISIONAL",
      asOf: "2026-08-02T00:00:00.000Z",
      knowledgeCutoff: "2026-08-01T00:00:00.000Z",
      generatedAt: "2026-08-03T00:00:00.000Z",
      freshThrough: "2026-08-03T00:00:00.000Z",
      embeddingModel: "fixture-embedding",
      embeddingModelVersion: "1",
      embeddingDimensions: 3,
      lexicalConfigVersion: "1",
      vectorConfigVersion: "1",
    },
    hits: [{
      rank: 1,
      score: 0.98,
      lexicalRank: 1,
      vectorRank: 1,
      chunkId: "chunk:eea:mica:article-18:1",
      claim: {
        claimId: "claim:eea:mica:e-money-token-authorisation:18",
        topic: "e-money-token-authorisation",
        legalStatus: "REQUIREMENT",
        proposition: "Issuers must meet the applicable authorization requirement.",
        supportRelation: "DIRECT_SUPPORT",
      },
      citation: {
        citationId: "citation:eea:mica:article-18:1",
        provisionId: "provision:eea:mica:article-18",
        sourceVersionId: "source-version:eea:mica:2026-08-01",
        sourceVersionChecksumSha256: "2".repeat(64),
        sourceDocumentId: "document:eea:mica",
        documentTitle: "Markets in Crypto-Assets Regulation",
        sourceType: "REGULATION",
        authorityId: "authority:eu",
        authorityName: "European Union",
        locator: "Article 18",
        canonicalUrl: "https://eur-lex.europa.eu/eli/reg/2023/1114/oj",
        excerpt: "Fixture excerpt permitted for presentation.",
        excerptPermission: "ALLOWED",
        sourcePublishedAt: "2023-06-09T00:00:00.000Z",
        sourceRetrievedAt: "2026-08-01T00:00:00.000Z",
      },
      jurisdictionCode: "EEA",
      effectiveFrom: "2024-06-30T00:00:00.000Z",
      effectiveTo: null,
      assuranceTier: "PROVISIONAL",
      reviewStatus: "PROVISIONAL",
    }],
    limitations: ["Machine-assured retrieval; not human-reviewed legal advice."],
    explanation: null,
  };
}

function decisionProjection(conclusions: ReturnType<typeof evaluatePlaybook>) {
  return conclusions.map((result) => ({
    capabilityId: result.capabilityId,
    conclusion: result.conclusion,
    reasonCodes: result.reasonCodes,
    actions: result.actions,
    evidenceClaimIds: result.evidenceClaimIds,
  }));
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

  assert.equal(pkg.schemaVersion, "1.1.0");
  assert.equal(pkg.assurance.reviewStatus, "PROVISIONAL");
  assert.equal(pkg.assurance.humanReviewed, false);
  assert.ok(pkg.assurance.limitations.length > 0);
  assert.ok(pkg.assurance.counselTriggers.length > 0);
  assert.equal(pkg.versions.corpusReleaseId, "provisional:eea:mica:2026-08-02");
  assert.equal(pkg.versions.dossierId, "usdc-eea");
  assert.equal(pkg.versions.retrievalIndexReleaseId, null);
  assert.equal(pkg.versions.retrievalCorpusReleaseId, null);
  assert.ok(pkg.versions.rulesVersion.length > 0);
  assert.ok(pkg.versions.templateVersion.length > 0);
  assert.match(pkg.integritySha256, /^[0-9a-f]{64}$/);
  assert.equal(verifyPlaybookPackageIntegrity(pkg), true);
  assert.equal(
    verifyPlaybookPackageIntegrity({
      ...pkg,
      evaluatedAt: "2026-08-03T00:00:00.001Z",
    }),
    false,
  );

  const again = sealPlaybookPackage(
    preListingPlaybook,
    profile,
    evaluatePlaybook(preListingPlaybook, profile, ev),
    ev,
  );
  assert.equal(again.integritySha256, pkg.integritySha256);
  assert.equal(again.packageId, pkg.packageId);
});

test("RAG success enriches only evidence and version pins, never deterministic decisions", async () => {
  const ev = await evidence();
  const profile = preListingProfile(["base"]);
  const beforeRetrieval = evaluatePlaybook(preListingPlaybook, profile, ev);
  const capturedRequests: EvidenceSearchRequest[] = [];
  const retrieval = await retrievePlaybookEvidence(
    {
      search: async (request) => {
        capturedRequests.push(request);
        return successfulRetrieval();
      },
    },
    preListingPlaybook,
    beforeRetrieval,
    ev,
  );
  const afterRetrieval = evaluatePlaybook(preListingPlaybook, profile, ev);

  assert.deepEqual(decisionProjection(afterRetrieval), decisionProjection(beforeRetrieval));
  const capturedRequest = capturedRequests[0];
  assert.ok(capturedRequest);
  assert.equal(capturedRequest.filters.corpusReleaseId, null);
  assert.equal(capturedRequest.filters.indexReleaseId, null);
  assert.equal(capturedRequest.query.includes("USDC"), false);
  assert.equal(capturedRequest.query.includes("SG"), false);
  assert.equal(capturedRequest.query.includes("base"), false);

  const withoutRag = sealPlaybookPackage(
    preListingPlaybook,
    profile,
    beforeRetrieval,
    ev,
  );
  const withRag = sealPlaybookPackage(
    preListingPlaybook,
    profile,
    afterRetrieval,
    ev,
    retrieval,
  );
  assert.deepEqual(
    decisionProjection(withRag.conclusions),
    decisionProjection(withoutRag.conclusions),
  );
  assert.equal(
    withRag.versions.retrievalIndexReleaseId,
    "rag-index:eea:provisional:2026-08-03",
  );
  assert.equal(
    withRag.versions.retrievalCorpusReleaseId,
    "provisional:eea:mica:2026-08-02",
  );

  const bundle = assembleEvidenceBundle(withRag, ev, retrieval);
  assert.equal(bundle.retrieval.status, "SUCCESS");
  assert.equal(bundle.retrieval.items.length, 1);
  assert.equal(bundle.retrieval.items[0].locator, "Article 18");
  assert.equal("proposition" in bundle.retrieval.items[0], false);
  assert.equal("searchText" in bundle.retrieval.items[0], false);
  assert.equal("embedding" in bundle.retrieval.items[0], false);
});

test("RAG outage degrades the bundle without changing conclusions", async () => {
  const ev = await evidence();
  const profile = preListingProfile(["base"]);
  const conclusions = evaluatePlaybook(preListingPlaybook, profile, ev);
  const retrieval = await retrievePlaybookEvidence(
    { search: async () => { throw new Error("provider unavailable"); } },
    preListingPlaybook,
    conclusions,
    ev,
  );
  const pkg = sealPlaybookPackage(
    preListingPlaybook,
    profile,
    conclusions,
    ev,
    retrieval,
  );
  const bundle = assembleEvidenceBundle(pkg, ev, retrieval);

  assert.equal(retrieval.status, "RETRIEVAL_UNAVAILABLE");
  assert.deepEqual(pkg.conclusions, conclusions);
  assert.equal(pkg.versions.retrievalIndexReleaseId, null);
  assert.equal(bundle.retrieval.status, "RETRIEVAL_UNAVAILABLE");
  assert.deepEqual(bundle.retrieval.items, []);
  assert.ok(bundle.retrieval.limitations[0].includes("conclusions remain unchanged"));
});

test("playbook retrieval requests use public evidence topics, not customer profile facts", async () => {
  const ev = await evidence();
  const profile = preListingProfile(["base"]);
  const conclusions = evaluatePlaybook(preListingPlaybook, profile, ev);
  const request = buildPlaybookRetrievalRequest(preListingPlaybook, conclusions, ev);

  assert.ok(request);
  assert.deepEqual(request.filters.jurisdictionCodes, ["EEA"]);
  assert.ok(request.filters.topics.includes("crypto-asset-service-provider-authorisation"));
  assert.equal(request.query.includes(profile.operatorJurisdiction), false);
  assert.equal(request.query.includes(profile.asset?.symbol ?? "USDC"), false);
  assert.equal(request.query.includes(profile.asset?.networks[0] ?? "base"), false);
});

test("EvidenceBundle assembly rejects retrieval that does not match sealed pins", async () => {
  const ev = await evidence();
  const profile = preListingProfile(["base"]);
  const conclusions = evaluatePlaybook(preListingPlaybook, profile, ev);
  const retrieval = successfulRetrieval();
  const pkg = sealPlaybookPackage(
    preListingPlaybook,
    profile,
    conclusions,
    ev,
    retrieval,
  );

  assert.throws(
    () => assembleEvidenceBundle(pkg, ev, { ...retrieval, indexRelease: null }),
    /does not match the sealed package versions/,
  );
  assert.throws(
    () => assembleEvidenceBundle(pkg, ev, {
      ...retrieval,
      indexRelease: {
        ...retrieval.indexRelease!,
        knowledgeCutoff: "2026-07-31T00:00:00.000Z",
      },
    }),
    /does not match the sealed package versions/,
  );

  const successWithoutIndex = { ...retrieval, indexRelease: null };
  const unpinnedPackage = sealPlaybookPackage(
    preListingPlaybook,
    profile,
    conclusions,
    ev,
    successWithoutIndex,
  );
  assert.throws(
    () => assembleEvidenceBundle(unpinnedPackage, ev, successWithoutIndex),
    /successful retrieval must pin an index release/,
  );
});

test("non-success retrieval never exposes ranked items in a package", async () => {
  const ev = await evidence();
  const profile = preListingProfile(["base"]);
  const conclusions = evaluatePlaybook(preListingPlaybook, profile, ev);
  const retrieval: EvidenceSearchResponse = {
    ...successfulRetrieval(),
    status: "STALE_INDEX",
    limitations: ["The pinned index is stale."],
  };
  const pkg = sealPlaybookPackage(
    preListingPlaybook,
    profile,
    conclusions,
    ev,
    retrieval,
  );
  const bundle = assembleEvidenceBundle(pkg, ev, retrieval);

  assert.equal(bundle.retrieval.status, "STALE_INDEX");
  assert.deepEqual(bundle.retrieval.items, []);
});

test("the MVP registry exposes exactly the two launch playbooks", () => {
  assert.deepEqual(
    MVP_PLAYBOOKS.map((playbook) => playbook.playbookId).sort(),
    ["business-model-regulatory-boundary", "stablecoin-pre-listing"],
  );
});

// --- contract: the POST /v1/playbook-packages response validates ---

test("runtime output validates against the committed package schema", async () => {
  const { readFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const Ajv2020 = (await import("ajv/dist/2020")).default;
  const addFormats = (await import("ajv-formats")).default;

  const schema = JSON.parse(
    await readFile(
      path.join(process.cwd(), "contracts", "v1", "playbook-package-response.schema.json"),
      "utf8",
    ),
  );
  const ajv = new Ajv2020({ strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  const ev = await evidence();
  const profile = preListingProfile(["base"]);
  const conclusions = evaluatePlaybook(preListingPlaybook, profile, ev);
  const pkg = sealPlaybookPackage(preListingPlaybook, profile, conclusions, ev);
  const bundle = assembleEvidenceBundle(pkg, ev);

  const response = { package: pkg, evidenceBundle: bundle };
  assert.equal(validate(response), true, JSON.stringify(validate.errors));

  const retrieval = successfulRetrieval();
  const retrievedPackage = sealPlaybookPackage(
    preListingPlaybook,
    profile,
    conclusions,
    ev,
    retrieval,
  );
  const retrievedBundle = assembleEvidenceBundle(retrievedPackage, ev, retrieval);
  assert.equal(
    validate({ package: retrievedPackage, evidenceBundle: retrievedBundle }),
    true,
    JSON.stringify(validate.errors),
  );

  const smuggled = {
    package: { ...pkg, internalRules: "secret" },
    evidenceBundle: bundle,
  };
  assert.equal(validate(smuggled), false);

  for (const forbidden of ["query", "searchText", "embedding", "prompt", "rawDecisionRules"]) {
    const unsafe = {
      package: retrievedPackage,
      evidenceBundle: {
        ...retrievedBundle,
        retrieval: { ...retrievedBundle.retrieval, [forbidden]: "private" },
      },
    };
    assert.equal(validate(unsafe), false, `${forbidden} must not cross the API boundary`);
  }
  for (const forbidden of [
    "proposition", "searchText", "embedding", "sourceDocumentId",
    "authorityId", "lexicalRank", "vectorRank",
  ]) {
    const unsafeItem = {
      package: retrievedPackage,
      evidenceBundle: {
        ...retrievedBundle,
        retrieval: {
          ...retrievedBundle.retrieval,
          items: [{ ...retrievedBundle.retrieval.items[0], [forbidden]: "private" }],
        },
      },
    };
    assert.equal(
      validate(unsafeItem),
      false,
      `retrieval item ${forbidden} must not cross the API boundary`,
    );
  }
});
