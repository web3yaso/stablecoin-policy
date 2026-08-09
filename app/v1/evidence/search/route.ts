import { NextResponse, type NextRequest } from "next/server";
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
  const expectedKey = (
    process.env.EVIDENCE_API_KEY || process.env.PLAYBOOK_API_KEY
  )?.trim();
  if (!expectedKey) return problem(503, "evidence-search-unconfigured");
  if ((request.headers.get("authorization") ?? "") !== `Bearer ${expectedKey}`) {
    return problem(401, "unauthorized");
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
