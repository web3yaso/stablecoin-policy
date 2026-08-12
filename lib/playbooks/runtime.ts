import { replayChecksum } from "../legal-corpus/machine-pipeline";
import type { StablecoinDossier } from "../dossiers";
import type { EvidenceSearchResponse } from "../retrieval/contracts";
import type {
  BusinessProfile,
  CapabilityConclusion,
  CapabilityResult,
  CapabilityRule,
  EvidenceBundle,
  EvidenceClaim,
  PlaybookDefinition,
  PlaybookPackage,
} from "./contracts";

/**
 * Deterministic MVP playbook runtime. decide() is a 1:1 port of
 * specs/playbookPackage.qnt: PERMITTED needs inputs plus direct, fresh,
 * uncontradicted evidence; a fresh direct prohibition yields PROHIBITED; a
 * stale prohibition escalates to COUNSEL_REVIEW; everything less certain
 * degrades. No RAG, no model calls — evidence comes from the provisional
 * corpus and the mini-dossier, and the package inherits their provisional
 * visibility.
 */

export type EvaluationEvidence = {
  claims: EvidenceClaim[];
  dossier: StablecoinDossier | null;
  now: string;
  maxEvidenceAgeDays: number;
};

type CapabilitySignals = {
  inputProvided: boolean;
  hasDirectEvidence: boolean;
  evidenceFresh: boolean;
  evidenceConflicting: boolean;
  evidenceProhibits: boolean;
};

// 1:1 port of specs/playbookPackage.qnt decide()
function decide(signals: CapabilitySignals): CapabilityConclusion {
  if (!signals.inputProvided) return "UNDETERMINED";
  if (signals.evidenceConflicting) return "COUNSEL_REVIEW";
  if (!signals.hasDirectEvidence) return "UNDETERMINED";
  if (signals.evidenceProhibits && !signals.evidenceFresh) return "COUNSEL_REVIEW";
  if (signals.evidenceProhibits) return "PROHIBITED";
  if (!signals.evidenceFresh) return "CONDITIONAL";
  return "PERMITTED";
}

export function evaluatePlaybook(
  definition: PlaybookDefinition,
  profile: BusinessProfile,
  evidence: EvaluationEvidence,
): CapabilityResult[] {
  const known = new Map(
    definition.capabilities.map((rule) => [rule.capabilityId, rule]),
  );
  return profile.activities.map((activityId) => {
    const rule = known.get(activityId);
    if (rule === undefined) {
      return {
        capabilityId: activityId,
        title: activityId,
        conclusion: "UNDETERMINED",
        reasonCodes: ["UNSUPPORTED_ACTIVITY"],
        actions: [
          "This activity is outside the current rule set; request scope extension or counsel review.",
        ],
        evidenceClaimIds: [],
        dossierFacts: [],
        limitations: ["No rules exist for this activity; nothing was assessed."],
      };
    }
    return evaluateCapability(rule, profile, evidence);
  });
}

