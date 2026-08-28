import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadDossierFile } from "../../lib/dossiers";
import type {
  BusinessProfile,
  EvidenceClaim,
  PlaybookPackageArtifact,
} from "../../lib/playbooks/contracts";
import {
  businessModelBoundaryPlaybook,
  preListingPlaybook,
} from "../../lib/playbooks/definitions";
import {
  assembleEvidenceBundle,
  evaluatePlaybook,
  sealPlaybookPackage,
  type EvaluationEvidence,
} from "../../lib/playbooks/runtime";
import type { EvidenceSearchResponse } from "../../lib/retrieval/contracts";

const FIXTURE_DIRECTORY = path.join(
  process.cwd(),
  "contracts",
  "fixtures",
  "citely",
  "v1",
);
const NOW = "2026-08-12T12:00:00.000Z";
const RELEASE_ID = "provisional:eea:mica:2026-08-02";

export type CreateRequest = {
  playbookId:
    | "stablecoin-pre-listing"
    | "business-model-regulatory-boundary";
  profile: BusinessProfile;
};

export type ConsumerFixture = {
  slug: string;
  request: CreateRequest;
  response: PlaybookPackageArtifact;
};

function claim(
  claimId: string,
  topic: string,
  legalStatus: "REQUIREMENT" | "PROHIBITION" = "REQUIREMENT",
): EvidenceClaim {
  return {
    claimId,
    topic,
    legalStatus,
    proposition: `Sanitized fixture proposition for ${topic}.`,
    citations: [
      {
        provisionId: `provision:eea:mica:${topic}`,
        locator: legalStatus === "PROHIBITION" ? "Article 50" : "Article 59",
      },
    ],
    releaseId: RELEASE_ID,
    asOf: "2026-08-02T00:00:00.000Z",
    knowledgeCutoff: "2026-08-01T00:00:00.000Z",
    confidence: 0.94,
    limitations: [
      "Machine-assured fixture evidence; not human-reviewed legal advice.",
    ],
  };
}

function claims(): EvidenceClaim[] {
  return [
    claim(
      "claim:eea:mica:e-money-token-authorisation:18",
      "e-money-token-authorisation",
    ),
    claim(
      "claim:eea:mica:e-money-token-interest:50",
      "e-money-token-interest",
      "PROHIBITION",
    ),
    claim(
      "claim:eea:mica:crypto-asset-service-provider-authorisation:59",
      "crypto-asset-service-provider-authorisation",
    ),
    claim(
      "claim:eea:mica:custody-client-assets:75",
      "custody-client-assets",
    ),
    claim(
      "claim:eea:mica:casp-client-asset-safeguarding:70",
      "casp-client-asset-safeguarding",
    ),
    claim(
      "claim:eea:mica:trading-platform-proprietary-trading:76",
      "trading-platform-proprietary-trading",
    ),
  ];
}

function successfulRetrieval(): EvidenceSearchResponse {
  return {
    schemaVersion: "1.0.0",
    runId: "rag-run:citely-consumer-fixture:success",
    status: "SUCCESS",
    querySha256: "1".repeat(64),
    indexRelease: {
      indexReleaseId: "rag-index:eea:provisional:consumer-fixture",
      corpusReleaseId: RELEASE_ID,
      assuranceTier: "PROVISIONAL",
      asOf: "2026-08-02T00:00:00.000Z",
      knowledgeCutoff: "2026-08-01T00:00:00.000Z",
      generatedAt: NOW,
      freshThrough: NOW,
      embeddingModel: "fixture-embedding",
      embeddingModelVersion: "1",
      embeddingDimensions: 3,
      lexicalConfigVersion: "1",
      vectorConfigVersion: "1",
    },
    hits: [
      {
        rank: 1,
        score: 0.98,
        lexicalRank: 1,
        vectorRank: 1,
        chunkId: "chunk:eea:mica:article-59:consumer-fixture",
        claim: {
          claimId:
            "claim:eea:mica:crypto-asset-service-provider-authorisation:59",
          topic: "crypto-asset-service-provider-authorisation",
          legalStatus: "REQUIREMENT",
          proposition: "A CASP authorization requirement applies.",
          supportRelation: "DIRECT_SUPPORT",
        },
        citation: {
          citationId: "citation:eea:mica:article-59:consumer-fixture",
          provisionId: "provision:eea:mica:article-59",
          sourceVersionId: "source-version:eea:mica:2026-08-01",
          sourceVersionChecksumSha256: "2".repeat(64),
          sourceDocumentId: "document:eea:mica",
          documentTitle: "Markets in Crypto-Assets Regulation",
          sourceType: "REGULATION",
          authorityId: "authority:eu",
          authorityName: "European Union",
          locator: "Article 59",
          canonicalUrl: "https://eur-lex.europa.eu/eli/reg/2023/1114/oj",
          excerpt: "Sanitized excerpt permitted for consumer-fixture rendering.",
          excerptPermission: "ALLOWED",
          sourcePublishedAt: "2023-06-09T00:00:00.000Z",
          sourceRetrievedAt: "2026-08-01T00:00:00.000Z",
        },
        jurisdictionCode: "EEA",
        effectiveFrom: "2024-12-30T00:00:00.000Z",
        effectiveTo: null,
        assuranceTier: "PROVISIONAL",
        reviewStatus: "PROVISIONAL",
      },
    ],
    limitations: [
      "Machine-assured retrieval fixture; not human-reviewed legal advice.",
    ],
    explanation: null,
  };
}

