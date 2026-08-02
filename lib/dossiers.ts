import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Phase 4 Mini: minimal stablecoin dossier model — only the fields the EEA
 * Pre-listing decision consumes. Facts are operator-curated with per-fact
 * provenance links (LINK_ONLY: nothing is mirrored, only linked), an explicit
 * basis separating official registers from issuer claims, and a provisional
 * assurance label. The full Phase 4 data model supersedes this file-backed
 * form later; readers must treat it as provisional evidence, never as
 * verified status.
 */

export type DossierEvidence = {
  label: string;
  sourceUrl: string;
  retrievedAt: string;
  rights: "LINK_ONLY";
};

export type DossierBasis =
  | "OFFICIAL_REGISTER"
  | "ISSUER_CLAIM"
  | "REGULATORY_OBLIGATION";

export type IssuerAuthorization = {
  authority: string;
  jurisdictionCode: string;
  authorizationType: string;
  reference: string | null;
  grantedAt: string | null;
  scopeNote: string;
  basis: DossierBasis;
  evidence: DossierEvidence[];
};

export type Deployment = {
  network: string;
  addressFormat: "evm" | "base58";
  contractAddress: string;
  native: boolean;
  basis: DossierBasis;
  evidence: DossierEvidence;
};

export type StablecoinDossier = {
  schemaVersion: "1.0.0";
  dossierId: string;
  jurisdictionCode: string;
  curatedAt: string;
  asset: {
    symbol: string;
    name: string;
    classification: string;
    classificationBasis: DossierBasis;
  };
  issuer: {
    legalName: string;
    countryOfIncorporation: string;
    groupParent: string | null;
  };
  authorizations: IssuerAuthorization[];
  deployments: Deployment[];
  redemption: {
    summary: string;
    basis: DossierBasis;
    evidence: DossierEvidence[];
  } | null;
  reserves: {
    summary: string;
    basis: DossierBasis;
    evidence: DossierEvidence[];
  } | null;
  assurance: {
    reviewStatus: "PROVISIONAL";
    humanReviewed: false;
    limitations: string[];
    counselTriggers: string[];
  };
};

export function dossierReadinessErrors(dossier: StablecoinDossier): string[] {
  const errors: string[] = [];
  if (dossier.schemaVersion !== "1.0.0") errors.push("schema_version_invalid");
  if (dossier.authorizations.length === 0) errors.push("authorizations_missing");
  if (dossier.deployments.length === 0) errors.push("deployments_missing");
  if (
    dossier.authorizations.some(
      (authorization) => authorization.evidence.length === 0,
    )
  ) {
    errors.push("authorization_evidence_missing");
  }
  if (
    dossier.deployments.some(
      (deployment) =>
        deployment.addressFormat === "evm" &&
        !/^0x[0-9a-fA-F]{40}$/.test(deployment.contractAddress),
    )
  ) {
    errors.push("deployment_address_invalid");
  }
  if (dossier.assurance.reviewStatus !== "PROVISIONAL") {
    errors.push("assurance_status_invalid");
  }
  if (dossier.assurance.humanReviewed !== false) {
    errors.push("assurance_status_invalid");
  }
  if (dossier.assurance.limitations.length === 0) errors.push("limitations_missing");
  if (dossier.assurance.counselTriggers.length === 0) {
    errors.push("counsel_triggers_missing");
  }
  return errors;
}

export async function loadDossierFile(
  relativePath: string,
): Promise<StablecoinDossier> {
  const raw = await readFile(path.join(process.cwd(), relativePath), "utf8");
  return JSON.parse(raw) as StablecoinDossier;
}
