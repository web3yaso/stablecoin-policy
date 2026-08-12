import { NextResponse, type NextRequest } from "next/server";
import {
  authenticateCitelyService,
  CitelyServiceAuthConfigurationError,
  isCitelyEntitled,
} from "@/lib/auth/citely-service";
import { readSupabaseConfig, SupabaseHttpClient } from "@/lib/data/supabase-client";
import {
  OpenAIQueryEmbeddingProvider,
  readOpenAIEmbeddingConfig,
} from "@/lib/retrieval/openai-embedding";
import { parseEvidenceSearchRequest } from "@/lib/retrieval/request";
import { respondEvidenceSearch } from "@/lib/retrieval/respond";
import { EvidenceSearchService } from "@/lib/retrieval/search";
import { SupabaseEvidenceRetrievalRepository } from "@/lib/retrieval/supabase-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function POST(request: NextRequest) {
  let principal;
  try {
    principal = await authenticateCitelyService({
      authorization: request.headers.get("authorization"),
      legacySecret: process.env.EVIDENCE_API_KEY || process.env.PLAYBOOK_API_KEY,
    });
  } catch (error: unknown) {
    return error instanceof CitelyServiceAuthConfigurationError
      ? problem(503, "evidence-service-auth-unconfigured")
      : problem(401, "unauthorized");
  }
  if (!isCitelyEntitled(principal, { scope: "evidence:search" })) {
    return problem(403, "entitlement-denied");
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return problem(400, "invalid-json");
  }
  const input = parseEvidenceSearchRequest(raw);
  if (input === null) return problem(400, "invalid-evidence-search-request");

  try {
    const repository = new SupabaseEvidenceRetrievalRepository(
      new SupabaseHttpClient(readSupabaseConfig()),
    );
    const embeddings = new OpenAIQueryEmbeddingProvider(
      readOpenAIEmbeddingConfig(),
    );
    const result = await respondEvidenceSearch(
      new EvidenceSearchService(repository, embeddings),
      input,
    );
    return NextResponse.json(result.body, {
      status: result.status,
      headers: { ...corsHeaders(), ...result.headers },
    });
  } catch (error: unknown) {
    console.error(
      `evidence search unavailable: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    return problem(503, "evidence-search-unavailable");
  }
}

function problem(status: number, error: string) {
  return NextResponse.json(
    { error },
    { status, headers: { ...corsHeaders(), "Cache-Control": "no-store" } },
  );
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Accept, Content-Type, Authorization",
  };
}
