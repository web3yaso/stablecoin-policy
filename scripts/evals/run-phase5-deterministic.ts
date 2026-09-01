import { readFile } from "node:fs/promises";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020";
import type { BusinessProfile, EvidenceClaim } from "../../lib/playbooks/contracts";
import {
  businessModelBoundaryPlaybook,
  preListingPlaybook,
} from "../../lib/playbooks/definitions";
import {
  runDeterministicRuleActionEval,
  type DegradationKind,
  type DeterministicRuleActionEvalCase,
  type DeterministicRuleActionEvalReport,
} from "../../lib/playbooks/deterministic-rule-action-eval";
import type { EvaluationEvidence } from "../../lib/playbooks/runtime";
import type { SelfServiceScope } from "../../lib/playbooks/scope-readiness";
import { loadDossierFile } from "../../lib/dossiers";

const DATASET_PATH = path.join(process.cwd(), "evals", "playbook-actions.jsonl");
const NOW = "2026-08-03T00:00:00.000Z";

type EvalCaseRecord = {
  schemaVersion: "1.0.0";
  caseId: string;
  scope: SelfServiceScope;
  capabilityId: string;
  profileVariant:
    | "BOUNDARY"
    | "PRELIST_BASE"
    | "PRELIST_NO_NETWORK"
    | "PRELIST_UNVERIFIED_NETWORK";
  evidenceVariant: "FRESH" | "MISSING" | "STALE" | "CONFLICTING";
  expected: Omit<DeterministicRuleActionEvalCase["expected"], "capabilityId">;
  degradationKind: DegradationKind;
};

export async function buildDeterministicRuleActionEvalCases(): Promise<
  DeterministicRuleActionEvalCase[]
> {
  const records = await readDataset();
  const dossier = await loadDossierFile("data/dossiers/usdc-eea.json");
  return records.map((record) => {
    const definition = record.scope.playbookId === preListingPlaybook.playbookId
      ? preListingPlaybook
      : businessModelBoundaryPlaybook;
    if (!definition.capabilities.some(
      (capability) => capability.capabilityId === record.capabilityId,
    )) throw new Error(`unknown eval capability: ${record.capabilityId}`);
    if ((record.scope.assetId === "usdc") !== (definition === preListingPlaybook)) {
      throw new Error(`eval scope does not match playbook: ${record.caseId}`);
    }
    return {
      caseId: record.caseId,
      scope: record.scope,
      definition,
      profile: profileFor(record),
      evidence: evidenceFor(
        record.evidenceVariant,
        definition === preListingPlaybook ? dossier : null,
      ),
      expected: {
        capabilityId: record.capabilityId,
        ...record.expected,
      },
      degradationKind: record.degradationKind,
    };
  });
}

export async function buildDeterministicRuleActionEvalReport(): Promise<
  DeterministicRuleActionEvalReport
> {
  const report = await runDeterministicRuleActionEval(
    await buildDeterministicRuleActionEvalCases(),
  );
  const schema = JSON.parse(await readFile(
    path.join(
      process.cwd(),
      "contracts/v1/deterministic-rule-action-eval-report.schema.json",
    ),
    "utf8",
  )) as object;
  const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);
  if (!validate(report)) {
    throw new Error(`deterministic eval report schema failed: ${JSON.stringify(validate.errors)}`);
  }
  return report;
}

async function readDataset(): Promise<EvalCaseRecord[]> {
  const schema = JSON.parse(await readFile(
    path.join(
      process.cwd(),
      "contracts/v1/deterministic-rule-action-eval-case.schema.json",
    ),
    "utf8",
  )) as object;
  const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);
  const records = (await readFile(DATASET_PATH, "utf8"))
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        throw new Error(`invalid deterministic eval JSON on line ${index + 1}`);
      }
      if (!validate(value)) {
        throw new Error(
          `invalid deterministic eval case on line ${index + 1}: ${JSON.stringify(validate.errors)}`,
        );
      }
      return value as EvalCaseRecord;
    });
  if (records.length === 0) throw new Error("deterministic eval dataset is empty");
  return records;
}

function profileFor(record: EvalCaseRecord): BusinessProfile {
  const networks = record.profileVariant === "PRELIST_BASE"
    ? ["base"]
    : record.profileVariant === "PRELIST_UNVERIFIED_NETWORK"
      ? ["tron"]
      : [];
  return {
    operatorJurisdiction: "SG",
    targetJurisdiction: "EEA",
    activities: [record.capabilityId],
    asset: record.profileVariant === "BOUNDARY"
      ? null
      : { symbol: "USDC", networks },
  };
}

function evidenceFor(
  variant: EvalCaseRecord["evidenceVariant"],
  dossier: EvaluationEvidence["dossier"],
): EvaluationEvidence {
  let claims = baseClaims();
  if (variant === "MISSING") claims = [];
  if (variant === "STALE") {
    claims = claims.map((item) => ({ ...item, asOf: "2026-01-01T00:00:00.000Z" }));
  }
  if (variant === "CONFLICTING") {
    claims = [...claims, claim({
      claimId: "claim:eea:mica:e-money-token-authorisation:conflict",
      topic: "e-money-token-authorisation",
      legalStatus: "PROHIBITION",
    })];
  }
  return { claims, dossier, now: NOW, maxEvidenceAgeDays: 90 };
}

function baseClaims(): EvidenceClaim[] {
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
      claimId: "claim:eea:mica:trading-platform-proprietary-trading:29",
      topic: "trading-platform-proprietary-trading",
    }),
  ];
}

function claim(overrides: Partial<EvidenceClaim>): EvidenceClaim {
  return {
    claimId: "claim:eea:mica:fixture:1",
    topic: "fixture-topic",
    legalStatus: "REQUIREMENT",
    proposition: "Sanitized deterministic eval proposition.",
    citations: [{ provisionId: "provision:fixture:1", locator: "Article 1" }],
    releaseId: "provisional:eea:mica:2026-08-02",
    asOf: "2026-08-02T00:00:00.000Z",
    knowledgeCutoff: "2026-08-01T00:00:00.000Z",
    confidence: 0.9,
    limitations: ["Machine-assured fixture; not human-reviewed legal advice."],
    ...overrides,
  };
}

async function main(): Promise<void> {
  const report = await buildDeterministicRuleActionEvalReport();
  console.log(JSON.stringify(report, null, 2));
  if (report.outcome !== "PASSED") {
    throw new Error("Phase 5 deterministic rule/action eval gates failed");
  }
}

if (process.argv[1]?.endsWith("run-phase5-deterministic.ts")) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
