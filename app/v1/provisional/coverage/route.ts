import { NextResponse } from "next/server";
import { readSupabaseConfig, SupabaseHttpClient } from "@/lib/data/supabase-client";
import {
  toProvisionalCoverageResponse,
  type ProvisionalCoverageRow,
} from "@/lib/legal-corpus/provisional-public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET() {
  try {
    const client = new SupabaseHttpClient(readSupabaseConfig());
    const rows = await client.rest<ProvisionalCoverageRow[]>(
      "public_provisional_coverage?order=jurisdiction_code.asc",
    );
    return NextResponse.json(toProvisionalCoverageResponse(rows), {
      headers: {
        ...corsHeaders(),
        "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
      },
    });
  } catch (error: unknown) {
    console.error(
      `provisional coverage unavailable: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    return NextResponse.json(
      { error: "provisional-coverage-unavailable" },
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
