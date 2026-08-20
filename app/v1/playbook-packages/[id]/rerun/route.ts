import { NextResponse, type NextRequest } from "next/server";
import {
  authenticateCitelyService,
  CitelyServiceAuthConfigurationError,
  isCitelyEntitled,
} from "@/lib/auth/citely-service";
import { readSupabaseConfig, SupabaseHttpClient } from "@/lib/data/supabase-client";
import {
  parseIdempotencyKey,
  PlaybookIdempotencyConflictError,
  playbookProfileFingerprint,
  PlaybookPackageArtifactStore,
  playbookSupersedingRequestFingerprint,
  SupersedingEvaluationStaleError,
} from "@/lib/playbooks/artifacts";
import { MVP_PLAYBOOKS } from "@/lib/playbooks/definitions";
import { evaluatePlaybookArtifact } from "@/lib/playbooks/package-evaluation";
import { parseSupersedingEvaluationRequest } from "@/lib/playbooks/requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PACKAGE_ID = /^package:([a-z0-9-]+):[0-9a-f]{16}$/;

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

  const { id: basePackageId } = await context.params;
  const match = PACKAGE_ID.exec(basePackageId);
  if (match === null) return problem(404, "playbook-package-not-found");
  const definition = MVP_PLAYBOOKS.find(
    (candidate) => candidate.playbookId === match[1],
  );
  if (definition === undefined) return problem(404, "playbook-package-not-found");
  if (principal.mode !== "SIGNED" || !isCitelyEntitled(principal, {
    scope: "playbook:execute",
    playbookId: definition.playbookId,
    packageId: basePackageId,
  })) {
    return problem(403, "entitlement-denied");
  }

  const idempotencyKey = parseIdempotencyKey(
    request.headers.get("idempotency-key"),
  );
  if (idempotencyKey === null) return problem(400, "invalid-idempotency-key");

  let body;
  try {
    body = parseSupersedingEvaluationRequest(await request.json());
  } catch {
    return problem(400, "invalid-json");
  }
  if (body === null) return problem(400, "invalid-superseding-evaluation-request");

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

  try {
    const baseArtifact = await artifacts.findByPackageId(basePackageId);
    if (
      baseArtifact === null
      || baseArtifact.package.playbookId !== definition.playbookId
    ) {
      return problem(404, "playbook-package-not-found");
    }
    if (
      playbookProfileFingerprint(body.profile)
      !== baseArtifact.package.profileFingerprint
    ) {
      return problem(409, "business-profile-mismatch");
    }
  } catch (error: unknown) {
    console.error(
      `base playbook package unavailable: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    return problem(503, "playbook-persistence-unavailable");
  }

  const profileFingerprint = playbookProfileFingerprint(body.profile);
  const requestFingerprint = playbookSupersedingRequestFingerprint({
    basePackageId,
    playbookId: definition.playbookId,
    profile: body.profile,
    deltaIds: body.deltaIds,
  });

  let rerunId: string;
  try {
    const claim = await artifacts.claimSupersedingEvaluation({
      basePackageId,
      playbookId: definition.playbookId,
      profileFingerprint,
      deltaIds: body.deltaIds,
      idempotencyKey,
      requestFingerprintSha256: requestFingerprint,
    });
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
    if (claim.status === "NOT_FOUND") {
      return problem(404, "playbook-package-not-found");
    }
    if (claim.status === "PROFILE_MISMATCH") {
      return problem(409, "business-profile-mismatch");
    }
    if (claim.status === "INVALID_DELTA_SET") {
      return problem(400, "invalid-change-delta-set");
    }
    if (claim.status === "DELTA_SNAPSHOT_MISMATCH") {
      return problem(409, "change-delta-snapshot-mismatch");
    }
    if (claim.status === "STALE") {
      return problem(409, "superseding-evaluation-stale");
    }
    if (
      claim.status === "PLAYBOOK_MISMATCH"
      || claim.status === "WATCHLIST_NOT_ACTIVE"
      || claim.status === "ALREADY_SUPERSEDED"
    ) {
      return problem(409, "playbook-package-not-rerunnable");
    }
    rerunId = claim.rerunId;
  } catch (error: unknown) {
    if (error instanceof PlaybookIdempotencyConflictError) {
      return problem(409, "idempotency-key-conflict");
    }
    console.error(
      `superseding evaluation claim unavailable: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    return problem(503, "playbook-persistence-unavailable");
  }

  let artifact;
  try {
    artifact = await evaluatePlaybookArtifact({
      client,
      definition,
      profile: body.profile,
    });
  } catch (error: unknown) {
    console.error(
      `playbook evidence unavailable: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    return problem(503, "evidence-unavailable");
  }

  try {
    await artifacts.persistSupersedingEvaluation({
      artifact,
      rerunId,
      idempotencyKey,
      requestFingerprintSha256: requestFingerprint,
    });
  } catch (error: unknown) {
    if (error instanceof PlaybookIdempotencyConflictError) {
      return problem(409, "idempotency-key-conflict");
    }
    if (error instanceof SupersedingEvaluationStaleError) {
      return problem(409, "superseding-evaluation-stale");
    }
    console.error(
      `superseding playbook persistence failed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    return problem(503, "playbook-persistence-unavailable");
  }

  return NextResponse.json(artifact, {
    status: 201,
    headers: { ...corsHeaders(), "Cache-Control": "no-store" },
  });
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
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Accept, Content-Type, Authorization, Idempotency-Key",
    "Access-Control-Expose-Headers": "Idempotency-Replayed, Retry-After",
  };
}
