import { NextResponse, type NextRequest } from "next/server";
import { getDatasetService } from "@/lib/data/dataset-runtime";
import {
  isPublicDatasetId,
  type DatasetSnapshot,
} from "@/lib/data/dataset-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ datasetId: string }> };

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { datasetId } = await context.params;
  if (!isPublicDatasetId(datasetId)) {
    return NextResponse.json(
      { error: "dataset-not-found" },
      { status: 404, headers: corsHeaders() },
    );
  }

  let snapshot: DatasetSnapshot | null;
  try {
    snapshot = await getDatasetService().getActiveDataset(datasetId);
  } catch (error: unknown) {
    console.error(
      `public dataset unavailable (${datasetId}): ${error instanceof Error ? error.message : "unknown error"}`,
    );
    return NextResponse.json(
      { error: "dataset-unavailable" },
      {
        status: 503,
        headers: { ...corsHeaders(), "Cache-Control": "no-store" },
      },
    );
  }
  if (!snapshot) {
    return NextResponse.json(
      { error: "dataset-not-found" },
      { status: 404, headers: corsHeaders() },
    );
  }

  const etag = `"sha256-${snapshot.release.checksumSha256}"`;
  const headers: Record<string, string> = {
    ...corsHeaders(),
    "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
    ETag: etag,
    "X-Dataset-Release": snapshot.release.releaseId,
    "X-Data-Generated-At": snapshot.release.generatedAt,
    "X-Data-Cache-State": snapshot.cacheState,
  };
  if (snapshot.cacheState === "stale-cache") {
    headers.Warning = '110 - "Response is stale"';
    headers["X-Data-Stale"] = "true";
  }

  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers });
  }

  return NextResponse.json(snapshot.data, { headers });
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Accept, Content-Type, If-None-Match",
    "Access-Control-Expose-Headers":
      "ETag, Warning, X-Dataset-Release, X-Data-Generated-At, X-Data-Cache-State, X-Data-Stale",
  };
}
