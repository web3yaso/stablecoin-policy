import usdcEeaDossier from "../../data/dossiers/usdc-eea.json";
import type { StablecoinDossier } from "../dossiers";
import type { ProvisionalClaimRow } from "../legal-corpus/provisional-public";
import {
  OpenAIQueryEmbeddingProvider,
  readOpenAIEmbeddingConfig,
} from "../retrieval/openai-embedding";
import { EvidenceSearchService } from "../retrieval/search";
import { SupabaseEvidenceRetrievalRepository } from "../retrieval/supabase-repository";
import type { SupabaseHttpClient } from "../data/supabase-client";
import type {
  BusinessProfile,
  EvidenceClaim,
  PlaybookDefinition,
  PlaybookPackageArtifact,
} from "./contracts";
import { retrievePlaybookEvidence } from "./retrieval";
import {
  assembleEvidenceBundle,
  evaluatePlaybook,
  sealPlaybookPackage,
  type EvaluationEvidence,
} from "./runtime";

const MAX_EVIDENCE_AGE_DAYS = 90;

export async function evaluatePlaybookArtifact(input: {
  client: SupabaseHttpClient;
  definition: PlaybookDefinition;
  profile: BusinessProfile;
}): Promise<PlaybookPackageArtifact> {
  const { client, definition, profile } = input;
  const rows = await client.rest<ProvisionalClaimRow[]>(
    "public_provisional_claims?jurisdiction_code=eq.EEA&order=claim_id.asc",
  );
  const evidence: EvaluationEvidence = {
    claims: rows.map(toEvidenceClaim),
    dossier:
      profile.asset?.symbol === "USDC"
        ? (usdcEeaDossier as StablecoinDossier)
        : null,
    now: new Date().toISOString(),
    maxEvidenceAgeDays: MAX_EVIDENCE_AGE_DAYS,
  };

  const conclusions = evaluatePlaybook(definition, profile, evidence);
  let retrievalService: EvidenceSearchService | null = null;
  try {
    retrievalService = new EvidenceSearchService(
      new SupabaseEvidenceRetrievalRepository(client),
      new OpenAIQueryEmbeddingProvider(readOpenAIEmbeddingConfig()),
    );
  } catch {
    // Retrieval is optional evidence. Configuration failure is represented in
    // the bundle and can never alter deterministic decisions.
  }
  const retrieval = await retrievePlaybookEvidence(
    retrievalService,
    definition,
    conclusions,
    evidence,
  );
  const playbookPackage = sealPlaybookPackage(
    definition,
    profile,
    conclusions,
    evidence,
    retrieval,
  );
  return {
    package: playbookPackage,
    evidenceBundle: assembleEvidenceBundle(playbookPackage, evidence, retrieval),
  };
}

function toEvidenceClaim(row: ProvisionalClaimRow): EvidenceClaim {
  return {
    claimId: row.claim_id,
    topic: row.topic,
    legalStatus: row.legal_status,
    proposition: row.proposition,
    citations: row.citations,
    releaseId: row.release_id,
    asOf: row.as_of,
    knowledgeCutoff: row.knowledge_cutoff,
    confidence: row.confidence,
    limitations: row.limitations,
  };
}
