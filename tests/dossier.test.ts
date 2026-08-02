import assert from "node:assert/strict";
import test from "node:test";
import {
  dossierReadinessErrors,
  loadDossierFile,
  type StablecoinDossier,
} from "../lib/dossiers";

test("the committed USDC EEA mini-dossier is structurally valid", async () => {
  const dossier = await loadDossierFile("data/dossiers/usdc-eea.json");
  assert.equal(dossier.schemaVersion, "1.0.0");
  assert.equal(dossier.dossierId, "usdc-eea");
  assert.equal(dossier.asset.symbol, "USDC");
  assert.equal(dossier.jurisdictionCode, "EEA");
  assert.deepEqual(dossierReadinessErrors(dossier), []);
});

test("every dossier fact carries provenance and an explicit basis", async () => {
  const dossier = await loadDossierFile("data/dossiers/usdc-eea.json");
  for (const authorization of dossier.authorizations) {
    assert.ok(authorization.evidence.length > 0, "authorization needs evidence");
    for (const evidence of authorization.evidence) {
      assert.match(evidence.sourceUrl, /^https:\/\//);
      assert.ok(Number.isFinite(Date.parse(evidence.retrievedAt)));
      assert.equal(evidence.rights, "LINK_ONLY");
    }
    assert.ok(
      ["OFFICIAL_REGISTER", "ISSUER_CLAIM", "REGULATORY_OBLIGATION"].includes(
        authorization.basis,
      ),
    );
  }
  for (const deployment of dossier.deployments) {
    assert.match(deployment.evidence.sourceUrl, /^https:\/\//);
    assert.equal(deployment.evidence.rights, "LINK_ONLY");
  }
});

test("deployments carry chain-appropriate official contract addresses", async () => {
  const dossier = await loadDossierFile("data/dossiers/usdc-eea.json");
  assert.ok(dossier.deployments.length >= 5);
  for (const deployment of dossier.deployments) {
    if (deployment.addressFormat === "evm") {
      assert.match(deployment.contractAddress, /^0x[0-9a-fA-F]{40}$/);
    } else {
      assert.ok(deployment.contractAddress.length >= 32);
    }
  }
  const ethereum = dossier.deployments.find((d) => d.network === "ethereum");
  assert.equal(
    ethereum?.contractAddress,
    "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  );
});

test("the dossier is visibly provisional and never claims verified status", async () => {
  const dossier = await loadDossierFile("data/dossiers/usdc-eea.json");
  assert.equal(dossier.assurance.reviewStatus, "PROVISIONAL");
  assert.equal(dossier.assurance.humanReviewed, false);
  assert.ok(dossier.assurance.limitations.length > 0);
  assert.ok(dossier.assurance.counselTriggers.length > 0);
});

test("readiness fails closed on missing evidence or verified-status claims", () => {
  const broken = {
    schemaVersion: "1.0.0",
    dossierId: "x",
    jurisdictionCode: "EEA",
    curatedAt: "2026-08-02T00:00:00.000Z",
    asset: { symbol: "X", name: "X", classification: "EMT" },
    issuer: { legalName: "X", countryOfIncorporation: "FR" },
    authorizations: [],
    deployments: [],
    redemption: null,
    reserves: null,
    assurance: {
      reviewStatus: "PROVISIONAL",
      humanReviewed: false,
      limitations: [],
      counselTriggers: [],
    },
  } as unknown as StablecoinDossier;
  const errors = dossierReadinessErrors(broken);
  assert.ok(errors.includes("authorizations_missing"));
  assert.ok(errors.includes("deployments_missing"));
  assert.ok(errors.includes("limitations_missing"));
});
