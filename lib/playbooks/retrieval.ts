import { createHash } from "node:crypto";
import type {
  EvidenceSearchRequest,
  EvidenceSearchResponse,
} from "../retrieval/contracts";
import type { EvidenceSearchService } from "../retrieval/search";
import type {
  CapabilityResult,
  PlaybookDefinition,
} from "./contracts";
import type { EvaluationEvidence } from "./runtime";

type PlaybookEvidenceSearch = Pick<EvidenceSearchService, "search">;

export function buildPlaybookRetrievalRequest(
  definition: PlaybookDefinition,
  conclusions: CapabilityResult[],
  evidence: EvaluationEvidence,
): EvidenceSearchRequest | null {
  const selectedCapabilities = new Set(
    conclusions.map((result) => result.capabilityId),
  );
  const topics = [...new Set(definition.capabilities
    .filter((capability) => selectedCapabilities.has(capability.capabilityId))
    .flatMap((capability) => [
      ...capability.requirementTopics,
      ...capability.prohibitionTopics,
    ]))].sort();
  const referencedClaims = new Set(
    conclusions.flatMap((result) => result.evidenceClaimIds),
  );
  const propositions = evidence.claims
    .filter((claim) => referencedClaims.has(claim.claimId))
    .map((claim) => claim.proposition.trim())
    .filter(Boolean)
    .sort();
  const query = [...topics, ...propositions].join("\n").slice(0, 2_000).trim();
  if (!query) return null;
  return {
    query,
    filters: {
      jurisdictionCodes: ["EEA"],
      topics,
      asOf: new Date(evidence.now).toISOString(),
      sourceTypes: ["REGULATION"],
      assuranceTier: "PROVISIONAL",
      corpusReleaseId: null,
      indexReleaseId: null,
    },
    topK: 10,
  };
}

export async function retrievePlaybookEvidence(
  service: PlaybookEvidenceSearch | null,
  definition: PlaybookDefinition,
  conclusions: CapabilityResult[],
  evidence: EvaluationEvidence,
): Promise<EvidenceSearchResponse> {
  const request = buildPlaybookRetrievalRequest(definition, conclusions, evidence);
  if (request === null) {
    return unavailableResponse(
      null,
      "No deterministic claim evidence was referenced; retrieval was not run.",
      "INSUFFICIENT_EVIDENCE",
    );
  }
  if (service === null) {
    return unavailableResponse(
      request.query,
      "Evidence retrieval is not configured; deterministic conclusions remain unchanged.",
      "RETRIEVAL_UNAVAILABLE",
    );
  }
  try {
    return await service.search(request);
  } catch {
    return unavailableResponse(
      request.query,
      "Evidence retrieval is unavailable; deterministic conclusions remain unchanged.",
      "RETRIEVAL_UNAVAILABLE",
    );
  }
}

function unavailableResponse(
  query: string | null,
  limitation: string,
  status: "INSUFFICIENT_EVIDENCE" | "RETRIEVAL_UNAVAILABLE",
): EvidenceSearchResponse {
  const querySha256 = query === null ? "0".repeat(64) : sha256(query);
  return {
    schemaVersion: "1.0.0",
    runId: `rag-run:${querySha256.slice(0, 16)}:0000000000000000`,
    status,
    querySha256,
    indexRelease: null,
    hits: [],
    limitations: [limitation],
    explanation: null,
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
