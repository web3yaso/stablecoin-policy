import { readFile } from "node:fs/promises";
import path from "node:path";
import { evaluateClaimPublication } from "../../lib/legal-corpus/policy";
import { extractEurLexArticles } from "../../lib/legal-corpus/ingestion/eurlex";
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
  console.log(
    `phase2 eval passed: ${cases.length + ingestionCases.length}/${cases.length + ingestionCases.length} cases`,
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

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
