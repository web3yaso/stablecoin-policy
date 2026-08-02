import type { SupabaseHttpClient } from "../data/supabase-client";

/**
 * Machine-assurance lane (spec section 8.4, modeled in
 * specs/machineAssurance.qnt). Machine states never touch the named-human
 * review lane: records carry no reviewer identity, and the service RPC cannot
 * write review or verification fields. `PROVISIONAL_PUBLISHED` is reserved for
 * the provisional-release path (migration 0021); it can never be recorded
 * directly through this module.
 */

export type MachineAssuranceLevel =
  | "SOURCE_VALIDATED"
  | "AI_EXTRACTED"
  | "AI_CROSS_CHECKED"
  | "PROVISIONAL_PUBLISHED";

export type MachineCheckResult = "PASS" | "FAIL" | "NOT_EVALUATED";

export type MachineAssuranceChecks = {
  contradiction: MachineCheckResult;
  freshness: MachineCheckResult;
  rights: MachineCheckResult;
  jurisdiction: MachineCheckResult;
  effectiveDates: MachineCheckResult;
  citationLocator: MachineCheckResult;
};

export const MACHINE_CHECK_NAMES = [
  "contradiction",
  "freshness",
  "rights",
  "jurisdiction",
  "effectiveDates",
  "citationLocator",
] as const;

export type MachineAssuranceRecordInput = {
  recordId: string;
  subjectType: "SOURCE_VERSION" | "CLAIM_DRAFT";
  subjectId: string;
  assuranceLevel: MachineAssuranceLevel;
  sourceVersionFingerprint: string;
  claimFingerprint: string | null;
  model: string | null;
  promptTemplateId: string | null;
  promptTemplateVersion: string | null;
  parametersVersion: string | null;
  confidence: number | null;
  checks: MachineAssuranceChecks;
  inputChecksumSha256: string;
  outputChecksumSha256: string;
  blockers: string[];
  limitations: string[];
};

export type MachineAssuranceRecordResult = {
  recordId: string;
  subjectType: string;
  subjectId: string;
  assuranceLevel: MachineAssuranceLevel;
  outcome: "ADVANCED" | "BLOCKED";
  createdAt: string;
};

const SHA256 = /^[0-9a-f]{64}$/;
const ID = /^[a-z0-9][a-z0-9._:-]{2,160}$/;
const CHECK_RESULTS = new Set<MachineCheckResult>([
  "PASS",
  "FAIL",
  "NOT_EVALUATED",
]);

function checksShapeValid(checks: MachineAssuranceChecks): boolean {
  const keys = Object.keys(checks as Record<string, unknown>);
  if (keys.length !== MACHINE_CHECK_NAMES.length) return false;
  return MACHINE_CHECK_NAMES.every((name) =>
    CHECK_RESULTS.has((checks as Record<string, MachineCheckResult>)[name]),
  );
}

/**
 * Pure validation mirrored by the CHECK constraints and RPC guards in
 * migration 0020. Returns machine-readable error codes; empty means valid.
 */
