import { NextResponse, type NextRequest } from "next/server";
import {
  authenticateCitelyService,
  CitelyServiceAuthConfigurationError,
  isCitelyEntitled,
} from "@/lib/auth/citely-service";
import { readSupabaseConfig, SupabaseHttpClient } from "@/lib/data/supabase-client";
import { PlaybookPackageArtifactStore } from "@/lib/playbooks/artifacts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  if (!/^package:[a-z0-9-]+:[0-9a-f]{16}$/.test(id)) {
    return problem(404, "playbook-package-not-found");
  }
  if (!isCitelyEntitled(principal, { scope: "playbook:read", packageId: id })) {
    return problem(403, "entitlement-denied");
  }

  try {
    const artifact = await new PlaybookPackageArtifactStore(
      new SupabaseHttpClient(readSupabaseConfig()),
    ).findByPackageId(id);
    if (artifact === null) return problem(404, "playbook-package-not-found");
    return NextResponse.json(artifact, {
      status: 200,
      headers: { ...corsHeaders(), "Cache-Control": "no-store" },
    });
  } catch (error: unknown) {
    console.error(
      `playbook package replay failed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    return problem(503, "playbook-package-unavailable");
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
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Accept, Authorization",
  };
}
