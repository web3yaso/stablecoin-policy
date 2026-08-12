import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { exportPKCS8, generateKeyPair } from "jose";
import type { BusinessProfile, PlaybookPackageArtifact } from "../lib/playbooks/contracts";
import { runCitelyPackageSmoke } from "../lib/playbooks/citely-smoke";

type CreateRequest = { playbookId: string; profile: BusinessProfile };

async function fixtures(): Promise<{
  request: CreateRequest;
  artifact: PlaybookPackageArtifact;
  schema: Record<string, unknown>;
  privateKeyPem: string;
}> {
  const directory = path.join(
    process.cwd(),
    "contracts",
    "fixtures",
    "citely",
    "v1",
  );
  const [request, artifact, schema, keyPair] = await Promise.all([
    readFile(path.join(directory, "stablecoin-pre-listing-success.request.json"), "utf8"),
    readFile(path.join(directory, "stablecoin-pre-listing-success.response.json"), "utf8"),
    readFile(
      path.join(process.cwd(), "contracts", "v1", "playbook-package-response.schema.json"),
      "utf8",
    ),
    generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true }),
  ]);
  return {
    request: JSON.parse(request) as CreateRequest,
    artifact: JSON.parse(artifact) as PlaybookPackageArtifact,
    schema: JSON.parse(schema) as Record<string, unknown>,
    privateKeyPem: await exportPKCS8(keyPair.privateKey),
  };
}

test("signed Citely smoke covers create, retry, conflict, auth failures, and replay without leaking credentials", async () => {
  const fixture = await fixtures();
  const calls: Array<{ url: string; authorization: string; body: string | null }> = [];
  let postCount = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push({
      url,
      authorization: headers.get("authorization") ?? "",
      body: typeof init?.body === "string" ? init.body : null,
    });
    if (init?.method === "POST") {
      postCount += 1;
      if (postCount === 1) return json(fixture.artifact, 201);
      if (postCount === 2) {
        return json(fixture.artifact, 200, { "Idempotency-Replayed": "true" });
      }
      if (postCount === 3) return json({ error: "idempotency-key-conflict" }, 409);
      if (postCount === 4) return json({ error: "entitlement-denied" }, 403);
      if (postCount === 5 || postCount === 6) {
        return json({ error: "unauthorized" }, 401);
      }
    }
    if (url.includes("/v1/playbook-packages/package%3A")) {
      return json(fixture.artifact, 200);
    }
    throw new Error(`unexpected smoke request: ${init?.method ?? "GET"} ${url}`);
  };

  const result = await runCitelyPackageSmoke({
    baseUrl: "https://policy.example.test",
    keyId: "smoke-key-2026-01",
    privateKeyPem: fixture.privateKeyPem,
    request: fixture.request,
    responseSchema: fixture.schema,
    fetchImpl,
    now: () => new Date("2026-08-12T12:00:00.000Z"),
  });

  assert.equal(calls.length, 7);
  assert.equal(postCount, 6);
  assert.deepEqual(result.checks, {
    create: 201,
    exactRetry: 200,
    changedRequestConflict: 409,
    wrongTarget: 403,
    wrongAudience: 401,
    expiredToken: 401,
    replay: 200,
    schemaValid: true,
    integrityValid: true,
    genericRenderReady: true,
  });
  assert.equal(result.packageId, fixture.artifact.package.packageId);
  assert.ok(calls.every((call) => call.authorization.startsWith("Bearer eyJ")));
  assert.equal(new Set(calls.map((call) => call.authorization)).size, calls.length);
  assert.equal(JSON.stringify(result).includes("PRIVATE KEY"), false);
  assert.equal(JSON.stringify(result).includes("Bearer "), false);
  assert.equal(calls[0].body, calls[1].body);
  assert.notEqual(calls[1].body, calls[2].body);
});

test("Citely smoke fails closed when replay bytes do not match the created artifact", async () => {
  const fixture = await fixtures();
  let postCount = 0;
  const changed = {
    ...fixture.artifact,
    package: { ...fixture.artifact.package, evaluatedAt: "2026-08-12T12:00:01.000Z" },
  };
  const fetchImpl: typeof fetch = async (_input, init) => {
    if (init?.method === "POST") {
      postCount += 1;
      if (postCount === 1) return json(fixture.artifact, 201);
      return json(changed, 200, { "Idempotency-Replayed": "true" });
    }
    throw new Error("GET should not run after a changed idempotent replay");
  };

  await assert.rejects(
    runCitelyPackageSmoke({
      baseUrl: "https://policy.example.test",
      keyId: "smoke-key-2026-01",
      privateKeyPem: fixture.privateKeyPem,
      request: fixture.request,
      responseSchema: fixture.schema,
      fetchImpl,
      now: () => new Date("2026-08-12T12:00:00.000Z"),
    }),
    /exact immutable artifact/,
  );
});

test("Citely smoke rejects unsafe origins before signing or network IO", async () => {
  const fixture = await fixtures();
  let calls = 0;
  await assert.rejects(
    runCitelyPackageSmoke({
      baseUrl: "http://policy.example.test/path",
      keyId: "smoke-key-2026-01",
      privateKeyPem: fixture.privateKeyPem,
      request: fixture.request,
      responseSchema: fixture.schema,
      fetchImpl: async () => {
        calls += 1;
        throw new Error("must not run");
      },
    }),
    /requires HTTPS/,
  );
  assert.equal(calls, 0);
});

function json(
  body: unknown,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}
