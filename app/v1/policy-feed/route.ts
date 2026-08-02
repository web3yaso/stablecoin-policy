import { NextResponse, type NextRequest } from "next/server";
import playbookMap from "@/config/policy-feed-playbook-map.json";
import { getDatasetService } from "@/lib/data/dataset-runtime";
import type { DatasetSnapshot } from "@/lib/data/dataset-types";
import { respondPolicyFeed } from "@/lib/policy-feed/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET(request: NextRequest) {
  let snapshot: DatasetSnapshot | null;
  try {
    snapshot = await getDatasetService().getActiveDataset("news-summaries");
  } catch (error: unknown) {
    console.error(
      `policy feed source unavailable: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    snapshot = null;
  }

  const result = respondPolicyFeed(
    snapshot,
    playbookMap,
    request.headers.get("if-none-match"),
  );
  const headers = { ...corsHeaders(), ...result.headers };
  if (result.body === null) {
    return new Response(null, { status: result.status, headers });
  }
  return NextResponse.json(result.body, { status: result.status, headers });
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Accept, Content-Type, If-None-Match",
    "Access-Control-Expose-Headers":
      "ETag, Warning, X-Policy-Feed-Schema-Version, X-Data-Generated-At, X-Data-Cache-State, X-Data-Stale",
  };
}