function evaluateCapability(
  rule: CapabilityRule,
  profile: BusinessProfile,
  evidence: EvaluationEvidence,
): CapabilityResult {
  const reasonCodes: string[] = [];
  const limitations = new Set<string>();
  const evidenceClaimIds: string[] = [];
  const dossierFacts: string[] = [];

  // inputs
  const inputProvided = rule.requiredInputs.every((input) => {
    if (input === "networks") {
      return (profile.asset?.networks.length ?? 0) > 0;
    }
    return false;
  });
  if (!inputProvided) reasonCodes.push("MISSING_INPUT");

  // requirement evidence: every topic needs a direct claim
  const maxAgeMs = evidence.maxEvidenceAgeDays * 24 * 60 * 60 * 1000;
  const nowMs = Date.parse(evidence.now);
  let allTopicsCovered = rule.requirementTopics.length > 0 || rule.prohibitionTopics.length > 0;
  let evidenceFresh = true;
  for (const topic of rule.requirementTopics) {
    const match = evidence.claims.find((claim) => claim.topic === topic);
    if (match === undefined) {
      allTopicsCovered = false;
      continue;
    }
    evidenceClaimIds.push(match.claimId);
    match.limitations.forEach((limitation) => limitations.add(limitation));
    if (nowMs - Date.parse(match.asOf) > maxAgeMs) evidenceFresh = false;
  }

  // prohibitions
  let evidenceProhibits = false;
  for (const topic of rule.prohibitionTopics) {
    const match = evidence.claims.find(
      (claim) => claim.topic === topic && claim.legalStatus === "PROHIBITION",
    );
    if (match === undefined) {
      allTopicsCovered = false;
      continue;
    }
    evidenceProhibits = true;
    evidenceClaimIds.push(match.claimId);
    match.limitations.forEach((limitation) => limitations.add(limitation));
    if (nowMs - Date.parse(match.asOf) > maxAgeMs) evidenceFresh = false;
  }

  // dossier checks
  let dossierOk = true;
  for (const check of rule.dossierChecks) {
    const outcome = runDossierCheck(check, profile, evidence.dossier);
    if (outcome.fact !== null) dossierFacts.push(outcome.fact);
    if (!outcome.ok) {
      dossierOk = false;
      reasonCodes.push(outcome.reasonCode);
    }
    if (outcome.limitation !== null) limitations.add(outcome.limitation);
  }

  const hasDirectEvidence = allTopicsCovered && dossierOk;
  if (!hasDirectEvidence && !reasonCodes.includes("DEPLOYMENT_NOT_VERIFIED")) {
    reasonCodes.push("NO_DIRECT_EVIDENCE");
  }
  if (!evidenceFresh) reasonCodes.push("EVIDENCE_STALE");
  if (evidenceProhibits) reasonCodes.push("PROHIBITION_APPLIES");

  const conclusion = decide({
    inputProvided,
    hasDirectEvidence,
    evidenceFresh,
    evidenceConflicting: false,
    evidenceProhibits,
  });
  if (
    conclusion === "CONDITIONAL" &&
    rule.requirementTopics.length > 0 &&
    !reasonCodes.includes("AUTHORIZATION_REQUIRED")
  ) {
    reasonCodes.push("AUTHORIZATION_REQUIRED");
  }
  // a fully supported requirement capability is still conditional on actually
  // holding the authorization the claims require — PERMITTED is reserved for
  // capabilities with no outstanding requirement
  const finalConclusion: CapabilityConclusion =
    conclusion === "PERMITTED" && rule.requirementTopics.length > 0
      ? "CONDITIONAL"
      : conclusion;
  if (
    finalConclusion === "CONDITIONAL" &&
    !reasonCodes.includes("AUTHORIZATION_REQUIRED") &&
    rule.requirementTopics.length > 0
  ) {
    reasonCodes.push("AUTHORIZATION_REQUIRED");
  }

  return {
    capabilityId: rule.capabilityId,
    title: rule.title,
    conclusion: finalConclusion,
    reasonCodes: [...new Set(reasonCodes)],
    actions: rule.actions,
    evidenceClaimIds: [...new Set(evidenceClaimIds)],
    dossierFacts,
    limitations: [...limitations],
  };
}

