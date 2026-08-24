import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { exportSPKI, generateKeyPair, SignJWT } from "jose";
import { NextRequest } from "next/server";
import { GET as OPENAPI } from "../app/openapi.json/route";
import { GET } from "../app/v1/playbook-packages/[id]/route";
import { POST as RERUN } from "../app/v1/playbook-packages/[id]/rerun/route";
import { POST } from "../app/v1/playbook-packages/route";
import { sha256 } from "../lib/data/integrity";
import type { FetchLike } from "../lib/data/supabase-client";
import type { PlaybookPackageArtifact } from "../lib/playbooks/contracts";

const API_KEY = "route-test-api-key";
const BASE_ARTIFACT = JSON.parse(readFileSync(
  "contracts/fixtures/citely/v1/business-model-boundary-retrieval-unavailable.response.json",
  "utf8",
)) as PlaybookPackageArtifact;
const PLAYBOOK_PACKAGE_RESPONSE_SCHEMA = JSON.parse(readFileSync(
  "contracts/v1/playbook-package-response.schema.json",
  "utf8",
));
const schemaValidator = new Ajv2020({ allErrors: true, strict: true });
addFormats(schemaValidator);
const validatePlaybookPackageResponse = schemaValidator.compile(
  PLAYBOOK_PACKAGE_RESPONSE_SCHEMA,
);

test("package creation rejects a missing idempotency key before external IO", async () => {
  await withApiKey(async () => {
    const response = await POST(new NextRequest("https://example.test/v1/playbook-packages", {
      method: "POST",
      headers: {
        authorization: `Bearer ${API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        playbookId: "business-model-regulatory-boundary",
        profile: {
          operatorJurisdiction: "SG",
          targetJurisdiction: "EEA",
          activities: ["issue-emt"],
          asset: null,
        },
      }),
    }));

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "invalid-idempotency-key" });
    assert.equal(response.headers.get("cache-control"), "no-store");
  });
});

test("package creation rejects fields outside the committed request contract", async () => {
  await withApiKey(async () => {
    const response = await POST(new NextRequest("https://example.test/v1/playbook-packages", {
      method: "POST",
      headers: {
        authorization: `Bearer ${API_KEY}`,
        "content-type": "application/json",
        "idempotency-key": "route-contract-test-0001",
      },
      body: JSON.stringify({
        playbookId: "business-model-regulatory-boundary",
        profile: {
          operatorJurisdiction: "SG",
          targetJurisdiction: "EEA",
          activities: ["issue-emt"],
          asset: null,
          customerEmail: "must-not-cross-boundary@example.test",
        },
      }),
    }));

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "invalid-profile" });
  });
});

test("package replay rejects malformed identifiers before external IO", async () => {
  await withApiKey(async () => {
    const response = await GET(
      new NextRequest("https://example.test/v1/playbook-packages/not-a-package", {
        headers: { authorization: `Bearer ${API_KEY}` },
      }),
      { params: Promise.resolve({ id: "not-a-package" }) },
    );

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "playbook-package-not-found" });
    assert.equal(response.headers.get("cache-control"), "no-store");
  });
});

test("superseding evaluation rejects fields outside its strict request boundary", async () => {
  await withRerunToken(
    "stablecoin-pre-listing",
    "package:stablecoin-pre-listing:aaaaaaaaaaaaaaaa",
    async (token) => {
    const response = await RERUN(
      new NextRequest(
        "https://example.test/v1/playbook-packages/package:stablecoin-pre-listing:aaaaaaaaaaaaaaaa/rerun",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            "idempotency-key": "rerun-route-test-0001",
          },
          body: JSON.stringify({
            profile: profileFixture(),
            deltaIds: ["delta:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
            customerId: "must-not-cross-domain-boundary",
          }),
        },
      ),
      {
        params: Promise.resolve({
          id: "package:stablecoin-pre-listing:aaaaaaaaaaaaaaaa",
        }),
      },
    );

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "invalid-superseding-evaluation-request",
    });
    },
  );
});

test("superseding evaluation never accepts the legacy unscoped service key", async () => {
  await withApiKey(async () => {
    const packageId = "package:stablecoin-pre-listing:aaaaaaaaaaaaaaaa";
    const response = await RERUN(
      new NextRequest(`https://example.test/v1/playbook-packages/${packageId}/rerun`, {
        method: "POST",
        headers: { authorization: `Bearer ${API_KEY}` },
      }),
      { params: Promise.resolve({ id: packageId }) },
    );
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "entitlement-denied" });
  });
});

