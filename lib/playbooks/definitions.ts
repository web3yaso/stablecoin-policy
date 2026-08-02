import type { PlaybookDefinition } from "./contracts";

/**
 * The two MVP playbook definitions (launched together per the 2026-08-02
 * product decision). Requirement/prohibition topics reference the claim
 * topics of the EEA provisional corpus; both playbooks run on the same
 * runtime and evidence contract.
 */

export const businessModelBoundaryPlaybook: PlaybookDefinition = {
  playbookId: "business-model-regulatory-boundary",
  name: "Stablecoin Business Model Regulatory Boundary",
  version: "1.0.0",
  templateVersion: "1.0.0",
  description:
    "Maps which MiCA regulatory perimeters a stablecoin business model crosses in the EEA: issuance boundaries, CASP activity authorization, and outright prohibitions.",
  capabilities: [
    {
      capabilityId: "issue-art",
      title: "Issue an asset-referenced token in the EEA",
      requiredInputs: [],
      requirementTopics: ["asset-referenced-token-authorisation"],
      prohibitionTopics: [],
      dossierChecks: [],
      actions: [
        "Prepare an ART authorization application (or credit-institution route) before any offer or admission to trading.",
      ],
    },
    {
      capabilityId: "issue-emt",
      title: "Issue an e-money token in the EEA",
      requiredInputs: [],
      requirementTopics: ["e-money-token-authorisation"],
      prohibitionTopics: [],
      dossierChecks: [],
      actions: [
        "Obtain credit-institution or e-money-institution authorization before issuing.",
      ],
    },
    {
      capabilityId: "pay-emt-interest",
      title: "Pay interest on e-money token holdings",
      requiredInputs: [],
      requirementTopics: [],
      prohibitionTopics: ["e-money-token-interest"],
      dossierChecks: [],
      actions: [
        "Remove interest-bearing features from the EMT product design; escalate alternatives to counsel.",
      ],
    },
    {
      capabilityId: "casp-custody",
      title: "Provide crypto-asset custody for clients",
      requiredInputs: [],
      requirementTopics: [
        "crypto-asset-service-provider-authorisation",
        "custody-client-assets",
      ],
      prohibitionTopics: [],
      dossierChecks: [],
      actions: [
        "Obtain CASP authorization covering custody and implement client-asset segregation.",
      ],
    },
    {
      capabilityId: "casp-exchange",
      title: "Operate crypto-asset exchange services",
      requiredInputs: [],
      requirementTopics: [
        "crypto-asset-service-provider-authorisation",
        "casp-client-conduct",
      ],
      prohibitionTopics: [],
      dossierChecks: [],
      actions: ["Obtain CASP authorization covering exchange services."],
    },
    {
      capabilityId: "casp-transfer",
      title: "Provide crypto-asset transfer services",
      requiredInputs: [],
      requirementTopics: ["crypto-asset-service-provider-authorisation"],
      prohibitionTopics: [],
      dossierChecks: [],
      actions: ["Obtain CASP authorization covering transfer services."],
    },
    {
      capabilityId: "operate-trading-platform",
      title: "Operate a trading platform for crypto-assets",
      requiredInputs: [],
      requirementTopics: [
        "crypto-asset-service-provider-authorisation",
        "trading-platform-proprietary-trading",
      ],
      prohibitionTopics: [],
      dossierChecks: [],
      actions: [
        "Obtain CASP authorization for platform operation and implement the proprietary-trading restrictions.",
      ],
    },
    {
      capabilityId: "crypto-advice",
      title: "Provide advice on crypto-assets",
      requiredInputs: [],
      requirementTopics: [
        "crypto-asset-service-provider-authorisation",
        "crypto-advice-suitability",
      ],
      prohibitionTopics: [],
      dossierChecks: [],
      actions: [
        "Obtain CASP authorization covering advice and implement suitability assessment.",
      ],
    },
  ],
};

export const preListingPlaybook: PlaybookDefinition = {
  playbookId: "stablecoin-pre-listing",
  name: "Stablecoin Pre-listing & Product Launch",
  version: "1.0.0",
  templateVersion: "1.0.0",
  description:
    "Capability-level readiness for listing and servicing a specific stablecoin (USDC) in the EEA: operator authorization requirements plus asset-side classification, issuer authorization, and verified deployments.",
  capabilities: [
    {
      capabilityId: "list-for-trading",
      title: "Admit the stablecoin to trading on your platform",
      requiredInputs: ["networks"],
      requirementTopics: [
        "crypto-asset-service-provider-authorisation",
        "trading-platform-proprietary-trading",
      ],
      prohibitionTopics: [],
      dossierChecks: [
        "EMT_CLASSIFICATION",
        "ISSUER_AUTHORIZATION",
        "NETWORK_DEPLOYMENT",
      ],
      actions: [
        "Confirm CASP platform authorization scope covers admission to trading.",
        "Verify the exact contract address for each listed network against the issuer's official documentation.",
      ],
    },
    {
      capabilityId: "custody-for-clients",
      title: "Hold the stablecoin in custody for clients",
      requiredInputs: ["networks"],
      requirementTopics: [
        "crypto-asset-service-provider-authorisation",
        "custody-client-assets",
        "casp-client-asset-safeguarding",
      ],
      prohibitionTopics: [],
      dossierChecks: ["EMT_CLASSIFICATION", "NETWORK_DEPLOYMENT"],
      actions: [
        "Confirm CASP custody authorization and client-asset segregation controls.",
      ],
    },
    {
      capabilityId: "transfer-services",
      title: "Transfer the stablecoin for clients",
      requiredInputs: ["networks"],
      requirementTopics: ["crypto-asset-service-provider-authorisation"],
      prohibitionTopics: [],
      dossierChecks: ["NETWORK_DEPLOYMENT"],
      actions: ["Confirm CASP transfer authorization scope."],
    },
  ],
};

export const MVP_PLAYBOOKS: PlaybookDefinition[] = [
  preListingPlaybook,
  businessModelBoundaryPlaybook,
];
