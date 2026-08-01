import { readFile } from "node:fs/promises";
import path from "node:path";
import { evaluateClaimPublication } from "../../lib/legal-corpus/policy";
import { extractEurLexArticles } from "../../lib/legal-corpus/ingestion/eurlex";
import { assertHkelIdentity, extractHkelSections } from "../../lib/legal-corpus/ingestion/hkel";
import { assertSsoIdentity, extractSsoSections } from "../../lib/legal-corpus/ingestion/sso";
import { assertSourceStorageRights } from "../../lib/legal-corpus/ingestion/supabase-publisher";
import {
  sourceVerificationReadinessErrors,
  type SourceVerificationManifestEnvelope,
} from "../../lib/legal-corpus/verification";
import {
  claimEvidenceReadinessErrors,
  type ClaimEvidenceReadinessInput,
} from "../../lib/legal-corpus/claim-review";
import {
  corpusReleaseReadinessErrors,
  type CorpusReleaseReadinessInput,
} from "../../lib/legal-corpus/corpus-release";
import {
  coverageReadinessErrors,
  type CoverageReadinessInput,
} from "../../lib/legal-corpus/coverage-review";
import {
  baselineWorkflowStage,
  type BaselineReadinessInput,
  type BaselineWorkflowStage,
} from "../../lib/legal-corpus/baseline-readiness";
import {
  claimDraftBundleErrors,
  claimDraftImportErrors,
  claimDraftReviewReadinessErrors,
  type ClaimDraftBundleReadinessInput,
  type ClaimDraftImportReadinessInput,
  type ClaimDraftReviewReadinessInput,
} from "../../lib/legal-corpus/claim-draft-import";
import {
  reviewQueueNextAction,
  type ReviewQueueActionInput,
  type ReviewQueueNextAction,
} from "../../lib/legal-corpus/review-queue";
import type {
  ClaimLegalStatus,
  ClaimReviewState,
  CitationSupport,
  EvidenceLayer,
  EvidenceUse,
  LegalClaim,
} from "../../lib/legal-corpus/types";

type Expected = "PUBLISH" | "BLOCK";

type CorpusCase = {
  caseId: string;
  reviewState: ClaimReviewState;
  legalStatus: ClaimLegalStatus;
  effectiveFrom: string;
  effectiveTo?: string;
  citations: Array<{
    relation: CitationSupport;
    evidenceLayer: EvidenceLayer;
    evidenceUse: EvidenceUse;
    locator: string;
  }>;
  expected: Expected;
};

type IngestionCase = {
  caseId: string;
  html: string;
  expectedCount: number;
  expectedLocators: string[];
};

type HkelIngestionCase = {
  caseId: string;
  xml: string;
  expectedLocators: string[];
  expectedIdentityError: boolean;
};

type SsoIngestionCase = {
  caseId: string;
  html: string;
  expectedLocators: string[];
  expectedError: boolean;
  expectedIdentityError: boolean;
  title?: string;
  documentNumber?: string;
  validDate?: string;
  provisionKind?: "section" | "regulation" | "paragraph";
};

type SourceRightsCase = {
  caseId: string;
  storageRights: "ALLOWED" | "REVIEW_REQUIRED" | "PROHIBITED";
  rightsReviewedAt?: string;
  rightsBasis?: string;
  expected: "PASS" | "BLOCK";
};

type SourceVerificationCase = {
  caseId: string;
  lifecycleState: SourceVerificationManifestEnvelope["lifecycleState"];
  verifiedAt: string | null;
  storageRights: SourceVerificationManifestEnvelope["manifest"]["storageRights"];
  rightsReviewed: boolean;
  permissions: Array<"ALLOWED" | "LINK_ONLY" | "UNKNOWN">;
  expected: "PASS" | "BLOCK";
};

type ClaimReviewCase = ClaimEvidenceReadinessInput & {
  caseId: string;
  expected: "PASS" | "BLOCK";
};

type CorpusReleaseCase = CorpusReleaseReadinessInput & {
  caseId: string;
  expected: "PASS" | "BLOCK";
};
type CoverageReviewCase = CoverageReadinessInput & {
  caseId: string;
  expected: "PASS" | "BLOCK";
};
type BaselineReadinessCase = BaselineReadinessInput & {
  caseId: string;
  expectedStage: BaselineWorkflowStage;
};
type ClaimDraftPreflightCase = ClaimDraftBundleReadinessInput
  & ClaimDraftImportReadinessInput
  & ClaimDraftReviewReadinessInput
  & {
    caseId: string;
    expectedBundleErrors: string[];
    expectedImportErrors: string[];
    expectedReviewErrors: string[];
  };