function unavailableRetrieval(): EvidenceSearchResponse {
  return {
    schemaVersion: "1.0.0",
    runId: "rag-run:citely-consumer-fixture:unavailable",
    status: "RETRIEVAL_UNAVAILABLE",
    querySha256: "0".repeat(64),
    indexRelease: null,
    hits: [],
    limitations: [
      "Retrieval is unavailable; deterministic conclusions remain unchanged.",
    ],
    explanation: null,
  };
}

export async function buildCitelyConsumerFixtures(): Promise<ConsumerFixture[]> {
  const allClaims = claims();
  const dossier = await loadDossierFile("data/dossiers/usdc-eea.json");
  const preListingProfile: BusinessProfile = {
    operatorJurisdiction: "SG",
    targetJurisdiction: "EEA",
    activities: ["list-for-trading", "custody-for-clients"],
    asset: { symbol: "USDC", networks: ["base", "ethereum"] },
  };
  const boundaryProfile: BusinessProfile = {
    operatorJurisdiction: "SG",
    targetJurisdiction: "EEA",
    activities: ["issue-emt", "pay-emt-interest"],
    asset: null,
  };
  const preListingEvidence: EvaluationEvidence = {
    claims: allClaims,
    dossier,
    now: NOW,
    maxEvidenceAgeDays: 90,
  };
  const boundaryEvidence: EvaluationEvidence = {
    claims: allClaims,
    dossier: null,
    now: NOW,
    maxEvidenceAgeDays: 90,
  };
  return [
    buildFixture(
      "stablecoin-pre-listing-success",
      preListingPlaybook,
      preListingProfile,
      preListingEvidence,
      successfulRetrieval(),
    ),
    buildFixture(
      "business-model-boundary-retrieval-unavailable",
      businessModelBoundaryPlaybook,
      boundaryProfile,
      boundaryEvidence,
      unavailableRetrieval(),
    ),
  ];
}

function buildFixture(
  slug: string,
  definition:
    | typeof preListingPlaybook
    | typeof businessModelBoundaryPlaybook,
  profile: BusinessProfile,
  evidence: EvaluationEvidence,
  retrieval: EvidenceSearchResponse,
): ConsumerFixture {
  const conclusions = evaluatePlaybook(definition, profile, evidence);
  const pkg = sealPlaybookPackage(
    definition,
    profile,
    conclusions,
    evidence,
    retrieval,
  );
  return {
    slug,
    request: {
      playbookId: definition.playbookId as CreateRequest["playbookId"],
      profile,
    },
    response: {
      package: pkg,
      evidenceBundle: assembleEvidenceBundle(pkg, evidence, retrieval),
    },
  };
}

export function serializeCitelyConsumerFixture(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function run(): Promise<void> {
  const write = process.argv.includes("--write");
  const fixtures = await buildCitelyConsumerFixtures();
  if (write) await mkdir(FIXTURE_DIRECTORY, { recursive: true });
  const stale: string[] = [];
  for (const fixture of fixtures) {
    for (const [suffix, value] of [
      ["request", fixture.request],
      ["response", fixture.response],
    ] as const) {
      const file = path.join(
        FIXTURE_DIRECTORY,
        `${fixture.slug}.${suffix}.json`,
      );
      const expected = serializeCitelyConsumerFixture(value);
      if (write) {
        await writeFile(file, expected, "utf8");
        continue;
      }
      let actual: string;
      try {
        actual = await readFile(file, "utf8");
      } catch {
        stale.push(path.relative(process.cwd(), file));
        continue;
      }
      if (actual !== expected) stale.push(path.relative(process.cwd(), file));
    }
  }
  if (stale.length > 0) {
    throw new Error(
      `Citely consumer fixtures are missing or stale: ${stale.join(", ")}. Run npm run contracts:citely:fixtures:write.`,
    );
  }
  console.log(`Citely consumer fixtures verified: ${fixtures.length} scenarios`);
}

if (process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  void run().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
