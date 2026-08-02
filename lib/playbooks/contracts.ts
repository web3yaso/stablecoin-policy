/**
 * Phase 5 MVP playbook contracts. Conclusions mirror specs/playbookPackage.qnt
 * exactly; the runtime's decide() is a 1:1 port of the model's. Rule
 * definitions live server-side only — public endpoints expose names and
 * capability lists, never the raw rules.
 */

export type CapabilityConclusion =
  | "PERMITTED"
  | "CONDITIONAL"
  | "UNDETERMINED"
  | "COUNSEL_REVIEW"
  | "PROHIBITED";

export type BusinessProfile = {
  operatorJurisdiction: string;
  targetJurisdiction: "EEA";
  activities: string[];
  asset: { symbol: string; networks: string[] } | null;
};

export type EvidenceClaim = {
  claimId: string;
  topic: string;
  legalStatus: string;
  proposition: string;
  citations: Array<{ provisionId: string; locator: string }>;
  releaseId: string;
  asOf: string;
  knowledgeCutoff: string;
  confidence: number | null;
  limitations: string[];
};

export type DossierCheck =
  | "EMT_CLASSIFICATION"
  | "ISSUER_AUTHORIZATION"
  | "NETWORK_DEPLOYMENT";

export type CapabilityRule = {
  capabilityId: string;
  title: string;
  requiredInputs: Array<"networks">;
  requirementTopics: string[];
  prohibitionTopics: string[];
  dossierChecks: DossierCheck[];
  actions: string[];
};

export type PlaybookDefinition = {
  playbookId: string;
  name: string;
  version: string;
  templateVersion: string;
  description: string;
  capabilities: CapabilityRule[];
};

export type CapabilityResult = {
  capabilityId: string;
  title: string;
  conclusion: CapabilityConclusion;
  reasonCodes: string[];
  actions: string[];
  evidenceClaimIds: string[];
  dossierFacts: string[];
  limitations: string[];
};

export type PlaybookPackage = {
  schemaVersion: "1.0.0";
  packageId: string;
  playbookId: string;
  playbookName: string;
  profileFingerprint: string;
  conclusions: CapabilityResult[];
  assurance: {
    reviewStatus: "PROVISIONAL" | "HUMAN_REVIEWED";
    humanReviewed: boolean;
    limitations: string[];
    counselTriggers: string[];
  };
  versions: {
    corpusReleaseId: string | null;
    corpusAsOf: string | null;
    knowledgeCutoff: string | null;
    dossierId: string | null;
    dossierCuratedAt: string | null;
    rulesVersion: string;
    templateVersion: string;
    schemaVersion: "1.0.0";
  };
  evaluatedAt: string;
  integritySha256: string;
};

export type EvidenceBundle = {
  schemaVersion: "1.0.0";
  packageId: string;
  claims: EvidenceClaim[];
  dossierFacts: string[];
};
