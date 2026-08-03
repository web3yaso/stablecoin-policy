import { createHash } from "node:crypto";
import type { ClaimDraftBundle } from "./claim-draft-import";
import type { MachineAssuranceChecks } from "./machine-assurance";
import type { SourceVerificationManifest } from "./verification";

/**
 * Pure logic for the automated claim pipeline:
 * official provisions -> AI extraction -> independent cross-check ->
 * deterministic checks -> provisional release. Model output is untrusted
 * input; nothing here calls a model or the network. The contradiction check
 * is owned by the cross-check comparison and stays NOT_EVALUATED in the
 * deterministic pass.
 */

export type ExtractedClaimDraft = {
  claimId: string;
  jurisdictionCode: string;
  topic: string;
  proposition: string;
  legalStatus:
    | "REQUIREMENT"
    | "PERMISSION"
    | "PROHIBITION"
    | "EXEMPTION"
    | "GUIDANCE"
    | "UNDETERMINED";
  effectiveFrom: string;
  citations: Array<{ provisionId: string; locator: string }>;
  confidence: number;
};

export type ExtractionRun = {
  sourceVersionId: string;
  jurisdictionCode: string;
  model: string;
  promptTemplateId: string;
  promptTemplateVersion: string;
  parametersVersion: string;
  drafts: ExtractedClaimDraft[];
};

export type DeterministicCheckInput = {
  manifest: SourceVerificationManifest;
  draft: ExtractedClaimDraft;
  expectedJurisdiction: string;
  now: string;
  freshnessMaxDays: number;
};

export type DeterministicCheckResult = {
  checks: MachineAssuranceChecks;
  blockers: string[];
  limitations: string[];
};

const ID = /^[a-z0-9][a-z0-9._:-]{2,200}$/;
const LEGAL_STATUSES = new Set([
  "REQUIREMENT",
  "PERMISSION",
  "PROHIBITION",
  "EXEMPTION",
  "GUIDANCE",
  "UNDETERMINED",
]);

/**
 * Validates untrusted model output. Instructions embedded in source text can
 * at most produce drafts; fabricated citations are then killed by
 * runDeterministicChecks, so nothing a source document says can become
 * authority on its own.
 */
export function parseExtractionOutput(raw: unknown): ExtractedClaimDraft[] {
  if (!Array.isArray(raw)) {
    throw new Error("extraction output must be an array of claim drafts");
  }
  return raw.map((entry, index) => {
    const candidate = entry as Partial<ExtractedClaimDraft> | null;
    if (typeof candidate !== "object" || candidate === null) {
      throw new Error(`extraction draft ${index} is not an object`);
    }
    if (typeof candidate.claimId !== "string" || !ID.test(candidate.claimId)) {
      throw new Error(`extraction draft ${index} has an invalid claimId`);
    }
    if (
      typeof candidate.legalStatus !== "string" ||
      !LEGAL_STATUSES.has(candidate.legalStatus)
    ) {
      throw new Error(`extraction draft ${index} has an unknown legal status`);
    }
    if (
      typeof candidate.confidence !== "number" ||
      !Number.isFinite(candidate.confidence) ||
      candidate.confidence < 0 ||
      candidate.confidence > 1
    ) {
      throw new Error(`extraction draft ${index} has an invalid confidence`);
    }
    if (
      !Array.isArray(candidate.citations) ||
      candidate.citations.length === 0 ||
      candidate.citations.some(
        (citation) =>
          typeof citation?.provisionId !== "string" ||
          !ID.test(citation.provisionId) ||
          typeof citation?.locator !== "string" ||
          citation.locator.trim().length === 0,
      )
    ) {
      throw new Error(`extraction draft ${index} needs at least one exact citation`);
    }
    if (
      typeof candidate.jurisdictionCode !== "string" ||
      typeof candidate.topic !== "string" ||
      !candidate.topic.trim() ||
      typeof candidate.proposition !== "string" ||
      !candidate.proposition.trim() ||
      typeof candidate.effectiveFrom !== "string" ||
      !Number.isFinite(Date.parse(candidate.effectiveFrom))
    ) {
      throw new Error(`extraction draft ${index} has missing or invalid fields`);
    }
    return {
      claimId: candidate.claimId,
      jurisdictionCode: candidate.jurisdictionCode,
      topic: candidate.topic.trim(),
      proposition: candidate.proposition.trim(),
      legalStatus: candidate.legalStatus as ExtractedClaimDraft["legalStatus"],
      effectiveFrom: candidate.effectiveFrom,
      citations: candidate.citations.map((citation) => ({
        provisionId: citation.provisionId,
        locator: citation.locator.trim(),
      })),
      confidence: candidate.confidence,
    };
  });
}

/**
 * Projects an extraction run into the migration-0015 draft-bundle format.
 * The import path forces every claim to private DRAFT and rejects review
 * fields, so the bundle deliberately carries none.
 */