test("superseding evaluation requires an unexpired exact playbook and package entitlement", async () => {
  const packageId = "package:stablecoin-pre-listing:aaaaaaaaaaaaaaaa";
  const deniedEntitlements = [
    {
      playbookId: "stablecoin-pre-listing",
      packageId: undefined,
      label: "playbook-only entitlement",
    },
    {
      playbookId: "business-model-regulatory-boundary",
      packageId,
      label: "wrong playbook entitlement",
    },
    {
      playbookId: "stablecoin-pre-listing",
      packageId: "package:stablecoin-pre-listing:bbbbbbbbbbbbbbbb",
      label: "wrong package entitlement",
    },
  ];

  for (const entitlement of deniedEntitlements) {
    await withRerunToken(
      entitlement.playbookId,
      entitlement.packageId,
      async (token) => {
        const response = await RERUN(rerunRequest(packageId, token), {
          params: Promise.resolve({ id: packageId }),
        });
        assert.equal(response.status, 403, entitlement.label);
        assert.deepEqual(await response.json(), { error: "entitlement-denied" });
      },
    );
  }

  await withRerunToken(
    "stablecoin-pre-listing",
    packageId,
    async (token) => {
      const response = await RERUN(rerunRequest(packageId, token), {
        params: Promise.resolve({ id: packageId }),
      });
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: "unauthorized" });
    },
    { expiresInSeconds: -60, issuedAtOffsetSeconds: -120 },
  );
});

test("superseding evaluation maps an incomplete current delta snapshot to 409", async () => {
  const artifact = BASE_ARTIFACT;
  const artifactBody = Buffer.from(JSON.stringify(artifact));
  const objectKey = `packages/${artifact.package.playbookId}/${artifact.package.integritySha256}.json`;
  const fetchImpl: FetchLike = async (input, init) => {
    const url = new URL(String(input));
    const functionName = url.pathname.split("/").at(-1);
    if (functionName === "get_playbook_package_artifact") {
      return Response.json({
        packageId: artifact.package.packageId,
        playbookId: artifact.package.playbookId,
        profileFingerprint: artifact.package.profileFingerprint,
        artifactObjectId: "object:playbook-package:test",
        objectKey,
        checksumSha256: sha256(artifactBody),
        byteSize: artifactBody.byteLength,
        contentType: "application/json",
        integritySha256: artifact.package.integritySha256,
        schemaVersion: artifact.package.schemaVersion,
        evaluatedAt: artifact.package.evaluatedAt,
        assuranceReviewStatus: artifact.package.assurance.reviewStatus,
        corpusReleaseId: artifact.package.versions.corpusReleaseId,
        retrievalIndexReleaseId: artifact.package.versions.retrievalIndexReleaseId,
        dossierId: artifact.package.versions.dossierId,
        rulesVersion: artifact.package.versions.rulesVersion,
        templateVersion: artifact.package.versions.templateVersion,
      });
    }
    if (url.pathname.startsWith("/storage/v1/object/")) {
      return new Response(artifactBody, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (functionName === "claim_superseding_playbook_evaluation") {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.equal(body.p_base_package_id, artifact.package.packageId);
      assert.equal(body.p_profile_fingerprint, artifact.package.profileFingerprint);
      return Response.json({ status: "DELTA_SNAPSHOT_MISMATCH" });
    }
    return new Response("unexpected request", { status: 500 });
  };

  await withRerunToken(
    artifact.package.playbookId,
    artifact.package.packageId,
    async (token) => withSupabase(fetchImpl, async () => {
    const response = await RERUN(
      new NextRequest(
        `https://example.test/v1/playbook-packages/${artifact.package.packageId}/rerun`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            "idempotency-key": "rerun-route-test-0002",
          },
          body: JSON.stringify({
            profile: {
              operatorJurisdiction: "SG",
              targetJurisdiction: "EEA",
              activities: ["issue-emt", "pay-emt-interest"],
              asset: null,
            },
            deltaIds: ["delta:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
          }),
        },
      ),
      { params: Promise.resolve({ id: artifact.package.packageId }) },
    );

    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      error: "change-delta-snapshot-mismatch",
    });
    }),
  );
});

