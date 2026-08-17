import { NextResponse, type NextRequest } from "next/server";
import {
  authenticateCitelyService,
  CitelyServiceAuthConfigurationError,
  isCitelyEntitled,
} from "@/lib/auth/citely-service";
import { readSupabaseConfig, SupabaseHttpClient } from "@/lib/data/supabase-client";
import {
  DEFAULT_CHANGE_DELTA_PAGE_LIMIT,
  InvalidChangeDeltaCursorError,
  MAX_CHANGE_DELTA_PAGE_LIMIT,
  PlaybookWatchlistChangeDeltaStore,
} from "@/lib/monitoring/change-to-action-deltas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PACKAGE_ID = /^package:[a-z0-9-]+:[0-9a-f]{16}$/;
const ALLOWED_QUERY_PARAMETERS = new Set(["after_cursor", "limit"]);

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET(
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

  const query = parseQuery(request.nextUrl.searchParams);
  if (query === null) return problem(400, "invalid-change-delta-query");

  try {
    const result = await new PlaybookWatchlistChangeDeltaStore(
      new SupabaseHttpClient(readSupabaseConfig()),
    ).list(id, query.afterCursor, query.limit);
    if (result.status === "NOT_FOUND") {
      return problem(404, "playbook-watchlist-not-found");
    }
    return NextResponse.json(result.page, {
      status: 200,
      headers: { ...corsHeaders(), "Cache-Control": "no-store" },
    });
  } catch (error: unknown) {
    if (error instanceof InvalidChangeDeltaCursorError) {
      return problem(400, "invalid-after-cursor");
    }
    console.error(
      `playbook watchlist changes unavailable: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    return problem(503, "playbook-watchlist-changes-unavailable");
  }
}

function parseQuery(searchParams: URLSearchParams): {
  afterCursor: string | undefined;
  limit: number;
} | null {
  if ([...searchParams.keys()].some((key) => !ALLOWED_QUERY_PARAMETERS.has(key))) {
    return null;
  }
  const afterCursors = searchParams.getAll("after_cursor");
  const limits = searchParams.getAll("limit");
  if (afterCursors.length > 1 || limits.length > 1) return null;
  const afterCursor = afterCursors[0];
  if (afterCursor !== undefined && afterCursor.length === 0) return null;
  const rawLimit = limits[0];
  if (rawLimit === undefined) {
    return { afterCursor, limit: DEFAULT_CHANGE_DELTA_PAGE_LIMIT };
  }
  if (!/^[1-9][0-9]{0,2}$/.test(rawLimit)) return null;
  const limit = Number(rawLimit);
  if (limit > MAX_CHANGE_DELTA_PAGE_LIMIT) return null;
  return { afterCursor, limit };
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
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Accept, Authorization, Content-Type",
  };
}
