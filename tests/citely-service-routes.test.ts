import assert from "node:assert/strict";
import test from "node:test";
import { exportSPKI, generateKeyPair, SignJWT } from "jose";
import { NextRequest } from "next/server";
import { POST as searchEvidence } from "../app/v1/evidence/search/route";
import { GET as getPackage } from "../app/v1/playbook-packages/[id]/route";
import { POST as createWatchlist } from "../app/v1/playbook-packages/[id]/watchlist/route";
import { POST as createPackage } from "../app/v1/playbook-packages/route";
import type { CitelyServiceScope } from "../lib/auth/citely-service";

test("package routes reject signed entitlements for a different target", async () => {
  const execute = await tokenFixture({
    scope: "playbook:execute",
    playbookId: "business-model-regulatory-boundary",
  });
  await withPublicKey(execute.publicKey, async () => {
    const response = await createPackage(new NextRequest(
      "https://example.test/v1/playbook-packages",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${execute.token}`,
          "content-type": "application/json",
          "idempotency-key": "route-entitlement-test-0001",
        },
        body: JSON.stringify({
          playbookId: "stablecoin-pre-listing",
          profile: {
            operatorJurisdiction: "SG",
            targetJurisdiction: "EEA",
            activities: ["list-for-trading"],
            asset: { symbol: "USDC", networks: ["base"] },
          },
        }),
      },
    ));
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "entitlement-denied" });
  });

  const read = await tokenFixture({
    scope: "playbook:read",
    packageId: "package:stablecoin-pre-listing:aaaaaaaaaaaaaaaa",
  });
  await withPublicKey(read.publicKey, async () => {
    const requested = "package:stablecoin-pre-listing:bbbbbbbbbbbbbbbb";
    const response = await getPackage(
      new NextRequest(`https://example.test/v1/playbook-packages/${requested}`, {
        headers: { authorization: `Bearer ${read.token}` },
      }),
      { params: Promise.resolve({ id: requested }) },
    );
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "entitlement-denied" });

    const watchlistResponse = await createWatchlist(
      new NextRequest(
        `https://example.test/v1/playbook-packages/${requested}/watchlist`,
        { method: "POST", headers: { authorization: `Bearer ${read.token}` } },
      ),
      { params: Promise.resolve({ id: requested }) },
    );
    assert.equal(watchlistResponse.status, 403);
    assert.deepEqual(await watchlistResponse.json(), { error: "entitlement-denied" });
  });
});

test("evidence search requires its own signed scope", async () => {
  const fixture = await tokenFixture({
    scope: "playbook:execute",
    playbookId: "stablecoin-pre-listing",
  });
  await withPublicKey(fixture.publicKey, async () => {
    const response = await searchEvidence(new NextRequest(
      "https://example.test/v1/evidence/search",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${fixture.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      },
    ));
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "entitlement-denied" });
  });
});

async function tokenFixture(entitlement: {
  scope: CitelyServiceScope;
  playbookId?: string;
  packageId?: string;
}) {
  const { publicKey, privateKey } = await generateKeyPair("EdDSA", {
    crv: "Ed25519",
    extractable: true,
  });
  const now = Math.floor(Date.now() / 1_000);
  const token = await new SignJWT({
    entitlement: {
      id: "route-entitlement-test-0001",
      domain: "stablecoin",
      ...entitlement,
    },
  })
    .setProtectedHeader({ alg: "EdDSA", typ: "JWT", kid: "route-key-2026-01" })
    .setIssuer("https://www.citely.info")
    .setAudience("stablecoin-policy")
    .setSubject("citely:playbook-service")
    .setJti("route-token-test-0001")
    .setIssuedAt(now)
    .setNotBefore(now)
    .setExpirationTime(now + 300)
    .sign(privateKey);
  return { token, publicKey: await exportSPKI(publicKey) };
}

async function withPublicKey(publicKey: string, run: () => Promise<void>) {
  const names = [
    "CITELY_SERVICE_PUBLIC_KEYS_JSON",
    "CITELY_REQUIRE_SIGNED_SERVICE_TOKEN",
  ] as const;
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  process.env.CITELY_SERVICE_PUBLIC_KEYS_JSON = JSON.stringify({
    "route-key-2026-01": publicKey,
  });
  process.env.CITELY_REQUIRE_SIGNED_SERVICE_TOKEN = "1";
  try {
    await run();
  } finally {
    for (const name of names) {
      const value = previous[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}