type ReviewQueueCase = ReviewQueueActionInput & {
  caseId: string;
  expectedAction: ReviewQueueNextAction;
};

async function main() {
  const cases = (await readFile(
    path.join(process.cwd(), "evals", "phase2-legal-corpus-cases.jsonl"),
    "utf8",
  ))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CorpusCase);

  const failures = cases.filter((evalCase) => {
    const actual = evaluateClaimPublication(toClaim(evalCase)).publishable
      ? "PUBLISH"
      : "BLOCK";
    if (actual === evalCase.expected) return false;
    console.error(`${evalCase.caseId}: expected=${evalCase.expected} actual=${actual}`);
    return true;
  });

  if (failures.length > 0) {
    throw new Error(`phase2 eval failed: ${failures.length}/${cases.length} cases`);
  }

  const ingestionCases = await readJsonLines<IngestionCase>(
    "evals/phase2-source-ingestion-cases.jsonl",
  );
  const ingestionFailures = ingestionCases.filter((evalCase) => {
    const provisions = extractEurLexArticles(evalCase.html, `version:${evalCase.caseId}`);
    const locators = provisions.map((provision) => provision.locator);
    const passed =
      provisions.length === evalCase.expectedCount &&
      JSON.stringify(locators) === JSON.stringify(evalCase.expectedLocators) &&
      provisions.every((provision) => provision.excerptPermission === "UNKNOWN");
    if (!passed) console.error(`${evalCase.caseId}: unexpected extraction result`);
    return !passed;
  });
  if (ingestionFailures.length > 0) {
    throw new Error(
      `phase2 ingestion eval failed: ${ingestionFailures.length}/${ingestionCases.length} cases`,
    );
  }
  const hkelCases = await readJsonLines<HkelIngestionCase>(
    "evals/phase2-hkel-ingestion-cases.jsonl",
  );
  const hkelFailures = hkelCases.filter((evalCase) => {
    try {
      assertHkelIdentity(evalCase.xml, {
        expectedEmbeddedDocumentId: "656A",
        expectedEmbeddedIdentifier: "/hk/cap656A!en",
        versionLabel: "2025-08-01",
      });
      const locators = extractHkelSections(
        evalCase.xml,
        `version:${evalCase.caseId}`,
      ).map((provision) => provision.locator);
      return evalCase.expectedIdentityError || JSON.stringify(locators) !== JSON.stringify(evalCase.expectedLocators);
    } catch {
      return !evalCase.expectedIdentityError;
    }
  });
  if (hkelFailures.length > 0) {
    throw new Error(`phase2 HKeL eval failed: ${hkelFailures.length}/${hkelCases.length} cases`);
  }
  const ssoCases = await readJsonLines<SsoIngestionCase>(
    "evals/phase2-sso-ingestion-cases.jsonl",
  );
  const ssoFailures = ssoCases.filter((evalCase) => {
    try {
      assertSsoIdentity(evalCase.html, {
        title: evalCase.title ?? "Payment Services Act 2019",
        ssoDocumentNumber: evalCase.documentNumber ?? "PSA2019",
        ssoValidDate: evalCase.validDate ?? "20250309",
      });
      const provisions = extractSsoSections(
        evalCase.html,
        `version:${evalCase.caseId}`,
        "en",
        "ALLOWED",
        evalCase.provisionKind ?? "section",
      );
      const locators = provisions.map((provision) => provision.locator);
      return (
        evalCase.expectedError ||
        evalCase.expectedIdentityError ||
        JSON.stringify(locators) !== JSON.stringify(evalCase.expectedLocators) ||
        provisions.some((provision) => provision.excerptPermission !== "ALLOWED")
      );
    } catch (error) {
      const identityError = error instanceof Error && /identity mismatch/.test(error.message);
      return identityError ? !evalCase.expectedIdentityError : !evalCase.expectedError;
    }
  });
  if (ssoFailures.length > 0) {
    throw new Error(`phase2 SSO eval failed: ${ssoFailures.length}/${ssoCases.length} cases`);
  }
  const rightsCases = await readJsonLines<SourceRightsCase>(
    "evals/phase2-source-rights-cases.jsonl",
  );
  const rightsFailures = rightsCases.filter((evalCase) => {
    try {
      assertSourceStorageRights({
        sourceId: evalCase.caseId,
        storageRights: evalCase.storageRights,
        rightsReviewedAt: evalCase.rightsReviewedAt,
        rightsBasis: evalCase.rightsBasis,
      });
      return evalCase.expected !== "PASS";
    } catch {
      return evalCase.expected !== "BLOCK";
    }
  });
  if (rightsFailures.length > 0) {
    throw new Error(
      `phase2 source-rights eval failed: ${rightsFailures.length}/${rightsCases.length} cases`,
    );
  }
  const verificationCases = await readJsonLines<SourceVerificationCase>(
    "evals/phase2-source-verification-cases.jsonl",
  );
  const verificationFailures = verificationCases.filter((evalCase) => {
    const actual = sourceVerificationReadinessErrors(
      verificationEnvelope(evalCase),
    ).length === 0 ? "PASS" : "BLOCK";
    if (actual === evalCase.expected) return false;
    console.error(`${evalCase.caseId}: expected=${evalCase.expected} actual=${actual}`);
    return true;
  });
  if (verificationFailures.length > 0) {
    throw new Error(
      `phase2 source-verification eval failed: ${verificationFailures.length}/${verificationCases.length} cases`,
    );
  }
  const claimReviewCases = await readJsonLines<ClaimReviewCase>(
    "evals/phase2-claim-review-cases.jsonl",
  );
  const claimReviewFailures = claimReviewCases.filter((evalCase) => {
    const actual = claimEvidenceReadinessErrors(evalCase).length === 0 ? "PASS" : "BLOCK";
    if (actual === evalCase.expected) return false;
    console.error(`${evalCase.caseId}: expected=${evalCase.expected} actual=${actual}`);
    return true;
  });
  if (claimReviewFailures.length > 0) {
    throw new Error(
      `phase2 claim-review eval failed: ${claimReviewFailures.length}/${claimReviewCases.length} cases`,
    );
  }
  const releaseCases = await readJsonLines<CorpusReleaseCase>(
    "evals/phase2-corpus-release-cases.jsonl",
  );
  const releaseFailures = releaseCases.filter((evalCase) => {
    const actual = corpusReleaseReadinessErrors(evalCase).length === 0 ? "PASS" : "BLOCK";
    if (actual === evalCase.expected) return false;
    console.error(`${evalCase.caseId}: expected=${evalCase.expected} actual=${actual}`);
    return true;
  });
  if (releaseFailures.length > 0) {
    throw new Error(
      `phase2 corpus-release eval failed: ${releaseFailures.length}/${releaseCases.length} cases`,
    );
  }
  const coverageCases = await readJsonLines<CoverageReviewCase>(
    "evals/phase2-coverage-review-cases.jsonl",
  );
  const coverageFailures = coverageCases.filter((evalCase) => {
    const actual = coverageReadinessErrors(evalCase).length === 0 ? "PASS" : "BLOCK";
    return actual !== evalCase.expected;
  });
  if (coverageFailures.length > 0) {
    throw new Error(
      `phase2 coverage-review eval failed: ${coverageFailures.length}/${coverageCases.length} cases`,
    );
  }
  const baselineCases = await readJsonLines<BaselineReadinessCase>(
    "evals/phase2-baseline-readiness-cases.jsonl",
  );
  const baselineFailures = baselineCases.filter((evalCase) => {
    const actual = baselineWorkflowStage(evalCase);
    if (actual === evalCase.expectedStage) return false;
    console.error(`${evalCase.caseId}: expected=${evalCase.expectedStage} actual=${actual}`);
    return true;
  });
  if (baselineFailures.length > 0) {
    throw new Error(
      `phase2 baseline-readiness eval failed: ${baselineFailures.length}/${baselineCases.length} cases`,
    );
  }
  const draftPreflightCases = await readJsonLines<ClaimDraftPreflightCase>(
    "evals/phase2-claim-draft-preflight-cases.jsonl",
  );
  const draftPreflightFailures = draftPreflightCases.filter((evalCase) => {
    const bundleErrors = claimDraftBundleErrors(evalCase);
    const importErrors = claimDraftImportErrors(evalCase);
    const reviewErrors = claimDraftReviewReadinessErrors(evalCase);
    const passed = JSON.stringify(bundleErrors) === JSON.stringify(evalCase.expectedBundleErrors)
      && JSON.stringify(importErrors) === JSON.stringify(evalCase.expectedImportErrors)
      && JSON.stringify(reviewErrors) === JSON.stringify(evalCase.expectedReviewErrors);
    if (!passed) console.error(`${evalCase.caseId}: unexpected preflight blockers`);
    return !passed;
  });
  if (draftPreflightFailures.length > 0) {
    throw new Error(
      `phase2 claim-draft-preflight eval failed: ${draftPreflightFailures.length}/${draftPreflightCases.length} cases`,
    );
  }
  const reviewQueueCases = await readJsonLines<ReviewQueueCase>(
    "evals/phase2-review-queue-cases.jsonl",
  );
  const reviewQueueFailures = reviewQueueCases.filter((evalCase) => {
    const actual = reviewQueueNextAction(evalCase);
    if (actual === evalCase.expectedAction) return false;
    console.error(`${evalCase.caseId}: expected=${evalCase.expectedAction} actual=${actual}`);
    return true;
  });
  if (reviewQueueFailures.length > 0) {
    throw new Error(
      `phase2 review-queue eval failed: ${reviewQueueFailures.length}/${reviewQueueCases.length} cases`,
    );
  }
  const total = cases.length + ingestionCases.length + hkelCases.length
    + ssoCases.length + rightsCases.length + verificationCases.length
    + claimReviewCases.length + releaseCases.length + coverageCases.length
    + baselineCases.length + draftPreflightCases.length + reviewQueueCases.length;
  console.log(
    `phase2 eval passed: ${total}/${total} cases`,
  );
}

