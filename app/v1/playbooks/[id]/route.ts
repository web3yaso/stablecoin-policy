import { NextResponse, type NextRequest } from "next/server";
import {
  PLAYBOOK_CATALOG_SCHEMA_VERSION,
  toPublicPlaybookDetail,
} from "@/lib/playbooks/catalog";
import { MVP_PLAYBOOKS } from "@/lib/playbooks/definitions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

/**
 * Presentation-safe detail and JSON Schema intake contract for one playbook.
 * Raw rule topics, dossier checks, actions, prompts, and decision graphs never
 * cross this public boundary.
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const definition = MVP_PLAYBOOKS.find((playbook) => playbook.playbookId === id);
  if (definition === undefined) {
    return NextResponse.json(
      { error: "playbook-not-found" },
      {
        status: 404,
        headers: { ...corsHeaders(), "Cache-Control": "no-store" },
      },
    );
  }

  return NextResponse.json(
    {
      schemaVersion: PLAYBOOK_CATALOG_SCHEMA_VERSION,
      playbook: toPublicPlaybookDetail(definition),
    },
    {
      headers: {
        ...corsHeaders(),
        "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
      },
    },
  );
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Accept, Content-Type",
  };
}
