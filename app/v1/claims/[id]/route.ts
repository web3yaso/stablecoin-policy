import { NextResponse, type NextRequest } from "next/server";
import { readSupabaseConfig, SupabaseHttpClient } from "@/lib/data/supabase-client";
import {
  toProvisionalClaimResponse,
  type ProvisionalClaimRow,
} from "@/lib/legal-corpus/provisional-public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CLAIM_ID = /^[a-z0-9][a-z0-9._:-]{2,160}$/;

type RouteContext = { params: Promise<{ id: string }> };

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  if (!CLAIM_ID.test(id)) {
    return NextResponse.json(
      { error: "claim-not-found" },
      { status: 404, headers: corsHeaders() },
    );
  }

  let rows: ProvisionalClaimRow[];
  try {
    const client = new SupabaseHttpClient(readSupabaseConfig());
    rows = await client.rest<ProvisionalClaimRow[]>(
      `public_provisional_claims?claim_id=eq.${encodeURIComponent(id)}&order=published_at.desc&limit=1`,
    );
  } catch (error: unknown) {
    console.error(
      `provisional claim unavailable (${id}): ${error instanceof Error ? error.message : "unknown error"}`,
    );
    return NextResponse.json(
      { error: "provisional-claims-unavailable" },
      { status: 503, headers: { ...corsHeaders(), "Cache-Control": "no-store" } },
    );
  }
  if (rows.length === 0) {
    return NextResponse.json(
      { error: "claim-not-found" },
      { status: 404, headers: corsHeaders() },
    );
  }

  return NextResponse.json(toProvisionalClaimResponse(rows[0]), {
    headers: {
      ...corsHeaders(),
      "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
    },
  });
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Accept, Content-Type",
  };
}
