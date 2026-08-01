import { NextResponse } from "next/server";
import { getPublicLegalCorpusRepository } from "@/lib/legal-corpus/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!/^[a-z0-9][a-z0-9._:-]{2,160}$/.test(id)) {
    return NextResponse.json(
      { error: "source-not-found" },
      { status: 404, headers: corsHeaders() },
    );
  }

  try {
    const source = await getPublicLegalCorpusRepository().findSource(id);
    if (!source) {
      return NextResponse.json(
        { error: "source-not-found" },
        { status: 404, headers: corsHeaders() },
      );
    }
    const etag = `"corpus-${source.corpusReleaseId}"`;
    const headers = {
      ...corsHeaders(),
      "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
      ETag: etag,
    };
    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304, headers });
    }
    return NextResponse.json(source, {
      headers: {
        ...headers,
      },
    });
  } catch (error: unknown) {
    console.error(
      `legal source unavailable (${id}): ${error instanceof Error ? error.message : "unknown error"}`,
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
    "Access-Control-Allow-Headers": "Accept, Content-Type, If-None-Match",
    "Access-Control-Expose-Headers": "ETag",
  };
}
