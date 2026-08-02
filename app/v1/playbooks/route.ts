import { NextResponse } from "next/server";
import { MVP_PLAYBOOKS } from "@/lib/playbooks/definitions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

/**
 * Presentation-safe playbook catalog: names, descriptions, and capability
 * titles only. Raw DecisionRule content (topics, dossier checks) never leaves
 * the server.
 */
export async function GET() {
  return NextResponse.json(
    {
      schemaVersion: "1.0.0",
      playbooks: MVP_PLAYBOOKS.map((playbook) => ({
        playbookId: playbook.playbookId,
        name: playbook.name,
        version: playbook.version,
        description: playbook.description,
        capabilities: playbook.capabilities.map((capability) => ({
          capabilityId: capability.capabilityId,
          title: capability.title,
        })),
        assuranceNote:
          "Evaluations run on provisional machine-assured evidence and are research, not legal advice.",
      })),
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