function runDossierCheck(
  check: string,
  profile: BusinessProfile,
  dossier: StablecoinDossier | null,
): { ok: boolean; reasonCode: string; fact: string | null; limitation: string | null } {
  if (dossier === null) {
    return {
      ok: false,
      reasonCode: "DOSSIER_MISSING",
      fact: null,
      limitation: "No asset dossier is available for this evaluation.",
    };
  }
  if (check === "EMT_CLASSIFICATION") {
    const ok = dossier.asset.classification === "E_MONEY_TOKEN";
    return {
      ok,
      reasonCode: "ASSET_CLASSIFICATION_UNVERIFIED",
      fact: `asset ${dossier.asset.symbol} classified ${dossier.asset.classification} (basis ${dossier.asset.classificationBasis})`,
      limitation: null,
    };
  }
  if (check === "ISSUER_AUTHORIZATION") {
    const ok = dossier.authorizations.length > 0;
    return {
      ok,
      reasonCode: "ISSUER_AUTHORIZATION_UNVERIFIED",
      fact: ok
        ? `issuer ${dossier.issuer.legalName} holds: ${dossier.authorizations
            .map((authorization) => authorization.authorizationType)
            .join(", ")}`
        : null,
      limitation:
        "Issuer authorization facts are provisional; confirm the official register entries before reliance.",
    };
  }
  if (check === "NETWORK_DEPLOYMENT") {
    const requested = profile.asset?.networks ?? [];
    const verified = requested.filter((network) =>
      dossier.deployments.some(
        (deployment) => deployment.network === network && deployment.native,
      ),
    );
    const missing = requested.filter((network) => !verified.includes(network));
    return {
      ok: requested.length > 0 && missing.length === 0,
      reasonCode: "DEPLOYMENT_NOT_VERIFIED",
      fact:
        verified.length > 0
          ? `verified native deployments: ${verified
              .map((network) => {
                const deployment = dossier.deployments.find(
                  (candidate) => candidate.network === network,
                );
                return `${network}=${deployment?.contractAddress}`;
              })
              .join(", ")}`
          : null,
      limitation:
        missing.length > 0
          ? `No verified native deployment for: ${missing.join(", ")}.`
          : null,
    };
  }
  return { ok: false, reasonCode: "UNKNOWN_DOSSIER_CHECK", fact: null, limitation: null };
}

const PACKAGE_LIMITATIONS = [
  "Provisional machine-assured evidence; not human-reviewed legal advice.",
  "Capability conclusions are research and operational preparation, not compliance clearance.",
];

const PACKAGE_COUNSEL_TRIGGERS = ["PROVISIONAL_EVIDENCE_REVIEW_RECOMMENDED"];

export function sealPlaybookPackage(
  definition: PlaybookDefinition,
  profile: BusinessProfile,
  conclusions: CapabilityResult[],
  evidence: EvaluationEvidence,
  retrieval: EvidenceSearchResponse | null = null,
): PlaybookPackage {
  const referenced = new Set(
    conclusions.flatMap((result) => result.evidenceClaimIds),
  );
  const referencedClaims = evidence.claims.filter((claim) =>
    referenced.has(claim.claimId),
  );
  const corpusReleaseId = referencedClaims[0]?.releaseId ?? null;
  const provisional = true; // MVP evidence is always machine-assured

  const sealable = {
    schemaVersion: "1.1.0" as const,
    playbookId: definition.playbookId,
    playbookName: definition.name,
    profileFingerprint: replayChecksum(profile),
    conclusions,
    assurance: {
      reviewStatus: provisional ? ("PROVISIONAL" as const) : ("HUMAN_REVIEWED" as const),
      humanReviewed: false as const,
      limitations: [
        ...PACKAGE_LIMITATIONS,
        ...new Set(conclusions.flatMap((result) => result.limitations)),
      ],
      counselTriggers: [
        ...PACKAGE_COUNSEL_TRIGGERS,
        ...new Set(
          conclusions
            .filter((result) => result.conclusion === "COUNSEL_REVIEW")
            .map((result) => `COUNSEL_REVIEW:${result.capabilityId}`),
        ),
      ],
    },
    versions: {
      corpusReleaseId,
      corpusAsOf: referencedClaims[0]?.asOf ?? null,
      knowledgeCutoff: referencedClaims[0]?.knowledgeCutoff ?? null,
      dossierId: evidence.dossier?.dossierId ?? null,
      dossierCuratedAt: evidence.dossier?.curatedAt ?? null,
      retrievalIndexReleaseId: retrieval?.indexRelease?.indexReleaseId ?? null,
      retrievalCorpusReleaseId: retrieval?.indexRelease?.corpusReleaseId ?? null,
      retrievalAsOf: retrieval?.indexRelease?.asOf ?? null,
      retrievalKnowledgeCutoff: retrieval?.indexRelease?.knowledgeCutoff ?? null,
      rulesVersion: definition.version,
      templateVersion: definition.templateVersion,
      schemaVersion: "1.1.0" as const,
    },
    evaluatedAt: evidence.now,
  };
  const integritySha256 = replayChecksum(sealable);
  return {
    ...sealable,
    packageId: `package:${definition.playbookId}:${integritySha256.slice(0, 16)}`,
    integritySha256,
  };
}