test("superseding evaluation returns and replays the existing PlaybookPackageArtifact contract", async () => {
  const artifact = BASE_ARTIFACT;
  const artifactBody = Buffer.from(JSON.stringify(artifact));
  const rpcBodies: Record<string, unknown>[] = [];
  let successorArtifact: PlaybookPackageArtifact | null = null;
  let successorBody: Uint8Array | null = null;
  let completed = false;
  const fetchImpl: FetchLike = async (input, init) => {
    const url = new URL(String(input));
    const functionName = url.pathname.split("/").at(-1);
    const requestBody = url.pathname.includes("/rpc/") && init?.body
      ? JSON.parse(String(init.body)) as Record<string, unknown>
      : {};
    if (functionName === "get_playbook_package_artifact") {
      const requestedPackageId = requestBody.p_package_id;
      let requestedArtifact: PlaybookPackageArtifact = artifact;
      let requestedBody: Uint8Array = artifactBody;
      if (
        successorArtifact !== null
        && requestedPackageId === successorArtifact.package.packageId
      ) {
        assert.ok(successorBody);
        requestedArtifact = successorArtifact;
        requestedBody = successorBody;
      }
      return Response.json({
        packageId: requestedArtifact.package.packageId,
        playbookId: requestedArtifact.package.playbookId,
        profileFingerprint: requestedArtifact.package.profileFingerprint,
        artifactObjectId: "object:playbook-package:test",
        objectKey: `packages/${requestedArtifact.package.playbookId}/${requestedArtifact.package.integritySha256}.json`,
        checksumSha256: sha256(requestedBody),
        byteSize: requestedBody.byteLength,
        contentType: "application/json",
        integritySha256: requestedArtifact.package.integritySha256,
        schemaVersion: requestedArtifact.package.schemaVersion,
        evaluatedAt: requestedArtifact.package.evaluatedAt,
        assuranceReviewStatus: requestedArtifact.package.assurance.reviewStatus,
        corpusReleaseId: requestedArtifact.package.versions.corpusReleaseId,
        retrievalIndexReleaseId: requestedArtifact.package.versions.retrievalIndexReleaseId,
        dossierId: requestedArtifact.package.versions.dossierId,
        rulesVersion: requestedArtifact.package.versions.rulesVersion,
        templateVersion: requestedArtifact.package.versions.templateVersion,
      });
    }
    if (url.pathname.startsWith("/storage/v1/object/") && init?.method !== "POST") {
      const body = successorArtifact !== null
        && url.pathname.includes(successorArtifact.package.integritySha256)
        ? successorBody
        : artifactBody;
      assert.ok(body);
      return new Response(Buffer.from(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (functionName === "claim_superseding_playbook_evaluation") {
      rpcBodies.push(requestBody);
      if (completed) {
        assert.ok(successorArtifact);
        return Response.json({
          status: "COMPLETED",
          packageId: successorArtifact.package.packageId,
        });
      }
      return Response.json({
        status: "CLAIMED",
        rerunId: "rerun:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        leaseExpiresAt: new Date(Date.now() + 120_000).toISOString(),
      });
    }
    if (url.pathname === "/rest/v1/public_provisional_claims") {
      return Response.json(artifact.evidenceBundle.claims.map((claim) => ({
        claim_id: claim.claimId,
        jurisdiction_code: "EEA",
        topic: claim.topic,
        proposition: claim.proposition,
        legal_status: claim.legalStatus,
        effective_from: claim.asOf,
        effective_to: null,
        release_id: claim.releaseId,
        as_of: claim.asOf,
        knowledge_cutoff: claim.knowledgeCutoff,
        assurance_level: "PROVISIONAL_PUBLISHED",
        human_reviewed: false,
        confidence: claim.confidence,
        limitations: claim.limitations,
        counsel_triggers: [],
        source_version_id: "version:route-test:1",
        source_checksum_sha256: "a".repeat(64),
        source_retrieved_at: claim.knowledgeCutoff,
        source_official_url: "https://official.example.test/source",
        citations: claim.citations,
      })));
    }
    if (url.pathname.startsWith("/storage/v1/object/") && init?.method === "POST") {
      const uploadedBody = init.body;
      assert.ok(uploadedBody instanceof Uint8Array);
      successorBody = new Uint8Array(uploadedBody);
      successorArtifact = JSON.parse(
        Buffer.from(uploadedBody).toString("utf8"),
      ) as PlaybookPackageArtifact;
      return Response.json({ Key: url.pathname });
    }
    if (functionName === "complete_superseding_playbook_evaluation") {
      rpcBodies.push(requestBody);
      completed = true;
      return Response.json({
        status: "COMPLETED",
        packageId: requestBody.p_package_id,
      });
    }
    return new Response("unexpected request", { status: 500 });
  };

  await withRerunToken(
    artifact.package.playbookId,
    artifact.package.packageId,
    async (token) => withSupabase(fetchImpl, async () => {
    const request = () => new NextRequest(
      `https://example.test/v1/playbook-packages/${artifact.package.packageId}/rerun`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "idempotency-key": "rerun-route-test-0003",
        },
        body: JSON.stringify({
          profile: {
            operatorJurisdiction: "SG",
            targetJurisdiction: "EEA",
            activities: ["issue-emt", "pay-emt-interest"],
            asset: null,
          },
          deltaIds: ["delta:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
        }),
      },
    );
    const response = await RERUN(
      request(),
      { params: Promise.resolve({ id: artifact.package.packageId }) },
    );

    assert.equal(response.status, 201);
    const successor = await response.json() as PlaybookPackageArtifact;
    assert.equal(validatePlaybookPackageResponse(successor), true,
      JSON.stringify(validatePlaybookPackageResponse.errors));
    assert.equal(successor.package.schemaVersion, "1.1.0");
    assert.equal(successor.evidenceBundle.schemaVersion, "1.1.0");
    assert.equal("profile" in successor.package, false);

    const replayResponse = await RERUN(
      request(),
      { params: Promise.resolve({ id: artifact.package.packageId }) },
    );
    assert.equal(replayResponse.status, 200);
    assert.equal(replayResponse.headers.get("idempotency-replayed"), "true");
    const replay = await replayResponse.json() as PlaybookPackageArtifact;
    assert.equal(validatePlaybookPackageResponse(replay), true,
      JSON.stringify(validatePlaybookPackageResponse.errors));
    assert.deepEqual(replay, successor);
    assert.equal(
      rpcBodies.some((body) => JSON.stringify(body).includes("operatorJurisdiction")),
      false,
    );
    }),
  );
});

test("OpenAPI advertises exact-package superseding execution", async () => {
  const document = await (await OPENAPI(
    new NextRequest("https://policy.citely.info/openapi.json"),
  )).json();
  const operation = document.paths["/v1/playbook-packages/{id}/rerun"].post;
  assert.equal(operation.operationId, "rerunPlaybookPackage");
  assert.match(operation.description, /exact playbook and base package/);
  assert.equal(operation.parameters[1].name, "Idempotency-Key");
  assert.match(operation.requestBody.description, /playbook-package-rerun-request/);
  assert.match(operation.responses[201].description, /unchanged/);
});

async function withApiKey(run: () => Promise<void>) {
  const previous = process.env.PLAYBOOK_API_KEY;
  process.env.PLAYBOOK_API_KEY = API_KEY;
  try {
    await run();
  } finally {
    if (previous === undefined) delete process.env.PLAYBOOK_API_KEY;
    else process.env.PLAYBOOK_API_KEY = previous;
  }
}

async function withRerunToken(
  playbookId: string,
  packageId: string | undefined,
  run: (token: string) => Promise<void>,
  options: {
    expiresInSeconds?: number;
    issuedAtOffsetSeconds?: number;
  } = {},
) {
  const kid = "rerun-route-key-0001";
  const { publicKey, privateKey } = await generateKeyPair("EdDSA", {
    crv: "Ed25519",
    extractable: true,
  });
  const now = Math.floor(Date.now() / 1_000);
  const issuedAt = now + (options.issuedAtOffsetSeconds ?? 0);
  const entitlement = {
    id: "rerun-route-entitlement-0001",
    domain: "stablecoin",
    scope: "playbook:execute",
    playbookId,
    ...(packageId === undefined ? {} : { packageId }),
  };
  const token = await new SignJWT({
    entitlement,
  })
    .setProtectedHeader({ alg: "EdDSA", typ: "JWT", kid })
    .setIssuer("https://www.citely.info")
    .setAudience("stablecoin-policy")
    .setSubject("citely:playbook-service")
    .setJti("rerun-route-token-0001")
    .setIssuedAt(issuedAt)
    .setNotBefore(issuedAt)
    .setExpirationTime(now + (options.expiresInSeconds ?? 300))
    .sign(privateKey);
  const previousKeys = process.env.CITELY_SERVICE_PUBLIC_KEYS_JSON;
  process.env.CITELY_SERVICE_PUBLIC_KEYS_JSON = JSON.stringify({
    [kid]: await exportSPKI(publicKey),
  });
  try {
    await run(token);
  } finally {
    if (previousKeys === undefined) {
      delete process.env.CITELY_SERVICE_PUBLIC_KEYS_JSON;
    } else {
      process.env.CITELY_SERVICE_PUBLIC_KEYS_JSON = previousKeys;
    }
  }
}

function rerunRequest(packageId: string, token: string) {
  return new NextRequest(`https://example.test/v1/playbook-packages/${packageId}/rerun`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": "rerun-route-auth-test-0001",
    },
    body: JSON.stringify({
      profile: profileFixture(),
      deltaIds: ["delta:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
    }),
  });
}

function profileFixture() {
  return {
    operatorJurisdiction: "SG",
    targetJurisdiction: "EEA",
    activities: ["list-stablecoin"],
    asset: null,
  };
}

async function withSupabase(fetchImpl: FetchLike, run: () => Promise<void>) {
  const previousFetch = globalThis.fetch;
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  globalThis.fetch = fetchImpl as typeof fetch;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  try {
    await run();
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
}