export function toClaimDraftBundle(
  run: ExtractionRun,
  batchId: string,
  knowledgeCutoff: string,
): ClaimDraftBundle {
  return {
    schemaVersion: "1.0.0",
    batchId,
    jurisdictionCode: run.jurisdictionCode,
    claims: run.drafts.map((draft) => ({
      claimId: draft.claimId,
      jurisdictionCode: draft.jurisdictionCode,
      topic: draft.topic,
      proposition: draft.proposition,
      legalStatus: draft.legalStatus,
      effectiveFrom: draft.effectiveFrom,
      effectiveTo: null,
      knowledgeCutoff,
      supersedesClaimId: null,
      actorTypes: [],
      activityCodes: [],
      citations: draft.citations.map((citation, index) => ({
        citationId: `${draft.claimId}:citation:${index + 1}`,
        provisionId: citation.provisionId,
        supportRelation: "DIRECT_SUPPORT",
        exactLocator: citation.locator,
        allowedExcerpt: null,
      })),
    })),
  };
}

export function runDeterministicChecks(
  input: DeterministicCheckInput,
): DeterministicCheckResult {
  const { manifest, draft } = input;
  const blockers: string[] = [];
  const limitations: string[] = [
    "Machine-generated draft; not human-reviewed legal advice.",
  ];

  const provisionsById = new Map(
    manifest.provisions.map((provision) => [provision.provisionId, provision]),
  );

  const citationsMatch =
    draft.citations.length > 0 &&
    draft.citations.every((citation) => {
      const provision = provisionsById.get(citation.provisionId);
      return provision !== undefined && provision.locator === citation.locator;
    });
  if (!citationsMatch) blockers.push("CITATION_LOCATOR_MISMATCH");

  const citedPermissionsAllowed = draft.citations.every(
    (citation) =>
      provisionsById.get(citation.provisionId)?.effectiveExcerptPermission ===
      "ALLOWED",
  );
  const rightsOk =
    manifest.storageRights === "ALLOWED" && citationsMatch && citedPermissionsAllowed;
  if (!rightsOk) {
    blockers.push("EXCERPT_RIGHTS_BLOCKED");
    limitations.push(
      "One or more cited provisions cannot be excerpted; consult the official source directly.",
    );
  }

  const ageMs = Date.parse(input.now) - Date.parse(manifest.retrievedAt);
  const freshnessOk =
    Number.isFinite(ageMs) &&
    ageMs >= 0 &&
    ageMs <= input.freshnessMaxDays * 24 * 60 * 60 * 1000;
  if (!freshnessOk) blockers.push("SOURCE_STALE");

  const jurisdictionOk = draft.jurisdictionCode === input.expectedJurisdiction;
  if (!jurisdictionOk) blockers.push("JURISDICTION_MISMATCH");

  // a consolidation snapshot's effectiveFrom is the version date, not the
  // law's commencement: claims routinely take effect earlier, so only the
  // upper bound is checked (a claim cannot start after the version's window)
  const effectiveFromMs = Date.parse(draft.effectiveFrom);
  const upperOk =
    manifest.effectiveTo === null ||
    effectiveFromMs <= Date.parse(manifest.effectiveTo);
  const effectiveDatesOk = Number.isFinite(effectiveFromMs) && upperOk;
  if (!effectiveDatesOk) blockers.push("EFFECTIVE_DATE_OUT_OF_RANGE");

  return {
    checks: {
      contradiction: "NOT_EVALUATED",
      freshness: freshnessOk ? "PASS" : "FAIL",
      rights: rightsOk ? "PASS" : "FAIL",
      jurisdiction: jurisdictionOk ? "PASS" : "FAIL",
      effectiveDates: effectiveDatesOk ? "PASS" : "FAIL",
      citationLocator: citationsMatch ? "PASS" : "FAIL",
    },
    blockers,
    limitations,
  };
}

export type CrossCheckComparison = {
  agreed: boolean;
  blockers: string[];
};

/**
 * Compares a primary draft against the independent model's re-derivation of
 * the same provisions. Agreement requires the same citation set and the same
 * legal status; confidence may differ.
 */
export function compareCrossCheck(
  primary: ExtractedClaimDraft,
  independent: ExtractedClaimDraft | undefined,
): CrossCheckComparison {
  if (independent === undefined) {
    return { agreed: false, blockers: ["CROSS_CHECK_MISSING"] };
  }
  const key = (draft: ExtractedClaimDraft): string =>
    draft.citations
      .map((citation) => `${citation.provisionId}#${citation.locator}`)
      .sort()
      .join("|");
  if (key(primary) !== key(independent)) {
    return { agreed: false, blockers: ["CROSS_CHECK_CITATION_DIVERGENCE"] };
  }
  if (primary.legalStatus !== independent.legalStatus) {
    return { agreed: false, blockers: ["CROSS_MODEL_CONTRADICTION"] };
  }
  return { agreed: true, blockers: [] };
}

/** Canonical-JSON SHA-256 so identical inputs replay to identical checksums. */
export function replayChecksum(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalJson(entryValue)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}
