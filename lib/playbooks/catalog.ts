import type { PlaybookDefinition } from "./contracts";

export const PLAYBOOK_CATALOG_SCHEMA_VERSION = "1.0.0" as const;

export const PLAYBOOK_ASSURANCE_NOTE =
  "Evaluations run on provisional machine-assured evidence and are research, not legal advice.";

const INTAKE_CONFIG: Record<string, { assetRequired: boolean }> = {
  "stablecoin-pre-listing": { assetRequired: true },
  "business-model-regulatory-boundary": { assetRequired: false },
};

export function toPublicPlaybookSummary(definition: PlaybookDefinition) {
  return {
    playbookId: definition.playbookId,
    name: definition.name,
    version: definition.version,
    description: definition.description,
    capabilities: definition.capabilities.map((capability) => ({
      capabilityId: capability.capabilityId,
      title: capability.title,
    })),
    assuranceNote: PLAYBOOK_ASSURANCE_NOTE,
  };
}

export function toPublicPlaybookDetail(definition: PlaybookDefinition) {
  return {
    ...toPublicPlaybookSummary(definition),
    templateVersion: definition.templateVersion,
    intakeSchema: buildIntakeSchema(definition),
  };
}

function buildIntakeSchema(definition: PlaybookDefinition): Record<string, unknown> {
  const config = INTAKE_CONFIG[definition.playbookId];
  if (config === undefined) {
    throw new Error(`missing public intake configuration for ${definition.playbookId}`);
  }

  const required = [
    "operatorJurisdiction",
    "targetJurisdiction",
    "activities",
  ];
  const properties: Record<string, unknown> = {
    operatorJurisdiction: {
      type: "string",
      title: "Operator jurisdiction",
      minLength: 1,
    },
    targetJurisdiction: {
      type: "string",
      title: "Target jurisdiction",
      const: "EEA",
    },
    activities: {
      type: "array",
      title: "Requested capabilities",
      minItems: 1,
      uniqueItems: true,
      items: {
        oneOf: definition.capabilities.map((capability) => ({
          const: capability.capabilityId,
          title: capability.title,
        })),
      },
    },
  };

  if (config.assetRequired) {
    required.push("asset");
    properties.asset = {
      type: "object",
      title: "Stablecoin deployment",
      additionalProperties: false,
      required: ["symbol", "networks"],
      properties: {
        symbol: {
          type: "string",
          title: "Stablecoin symbol",
          minLength: 1,
        },
        networks: {
          type: "array",
          title: "Networks",
          minItems: 1,
          uniqueItems: true,
          items: { type: "string", minLength: 1 },
        },
      },
    };
  }

  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    title: `${definition.name} intake`,
    additionalProperties: false,
    required,
    properties,
  };
}
