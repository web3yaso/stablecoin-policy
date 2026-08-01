import { NextResponse, type NextRequest } from "next/server";
import { getPublicLegalCorpusRepository } from "@/lib/legal-corpus/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET(request: NextRequest) {
  const cursor = request.nextUrl.searchParams.get("after_cursor") ?? undefined;
  try {
    const response = await getPublicLegalCorpusRepository().listChanges(cursor);
    return NextResponse.json(response, {
      headers: {
        ...corsHeaders(),
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
      },
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "after_cursor is invalid") {
      return NextResponse.json(
        { error: "invalid-after-cursor" },
        { status: 400, headers: { ...corsHeaders(), "Cache-Control": "no-store" } },
      );
    }
    console.error(
      `regulatory changes unavailable: ${error instanceof Error ? error.message : "unknown error"}`,
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
