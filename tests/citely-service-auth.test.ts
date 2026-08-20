import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020";
import { decodeJwt, exportSPKI, generateKeyPair, SignJWT } from "jose";
import {
  authenticateCitelyService,
  CitelyServiceAuthConfigurationError,
  CitelyServiceAuthenticationError,
  isCitelyEntitled,
  type CitelyServiceScope,
} from "../lib/auth/citely-service";

const NOW_SECONDS = 1_786_500_000;
const KID = "citely-key-2026-01";

test("signed service token authenticates and authorizes only its exact playbook", async () => {
  const fixture = await signedFixture({
    scope: "playbook:execute",
    playbookId: "stablecoin-pre-listing",
  });
  const principal = await authenticateCitelyService({
    authorization: `Bearer ${fixture.token}`,
    env: fixture.env,
    now: new Date(NOW_SECONDS * 1_000),
  });

  assert.equal(principal.mode, "SIGNED");
  assert.equal(principal.entitlementId, "entitlement-test-0001");
  assert.equal(isCitelyEntitled(principal, {
    scope: "playbook:execute",
    playbookId: "stablecoin-pre-listing",
  }), true);
  assert.equal(isCitelyEntitled(principal, {
    scope: "playbook:execute",
    playbookId: "business-model-regulatory-boundary",
  }), false);
});

test("superseding execution requires both the exact playbook and base package", async () => {
  const packageId = "package:stablecoin-pre-listing:aaaaaaaaaaaaaaaa";
  const fixture = await signedFixture({
    scope: "playbook:execute",
    playbookId: "stablecoin-pre-listing",
    packageId,
  });
  const principal = await authenticateCitelyService({
    authorization: `Bearer ${fixture.token}`,
    env: fixture.env,
    now: new Date(NOW_SECONDS * 1_000),
  });

  assert.equal(isCitelyEntitled(principal, {
    scope: "playbook:execute",
    playbookId: "stablecoin-pre-listing",
    packageId,
  }), true);
  assert.equal(isCitelyEntitled(principal, {
    scope: "playbook:execute",
    playbookId: "stablecoin-pre-listing",
  }), false);
  assert.equal(isCitelyEntitled(principal, {
    scope: "playbook:execute",
    playbookId: "stablecoin-pre-listing",
    packageId: "package:stablecoin-pre-listing:bbbbbbbbbbbbbbbb",
  }), false);
});

test("rotated public keys select only the signed kid", async () => {
  const current = await signedFixture({ scope: "evidence:search" });
  const retired = await signedFixture(
    { scope: "evidence:search" },
    "citely-key-2025-12",
  );
  current.env.CITELY_SERVICE_PUBLIC_KEYS_JSON = JSON.stringify({
    [KID]: current.publicKey,
    "citely-key-2025-12": retired.publicKey,
  });

  const currentPrincipal = await authenticateCitelyService({
    authorization: `Bearer ${current.token}`,
    env: current.env,
    now: new Date(NOW_SECONDS * 1_000),
  });
  const retiredPrincipal = await authenticateCitelyService({
    authorization: `Bearer ${retired.token}`,
    env: current.env,
    now: new Date(NOW_SECONDS * 1_000),
  });
  assert.equal(currentPrincipal.mode, "SIGNED");
  assert.equal(retiredPrincipal.mode, "SIGNED");
});

test("expired, wrong-audience, and overlong tokens fail authentication", async () => {
  const expired = await signedFixture(
    { scope: "evidence:search" },
    KID,
    { issuedAt: NOW_SECONDS - 600, expiresAt: NOW_SECONDS - 300 },
  );
  await assert.rejects(
    () => authenticateCitelyService({
      authorization: `Bearer ${expired.token}`,
      env: expired.env,
      now: new Date(NOW_SECONDS * 1_000),
    }),
    CitelyServiceAuthenticationError,
  );

  const wrongAudience = await signedFixture(
    { scope: "evidence:search" },
    KID,
    { audience: "ai-policy" },
  );
  await assert.rejects(
    () => authenticateCitelyService({
      authorization: `Bearer ${wrongAudience.token}`,
      env: wrongAudience.env,
      now: new Date(NOW_SECONDS * 1_000),
    }),
    CitelyServiceAuthenticationError,
  );

  const overlong = await signedFixture(
    { scope: "evidence:search" },
    KID,
    { expiresAt: NOW_SECONDS + 301 },
  );
  await assert.rejects(
    () => authenticateCitelyService({
      authorization: `Bearer ${overlong.token}`,
      env: overlong.env,
      now: new Date(NOW_SECONDS * 1_000),
    }),
    CitelyServiceAuthenticationError,
  );
});