export function verifyPlaybookPackageIntegrity(pkg: PlaybookPackage): boolean {
  const { packageId, integritySha256, ...sealable } = pkg;
  return replayChecksum(sealable) === integritySha256
    && packageId === `package:${pkg.playbookId}:${integritySha256.slice(0, 16)}`;
}

export function assembleEvidenceBundle(
  pkg: PlaybookPackage,
  evidence: EvaluationEvidence,
  retrieval: EvidenceSearchResponse | null = null,
): EvidenceBundle {
  const referenced = new Set(
    pkg.conclusions.flatMap((result) => result.evidenceClaimIds),
  );
  return {
    schemaVersion: "1.1.0",
    packageId: pkg.packageId,
    claims: evidence.claims.filter((claim) => referenced.has(claim.claimId)),
    dossierFacts: [...new Set(pkg.conclusions.flatMap((result) => result.dossierFacts))],
    retrieval: assemblePlaybookRetrievalEvidence(pkg, retrieval),
  };
}

function assemblePlaybookRetrievalEvidence(
  pkg: PlaybookPackage,
  retrieval: EvidenceSearchResponse | null,
): EvidenceBundle["retrieval"] {
  const index = retrieval?.indexRelease ?? null;
  if (
    pkg.versions.retrievalIndexReleaseId !== (index?.indexReleaseId ?? null)
    || pkg.versions.retrievalCorpusReleaseId !== (index?.corpusReleaseId ?? null)
    || pkg.versions.retrievalAsOf !== (index?.asOf ?? null)
    || pkg.versions.retrievalKnowledgeCutoff !== (index?.knowledgeCutoff ?? null)
  ) {
    throw new Error("retrieval evidence does not match the sealed package versions");
  }
  if (retrieval === null) {
    return {
      status: "RETRIEVAL_UNAVAILABLE",
      runId: null,
      querySha256: null,
      indexReleaseId: null,
      corpusReleaseId: null,
      asOf: null,
      knowledgeCutoff: null,
      items: [],
      limitations: [
        "Evidence retrieval was not run; deterministic conclusions remain unchanged.",
      ],
    };
  }
  if (retrieval.status === "SUCCESS" && index === null) {
    throw new Error("successful retrieval must pin an index release");
  }
  return {
    status: retrieval.status,
    runId: retrieval.runId,
    querySha256: retrieval.querySha256,
    indexReleaseId: index?.indexReleaseId ?? null,
    corpusReleaseId: index?.corpusReleaseId ?? null,
    asOf: index?.asOf ?? null,
    knowledgeCutoff: index?.knowledgeCutoff ?? null,
    items: (retrieval.status === "SUCCESS" ? retrieval.hits : []).map((hit) => ({
      rank: hit.rank,
      score: hit.score,
      chunkId: hit.chunkId,
      claimId: hit.claim.claimId,
      topic: hit.claim.topic,
      legalStatus: hit.claim.legalStatus,
      supportRelation: hit.claim.supportRelation,
      citationId: hit.citation.citationId,
      provisionId: hit.citation.provisionId,
      sourceVersionId: hit.citation.sourceVersionId,
      sourceVersionChecksumSha256: hit.citation.sourceVersionChecksumSha256,
      documentTitle: hit.citation.documentTitle,
      sourceType: hit.citation.sourceType,
      authorityName: hit.citation.authorityName,
      locator: hit.citation.locator,
      canonicalUrl: hit.citation.canonicalUrl,
      excerpt: hit.citation.excerpt,
      excerptPermission: hit.citation.excerptPermission,
      jurisdictionCode: hit.jurisdictionCode,
      effectiveFrom: hit.effectiveFrom,
      effectiveTo: hit.effectiveTo,
      assuranceTier: hit.assuranceTier,
      reviewStatus: hit.reviewStatus,
    })),
    limitations: [...retrieval.limitations],
  };
}
