import { NextResponse, type NextRequest } from "next/server";
import { readSupabaseConfig, SupabaseHttpClient } from "@/lib/data/supabase-client";
import { loadDossierFile } from "@/lib/dossiers";
import type { ProvisionalClaimRow } from "@/lib/legal-corpus/provisional-public";
import type { BusinessProfile, EvidenceClaim } from "@/lib/playbooks/contracts";
import { MVP_PLAYBOOKS } from "@/lib/playbooks/definitions";
import {
  parseIdempotencyKey,
  PlaybookIdempotencyConflictError,
  PlaybookPackageArtifactStore,
  playbookRequestFingerprint,
} from "@/lib/playbooks/artifacts";
import {
  assembleEvidenceBundle,
  evaluatePlaybook,
  sealPlaybookPackage,
  type EvaluationEvidence,
} from "@/lib/playbooks/runtime";
import { retrievePlaybookEvidence } from "@/lib/playbooks/retrieval";
import {
  OpenAIQueryEmbeddingProvider,
  readOpenAIEmbeddingConfig,
} from "@/lib/retrieval/openai-embedding";
import { EvidenceSearchService } from "@/lib/retrieval/search";
import { SupabaseEvidenceRetrievalRepository } from "@/lib/retrieval/supabase-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_EVIDENCE_AGE_DAYS = 90;

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

/**
 * Creates a PlaybookPackage + EvidenceBundle from the live provisional
 * corpus and the committed mini-dossier. Authentication is a shared service
 * key (PLAYBOOK_API_KEY) as an explicit MVP interim until the Citely
 * service-auth format is finalized. Packages are deterministic, persisted as
 * immutable private artifacts, and retry-safe through a hashed idempotency
 * key. Raw customer profiles and raw idempotency keys are not stored.
 */
export async function POST(request: NextRequest) {
  const expectedKey = process.env.PLAYBOOK_API_KEY?.trim();
  if (!expectedKey) {
    return problem(503, "playbook-runtime-unconfigured");
  }
  const authorization = request.headers.get("authorization") ?? "";
  if (authorization !== `Bearer ${expectedKey}`) {
    return problem(401, "unauthorized");
  }
  const idempotencyKey = parseIdempotencyKey(
    request.headers.get("idempotency-key"),
  );
  if (idempotencyKey === null) {
    return problem(400, "invalid-idempotency-key");
  }

  let body: { playbookId?: unknown; profile?: unknown };
  try {
    body = await request.json();
  } catch {
    return problem(400, "invalid-json");
  }
  const definition = MVP_PLAYBOOKS.find(
    (playbook) => playbook.playbookId === body.playbookId,
  );
  if (!definition) return problem(404, "playbook-not-found");
  const profile = parseProfile(body.profile);
  if (profile === null) return problem(400, "invalid-profile");

  let client: SupabaseHttpClient;
  let artifacts: PlaybookPackageArtifactStore;
  try {
    client = new SupabaseHttpClient(readSupabaseConfig());
    artifacts = new PlaybookPackageArtifactStore(client);
  } catch (error: unknown) {
    console.error(
      `playbook persistence unavailable: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    return problem(503, "playbook-persistence-unavailable");
  }

  const requestFingerprint = playbookRequestFingerprint({
    playbookId: definition.playbookId,
    profile,
  });
  try {
    const claim = await artifacts.claimIdempotencyKey(
      idempotencyKey,
      requestFingerprint,
    );
    if (claim.status === "COMPLETED") {
      return NextResponse.json(claim.artifact, {
        status: 200,
        headers: {
          ...corsHeaders(),
          "Cache-Control": "no-store",
          "Idempotency-Replayed": "true",
        },
      });
    }
    if (claim.status === "PENDING") {
      const retryAfter = Math.max(
        1,
        Math.ceil((Date.parse(claim.retryAfter) - Date.now()) / 1_000),
      );
      return problem(409, "idempotency-request-in-progress", {
        "Retry-After": String(retryAfter),
      });
    }
  } catch (error: unknown) {
    if (error instanceof PlaybookIdempotencyConflictError) {
      return problem(409, "idempotency-key-conflict");
    }
    console.error(
      `playbook idempotency unavailable: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    return problem(503, "playbook-persistence-unavailable");
  }

  let evidence: EvaluationEvidence;
  try {
    const rows = await client.rest<ProvisionalClaimRow[]>(
      "public_provisional_claims?jurisdiction_code=eq.EEA&order=claim_id.asc",
    );
    evidence = {
      claims: rows.map(toEvidenceClaim),
      dossier:
        profile.asset?.symbol === "USDC"
          ? await loadDossierFile("data/dossiers/usdc-eea.json")
          : null,
      now: new Date().toISOString(),
      maxEvidenceAgeDays: MAX_EVIDENCE_AGE_DAYS,
    };
  } catch (error: unknown) {
    console.error(
      `playbook evidence unavailable: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    return problem(503, "evidence-unavailable");
  }

  const conclusions = evaluatePlaybook(definition, profile, evidence);
  let retrievalService: EvidenceSearchService | null = null;
  try {
    retrievalService = new EvidenceSearchService(
      new SupabaseEvidenceRetrievalRepository(client),
      new OpenAIQueryEmbeddingProvider(readOpenAIEmbeddingConfig()),
    );
  } catch {
    // Retrieval is an optional evidence layer. Configuration failure is
    // represented inside EvidenceBundle and cannot fail or alter decisions.
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
  const evidenceBundle = assembleEvidenceBundle(
    playbookPackage,
    evidence,
    retrieval,
  );

  const artifact = { package: playbookPackage, evidenceBundle };
  try {
    await artifacts.persist(artifact, idempotencyKey, requestFingerprint);
  } catch (error: unknown) {
    if (error instanceof PlaybookIdempotencyConflictError) {
      return problem(409, "idempotency-key-conflict");
    }
    console.error(
      `playbook package persistence failed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    return problem(503, "playbook-persistence-unavailable");
  }

  return NextResponse.json(
    artifact,
    { status: 201, headers: { ...corsHeaders(), "Cache-Control": "no-store" } },
  );
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

function parseProfile(input: unknown): BusinessProfile | null {
  if (typeof input !== "object" || input === null) return null;
  const candidate = input as Record<string, unknown>;
  if (
    typeof candidate.operatorJurisdiction !== "string" ||
    candidate.targetJurisdiction !== "EEA" ||
    !Array.isArray(candidate.activities) ||
    candidate.activities.length === 0 ||
    !candidate.activities.every((activity) => typeof activity === "string")
  ) {
    return null;
  }
  let asset: BusinessProfile["asset"] = null;
  if (candidate.asset !== null && candidate.asset !== undefined) {
    const rawAsset = candidate.asset as Record<string, unknown>;
    if (
      typeof rawAsset.symbol !== "string" ||
      !Array.isArray(rawAsset.networks) ||
      !rawAsset.networks.every((network) => typeof network === "string")
    ) {
      return null;
    }
    asset = { symbol: rawAsset.symbol, networks: rawAsset.networks as string[] };
  }
  return {
    operatorJurisdiction: candidate.operatorJurisdiction,
    targetJurisdiction: "EEA",
    activities: candidate.activities as string[],
    asset,
  };
}

function problem(
  status: number,
  error: string,
  headers: Record<string, string> = {},
) {
  return NextResponse.json(
    { error },
    {
      status,
      headers: { ...corsHeaders(), "Cache-Control": "no-store", ...headers },
    },
  );
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Accept, Content-Type, Authorization, Idempotency-Key",
    "Access-Control-Expose-Headers": "Idempotency-Replayed, Retry-After",
  };
}
