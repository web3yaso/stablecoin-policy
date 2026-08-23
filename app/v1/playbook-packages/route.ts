import { NextResponse, type NextRequest } from "next/server";
import {
  authenticateCitelyService,
  CitelyServiceAuthConfigurationError,
  isCitelyEntitled,
} from "@/lib/auth/citely-service";
import { readSupabaseConfig, SupabaseHttpClient } from "@/lib/data/supabase-client";
import { MVP_PLAYBOOKS } from "@/lib/playbooks/definitions";
import {
  parseIdempotencyKey,
  PlaybookIdempotencyConflictError,
  PlaybookPackageArtifactStore,
  playbookRequestFingerprint,
} from "@/lib/playbooks/artifacts";
import { evaluatePlaybookArtifact } from "@/lib/playbooks/package-evaluation";
import {
  hasExactKeys,
  isRecord,
  parseBusinessProfile,
} from "@/lib/playbooks/requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

/**
 * Creates a PlaybookPackage + EvidenceBundle from the live provisional
 * corpus and the committed mini-dossier. Citely authenticates server to server
 * with a short-lived signed token whose entitlement must target the requested
 * playbook. A legacy key remains available only for controlled cutover.
 * Packages are persisted as immutable private artifacts and retry-safe through
 * a hashed idempotency key. Raw profiles and raw idempotency keys are not stored.
 */
export async function POST(request: NextRequest) {
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
  const idempotencyKey = parseIdempotencyKey(
    request.headers.get("idempotency-key"),
  );
  if (idempotencyKey === null) {
    return problem(400, "invalid-idempotency-key");
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!isRecord(parsed) || !hasExactKeys(parsed, ["playbookId", "profile"])) {
      return problem(400, "invalid-profile");
    }
    body = parsed;
  } catch {
    return problem(400, "invalid-json");
  }
  const definition = MVP_PLAYBOOKS.find(
    (playbook) => playbook.playbookId === body.playbookId,
  );
  if (!definition) return problem(404, "playbook-not-found");
  if (!isCitelyEntitled(principal, {
    scope: "playbook:execute",
    playbookId: definition.playbookId,
  })) {
    return problem(403, "entitlement-denied");
  }
  const profile = parseBusinessProfile(body.profile);
  if (profile === null) return problem(400, "invalid-profile");

  let client: SupabaseHttpClient;
  let artifacts: PlaybookPackageArtifactStore;
  try {
    client = new SupabaseHttpClient(readSupabaseConfig());
    artifacts = new PlaybookPackageArtifactStore(client);
  } catch (error: unknown) {
    console.error(
      `playbook persistence unavailable: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    return problem(503, "playbook-persistence-unavailable");
  }

  const requestFingerprint = playbookRequestFingerprint({
    playbookId: definition.playbookId,
    profile,
  });
  try {
    const claim = await artifacts.claimIdempotencyKey(
      idempotencyKey,
      requestFingerprint,
    );
    if (claim.status === "COMPLETED") {
      return NextResponse.json(claim.artifact, {
        status: 200,
        headers: {
          ...corsHeaders(),
          "Cache-Control": "no-store",
          "Idempotency-Replayed": "true",
        },
      });
    }
    if (claim.status === "PENDING") {
      const retryAfter = Math.max(
        1,
        Math.ceil((Date.parse(claim.retryAfter) - Date.now()) / 1_000),
      );
      return problem(409, "idempotency-request-in-progress", {
        "Retry-After": String(retryAfter),
      });
    }
  } catch (error: unknown) {
    if (error instanceof PlaybookIdempotencyConflictError) {
      return problem(409, "idempotency-key-conflict");
    }
    console.error(
      `playbook idempotency unavailable: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    return problem(503, "playbook-persistence-unavailable");
  }

  let artifact;
  try {
    artifact = await evaluatePlaybookArtifact({ client, definition, profile });
  } catch (error: unknown) {
    console.error(
      `playbook evidence unavailable: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    return problem(503, "evidence-unavailable");
  }

  try {
    await artifacts.persist(artifact, idempotencyKey, requestFingerprint);
  } catch (error: unknown) {
    if (error instanceof PlaybookIdempotencyConflictError) {
      return problem(409, "idempotency-key-conflict");
    }
    console.error(
      `playbook package persistence failed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    return problem(503, "playbook-persistence-unavailable");
  }

  return NextResponse.json(
    artifact,
    { status: 201, headers: { ...corsHeaders(), "Cache-Control": "no-store" } },
  );
}

function problem(
  status: number,
  error: string,
  headers: Record<string, string> = {},
) {
  return NextResponse.json(
    { error },
    {
      status,
      headers: { ...corsHeaders(), "Cache-Control": "no-store", ...headers },
    },
  );
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Accept, Content-Type, Authorization, Idempotency-Key",
    "Access-Control-Expose-Headers": "Idempotency-Replayed, Retry-After",
  };
}