async function readJsonLines<T>(relativePath: string): Promise<T[]> {
  return (await readFile(path.join(process.cwd(), relativePath), "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

function toClaim(evalCase: CorpusCase): LegalClaim {
  return {
    claimId: `claim:${evalCase.caseId}`,
    jurisdictionCode: "EEA",
    topic: "market-access",
    proposition: "Fixture proposition",
    legalStatus: evalCase.legalStatus,
    reviewState: evalCase.reviewState,
    effectiveFrom: evalCase.effectiveFrom,
    ...(evalCase.effectiveTo ? { effectiveTo: evalCase.effectiveTo } : {}),
    knowledgeCutoff: "2026-07-31T00:00:00.000Z",
    citations: evalCase.citations.map((citation, index) => ({
      citationId: `citation:${evalCase.caseId}:${index}`,
      relation: citation.relation,
      evidence: {
        provisionId: `provision:${evalCase.caseId}:${index}`,
        sourceVersionId: `version:${evalCase.caseId}`,
        authorityId: "authority:fixture",
        locator: citation.locator,
        canonicalUrl: "https://example.gov/legal-text",
        evidenceLayer: citation.evidenceLayer,
        evidenceUse: citation.evidenceUse,
        versionChecksumSha256: "a".repeat(64),
      },
    })),
  };
}

function verificationEnvelope(
  evalCase: SourceVerificationCase,
): SourceVerificationManifestEnvelope {
  return {
    manifestSha256: "a".repeat(64),
    lifecycleState: evalCase.lifecycleState,
    verifiedAt: evalCase.verifiedAt,
    manifest: {
      schemaVersion: "1.0.0",
      versionId: `version:${evalCase.caseId}`,
      documentId: `document:${evalCase.caseId}`,
      versionLabel: "fixture",
      rawObjectId: `object:${evalCase.caseId}`,
      checksumSha256: "b".repeat(64),
      officialUrl: "https://example.gov/legal",
      publishedAt: null,
      effectiveFrom: null,
      effectiveTo: null,
      observedAt: "2026-07-30T00:00:00.000Z",
      retrievedAt: "2026-07-30T00:00:00.000Z",
      storageRights: evalCase.storageRights,
      rightsReviewedAt: evalCase.rightsReviewed ? "2026-07-30T00:00:00.000Z" : null,
      rightsBasis: evalCase.rightsReviewed ? "Reviewed fixture basis" : null,
      redistributionRights: "FULL_TEXT",
      licenceIdentifier: "Fixture licence",
      provisions: evalCase.permissions.map((permission, ordinal) => ({
        provisionId: `provision:${evalCase.caseId}:${ordinal}`,
        locator: `Article ${ordinal + 1}`,
        languageCode: "en",
        textChecksumSha256: "c".repeat(64),
        ordinal,
        effectiveExcerptPermission: permission,
      })),
    },
  };
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