export function machineAssuranceInputErrors(
  input: MachineAssuranceRecordInput,
): string[] {
  const errors: string[] = [];

  if (!ID.test(input.recordId) || !ID.test(input.subjectId)) {
    errors.push("identifier_invalid");
  }
  if (input.assuranceLevel === "PROVISIONAL_PUBLISHED") {
    errors.push("level_reserved_for_release");
    return errors;
  }

  const isModelLevel =
    input.assuranceLevel === "AI_EXTRACTED" ||
    input.assuranceLevel === "AI_CROSS_CHECKED";
  const hasAnyModelField =
    input.model !== null ||
    input.promptTemplateId !== null ||
    input.promptTemplateVersion !== null ||
    input.parametersVersion !== null ||
    input.confidence !== null;
  const hasAllModelFields =
    !!input.model?.trim() &&
    !!input.promptTemplateId?.trim() &&
    !!input.promptTemplateVersion?.trim() &&
    !!input.parametersVersion?.trim() &&
    input.confidence !== null;

  if (isModelLevel && !hasAllModelFields) errors.push("model_provenance_missing");
  if (!isModelLevel && hasAnyModelField) errors.push("model_provenance_forbidden");

  if (
    input.confidence !== null &&
    (!Number.isFinite(input.confidence) ||
      input.confidence < 0 ||
      input.confidence > 1)
  ) {
    errors.push("confidence_out_of_range");
  }

  if (input.assuranceLevel === "SOURCE_VALIDATED") {
    if (input.subjectType !== "SOURCE_VERSION") errors.push("subject_level_mismatch");
    if (input.claimFingerprint !== null) errors.push("claim_fingerprint_forbidden");
  } else {
    if (input.subjectType !== "CLAIM_DRAFT") errors.push("subject_level_mismatch");
    if (input.claimFingerprint === null) {
      errors.push("claim_fingerprint_missing");
    } else if (!SHA256.test(input.claimFingerprint)) {
      errors.push("checksum_invalid");
    }
  }

  if (
    !SHA256.test(input.sourceVersionFingerprint) ||
    !SHA256.test(input.inputChecksumSha256) ||
    !SHA256.test(input.outputChecksumSha256)
  ) {
    errors.push("checksum_invalid");
  }

  if (!checksShapeValid(input.checks)) errors.push("checks_shape_invalid");

  return errors;
}

/**
 * A record may advance its subject's machine level only when every
 * deterministic check passes and no blockers exist. A failing record is still
 * recorded (outcome BLOCKED) so the failure is auditable — it just cannot
 * advance anything.
 */
export function machineAssuranceCanAdvance(
  input: MachineAssuranceRecordInput,
): boolean {
  if (!checksShapeValid(input.checks)) return false;
  return (
    MACHINE_CHECK_NAMES.every((name) => input.checks[name] === "PASS") &&
    input.blockers.length === 0
  );
}

export type MachineAssuranceChainEntry = MachineAssuranceRecordResult & {
  checks: MachineAssuranceChecks;
  blockers: string[];
  limitations: string[];
};

export class MachineAssuranceClient {
  constructor(private readonly client: SupabaseHttpClient) {}

  async record(
    input: MachineAssuranceRecordInput,
  ): Promise<MachineAssuranceRecordResult> {
    const errors = machineAssuranceInputErrors(input);
    if (errors.length > 0) {
      throw new Error(`machine assurance record invalid: ${errors.join(", ")}`);
    }
    return this.client.rpc<MachineAssuranceRecordResult>(
      "record_machine_assurance",
      {
        p_record_id: input.recordId,
        p_subject_type: input.subjectType,
        p_subject_id: input.subjectId,
        p_assurance_level: input.assuranceLevel,
        p_source_version_fingerprint: input.sourceVersionFingerprint,
        p_claim_fingerprint: input.claimFingerprint,
        p_model: input.model,
        p_prompt_template_id: input.promptTemplateId,
        p_prompt_template_version: input.promptTemplateVersion,
        p_parameters_version: input.parametersVersion,
        p_confidence: input.confidence,
        p_checks: input.checks,
        p_input_checksum_sha256: input.inputChecksumSha256,
        p_output_checksum_sha256: input.outputChecksumSha256,
        p_blockers: input.blockers,
        p_limitations: input.limitations,
      },
    );
  }

  async chain(
    subjectType: MachineAssuranceRecordInput["subjectType"],
    subjectId: string,
  ): Promise<MachineAssuranceChainEntry[]> {
    if (!ID.test(subjectId)) throw new Error("machine assurance subject ID is invalid");
    return this.client.rpc<MachineAssuranceChainEntry[]>(
      "get_machine_assurance_chain",
      { p_subject_type: subjectType, p_subject_id: subjectId },
    );
  }
}
