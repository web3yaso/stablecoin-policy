import { NextResponse, type NextRequest } from "next/server";
import {
  authenticateCitelyService,
  CitelyServiceAuthConfigurationError,
  isCitelyEntitled,
} from "@/lib/auth/citely-service";
import { readSupabaseConfig, SupabaseHttpClient } from "@/lib/data/supabase-client";
import { PlaybookPackageWatchlistStore } from "@/lib/monitoring/package-watchlists";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PACKAGE_ID = /^package:[a-z0-9-]+:[0-9a-f]{16}$/;

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  let principal;
  try {
    principal = await authenticateCitelyService({
      authorization: request.headers.get("authorization"),
      legacySecret: process.env.PLAYBOOK_API_KEY,
    });
  } catch (error: unknown) {
    return error instanceof CitelyServiceAuthConfigurationError
      ? problem(503, "playbook-service-auth-unconfigured")
      : problem(401, "unauthorized");
  }

  const { id } = await context.params;
  if (!PACKAGE_ID.test(id)) return problem(404, "playbook-package-not-found");
  if (!isCitelyEntitled(principal, { scope: "playbook:read", packageId: id })) {
    return problem(403, "entitlement-denied");
  }
  // The operation is intentionally bodyless. Reject a body stream without
  // buffering it so an authenticated caller cannot force an unbounded read.
  if (request.body !== null) {
    return problem(400, "unexpected-request-body");
  }

  try {
    const result = await new PlaybookPackageWatchlistStore(
      new SupabaseHttpClient(readSupabaseConfig()),
    ).create(id);
    if (result.status === "NOT_FOUND") {
      return problem(404, "playbook-package-not-found");
    }
    if (result.status === "NOT_WATCHLISTABLE") {
      return problem(409, "playbook-package-not-watchlistable");
    }
    return NextResponse.json(result.watchlist, {
      status: result.status === "CREATED" ? 201 : 200,
      headers: {
        ...corsHeaders(),
        "Cache-Control": "no-store",
        ...(result.status === "REPLAYED"
          ? { "Idempotency-Replayed": "true" }
          : {}),
      },
    });
  } catch (error: unknown) {
    console.error(
      `playbook watchlist unavailable: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    return problem(503, "playbook-watchlist-unavailable");
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
    "Access-Control-Allow-Headers": "Accept, Authorization, Content-Type",
  };
}