test("scope and exact package target are both enforced", async () => {
  const packageId = "package:stablecoin-pre-listing:aaaaaaaaaaaaaaaa";
  const fixture = await signedFixture({
    scope: "playbook:read",
    packageId,
  });
  const principal = await authenticateCitelyService({
    authorization: `Bearer ${fixture.token}`,
    env: fixture.env,
    now: new Date(NOW_SECONDS * 1_000),
  });

  assert.equal(isCitelyEntitled(principal, { scope: "playbook:read", packageId }), true);
  assert.equal(isCitelyEntitled(principal, {
    scope: "playbook:read",
    packageId: "package:stablecoin-pre-listing:bbbbbbbbbbbbbbbb",
  }), false);
  assert.equal(isCitelyEntitled(principal, { scope: "evidence:search" }), false);
});

test("legacy key works only before the explicit signed-token cutover", async () => {
  const legacy = await authenticateCitelyService({
    authorization: "Bearer legacy-service-secret",
    legacySecret: "legacy-service-secret",
    env: {},
  });
  assert.equal(legacy.mode, "LEGACY");
  assert.equal(isCitelyEntitled(legacy, { scope: "evidence:search" }), true);

  const signed = await signedFixture({ scope: "evidence:search" });
  await assert.rejects(
    () => authenticateCitelyService({
      authorization: "Bearer legacy-service-secret",
      legacySecret: "legacy-service-secret",
      env: {
        ...signed.env,
        CITELY_REQUIRE_SIGNED_SERVICE_TOKEN: "1",
      },
    }),
    CitelyServiceAuthenticationError,
  );

  await assert.rejects(
    () => authenticateCitelyService({
      authorization: "Bearer legacy-service-secret",
      legacySecret: "legacy-service-secret",
      env: { CITELY_REQUIRE_SIGNED_SERVICE_TOKEN: "1" },
    }),
    CitelyServiceAuthConfigurationError,
  );
});

test("a malformed JWT can never downgrade to the legacy secret path", async () => {
  const signed = await signedFixture({ scope: "evidence:search" });
  await assert.rejects(
    () => authenticateCitelyService({
      authorization: "Bearer legacy.jwt.secret",
      legacySecret: "legacy.jwt.secret",
      env: signed.env,
    }),
    CitelyServiceAuthenticationError,
  );
});

test("malformed key configuration fails closed as an operator error", async () => {
  await assert.rejects(
    () => authenticateCitelyService({
      authorization: "Bearer any-token",
      env: { CITELY_SERVICE_PUBLIC_KEYS_JSON: "not-json" },
    }),
    CitelyServiceAuthConfigurationError,
  );
});

test("all four signed entitlement shapes satisfy the strict v1 contract", async () => {
  const schema = JSON.parse(await readFile(
    "contracts/v1/citely-service-token-payload.schema.json",
    "utf8",
  ));
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  const fixtures = await Promise.all([
    signedFixture({
      scope: "playbook:execute",
      playbookId: "stablecoin-pre-listing",
    }),
    signedFixture({
      scope: "playbook:execute",
      playbookId: "stablecoin-pre-listing",
      packageId: "package:stablecoin-pre-listing:aaaaaaaaaaaaaaaa",
    }),
    signedFixture({
      scope: "playbook:read",
      packageId: "package:stablecoin-pre-listing:aaaaaaaaaaaaaaaa",
    }),
    signedFixture({ scope: "evidence:search" }),
  ]);
  for (const fixture of fixtures) {
    assert.equal(validate(decodeJwt(fixture.token)), true, JSON.stringify(validate.errors));
  }
});

async function signedFixture(
  entitlement: {
    scope: CitelyServiceScope;
    playbookId?: string;
    packageId?: string;
  },
  kid = KID,
  overrides: {
    issuedAt?: number;
    expiresAt?: number;
    audience?: string;
  } = {},
) {
  const { publicKey, privateKey } = await generateKeyPair("EdDSA", {
    crv: "Ed25519",
    extractable: true,
  });
  const publicKeyPem = await exportSPKI(publicKey);
  const issuedAt = overrides.issuedAt ?? NOW_SECONDS;
  const expiresAt = overrides.expiresAt ?? NOW_SECONDS + 300;
  const token = await new SignJWT({
    entitlement: {
      id: "entitlement-test-0001",
      domain: "stablecoin",
      scope: entitlement.scope,
      playbookId: entitlement.playbookId,
      packageId: entitlement.packageId,
    },
  })
    .setProtectedHeader({ alg: "EdDSA", typ: "JWT", kid })
    .setIssuer("https://www.citely.info")
    .setAudience(overrides.audience ?? "stablecoin-policy")
    .setSubject("citely:playbook-service")
    .setJti("service-token-test-0001")
    .setIssuedAt(issuedAt)
    .setNotBefore(issuedAt)
    .setExpirationTime(expiresAt)
    .sign(privateKey);
  return {
    token,
    publicKey: publicKeyPem,
    env: {
      CITELY_SERVICE_PUBLIC_KEYS_JSON: JSON.stringify({ [kid]: publicKeyPem }),
    },
  };
}
