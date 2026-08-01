import { NextResponse } from "next/server";
import { getPublicLegalCorpusRepository } from "@/lib/legal-corpus/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET() {
  try {
    const response = await getPublicLegalCorpusRepository().getCoverage();
    return NextResponse.json(response, {
      headers: {
        ...corsHeaders(),
        "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
      },
    });
  } catch (error: unknown) {
    console.error(
      `legal corpus coverage unavailable: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    return NextResponse.json(
      { error: "legal-corpus-unavailable" },
      { status: 503, headers: { ...corsHeaders(), "Cache-Control": "no-store" } },
    );
  }
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Accept, Content-Type",
  };
}

