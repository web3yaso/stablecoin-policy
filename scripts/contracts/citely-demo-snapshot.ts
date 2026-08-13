import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadDossierFile } from "../../lib/dossiers";
import type {
  BusinessProfile,
  EvidenceClaim,
  PlaybookPackageArtifact,
} from "../../lib/playbooks/contracts";
import { preListingPlaybook } from "../../lib/playbooks/definitions";
import {
  assembleEvidenceBundle,
  evaluatePlaybook,
  sealPlaybookPackage,
  type EvaluationEvidence,
} from "../../lib/playbooks/runtime";

const SOURCE_BASE_URL = "https://policy.citely.info";
const GENERATED_AT = "2026-08-13T04:10:00.000Z";
const DEMO_DIRECTORY = path.join(
  process.cwd(),
  "contracts",
  "demos",
  "citely",
  "v1",
);
const CLAIM_IDS = [
  "claim:eea:mica:crypto-asset-service-provider-authorisation:21",
  "claim:eea:mica:custody-client-assets:28",
  "claim:eea:mica:casp-client-asset-safeguarding:25",
  "claim:eea:mica:trading-platform-proprietary-trading:29",
] as const;

type PublicClaimResponse = {
  schemaVersion: string;
  claim: {
    claimId: string;
    topic: string;
    proposition: string;
    legalStatus: string;
  };
  releaseId: string;
  confidence: number | null;
  asOf: string;
  knowledgeCutoff: string;
  citations: Array<{ provisionId: string; locator: string }>;
  limitations: string[];
};

const request = {
  playbookId: "stablecoin-pre-listing",
  profile: {
    operatorJurisdiction: "SG",
    targetJurisdiction: "EEA",
    activities: ["list-for-trading", "custody-for-clients"],
    asset: { symbol: "USDC", networks: ["base", "ethereum"] },
  } satisfies BusinessProfile,
};

async function fetchClaim(claimId: string): Promise<EvidenceClaim> {
  const url = new URL(`/v1/claims/${claimId}`, SOURCE_BASE_URL);
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`public claim ${claimId} returned HTTP ${response.status}`);
  }
  const value: unknown = await response.json();
  if (!isPublicClaimResponse(value) || value.claim.claimId !== claimId) {
    throw new Error(`public claim ${claimId} has an invalid response`);
  }
  return {
    claimId: value.claim.claimId,
    topic: value.claim.topic,
    legalStatus: value.claim.legalStatus,
    proposition: value.claim.proposition,
    citations: value.citations,
    releaseId: value.releaseId,
    asOf: value.asOf,
    knowledgeCutoff: value.knowledgeCutoff,
    confidence: value.confidence,
    limitations: value.limitations,
  };
}

function isPublicClaimResponse(value: unknown): value is PublicClaimResponse {
  if (!isRecord(value) || value.schemaVersion !== "1.0.0") return false;
  const claim = value.claim;
  return isRecord(claim)
    && typeof claim.claimId === "string"
    && typeof claim.topic === "string"
    && typeof claim.proposition === "string"
    && typeof claim.legalStatus === "string"
    && typeof value.releaseId === "string"
    && (typeof value.confidence === "number" || value.confidence === null)
    && typeof value.asOf === "string"
    && typeof value.knowledgeCutoff === "string"
    && Array.isArray(value.citations)
    && value.citations.every(
      (citation) => isRecord(citation)
        && typeof citation.provisionId === "string"
        && typeof citation.locator === "string",
    )
    && Array.isArray(value.limitations)
    && value.limitations.every((limitation) => typeof limitation === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function buildArtifact(): Promise<PlaybookPackageArtifact> {
  const [claims, dossier] = await Promise.all([
    Promise.all(CLAIM_IDS.map(fetchClaim)),
    loadDossierFile("data/dossiers/usdc-eea.json"),
  ]);
  const evidence: EvaluationEvidence = {
    claims,
    dossier,
    now: GENERATED_AT,
    maxEvidenceAgeDays: 90,
  };
  const conclusions = evaluatePlaybook(
    preListingPlaybook,
    request.profile,
    evidence,
  );
  const pkg = sealPlaybookPackage(
    preListingPlaybook,
    request.profile,
    conclusions,
    evidence,
    null,
  );
  return {
    package: pkg,
    evidenceBundle: assembleEvidenceBundle(pkg, evidence, null),
  };
}

function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function run(): Promise<void> {
  const write = process.argv.includes("--write");
  const response = await buildArtifact();
  const manifest = {
    schemaVersion: "1.0.0",
    kind: "STATIC_DEMO_SNAPSHOT",
    generatedAt: GENERATED_AT,
    sourceBaseUrl: SOURCE_BASE_URL,
    productionClaimUrls: CLAIM_IDS.map(
      (claimId) => `${SOURCE_BASE_URL}/v1/claims/${claimId}`,
    ),
    retrievalMode: "RETRIEVAL_UNAVAILABLE",
    limitations: [
      "This is a fixed demonstration snapshot and does not refresh automatically.",
      "Evidence is provisional and machine-assured; this is regulatory research, not legal advice.",
      "Evidence RAG was not run; deterministic conclusions and direct legal claims remain available.",
      "The demonstration does not persist customer input or create a production package record.",
    ],
  };
  const outputs = [
    ["stablecoin-pre-listing.demo.request.json", request],
    ["stablecoin-pre-listing.demo.response.json", response],
    ["stablecoin-pre-listing.demo.manifest.json", manifest],
  ] as const;
  if (write) await mkdir(DEMO_DIRECTORY, { recursive: true });
  const stale: string[] = [];
  for (const [file, value] of outputs) {
    const outputPath = path.join(DEMO_DIRECTORY, file);
    const expected = serialize(value);
    if (write) {
      await writeFile(outputPath, expected, "utf8");
      continue;
    }
    try {
      if (await readFile(outputPath, "utf8") !== expected) stale.push(file);
    } catch {
      stale.push(file);
    }
  }
  if (stale.length > 0) {
    throw new Error(
      `Citely demo snapshot is missing or stale: ${stale.join(", ")}. `
      + "Run npm run contracts:citely:demo:write.",
    );
  }
  console.log(`Citely demo snapshot ${write ? "written" : "verified"}: ${response.package.packageId}`);
}

void run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
