import { randomUUID } from "node:crypto";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { importPKCS8, SignJWT } from "jose";
import { replayChecksum } from "../legal-corpus/machine-pipeline";
import type {
  BusinessProfile,
  PlaybookPackageArtifact,
} from "./contracts";
import { verifyPlaybookPackageIntegrity } from "./runtime";

const ISSUER = "https://www.citely.info";
const AUDIENCE = "stablecoin-policy";
const SUBJECT = "citely:playbook-service";
const TOKEN_TTL_SECONDS = 300;
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

type CreateRequest = {
  playbookId: string;
  profile: BusinessProfile;
};

type SmokeEntitlement =
  | { scope: "playbook:execute"; playbookId: string }
  | { scope: "playbook:read"; packageId: string };

export type CitelyPackageSmokeConfig = {
  baseUrl: string;
  keyId: string;
  privateKeyPem: string;
  request: CreateRequest;
  responseSchema: Record<string, unknown>;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
};

export type CitelyPackageSmokeResult = {
  baseUrl: string;
  packageId: string;
  schemaVersion: string;
  reviewStatus: string;
  capabilityCount: number;
  claimCount: number;
  retrievalStatus: string;
  checks: {
    create: 201;
    exactRetry: 200;
    changedRequestConflict: 409;
    wrongTarget: 403;
    wrongAudience: 401;
    expiredToken: 401;
    replay: 200;
    schemaValid: true;
    integrityValid: true;
    genericRenderReady: true;
  };
};

export async function runCitelyPackageSmoke(
  config: CitelyPackageSmokeConfig,
): Promise<CitelyPackageSmokeResult> {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  if (!OPAQUE_ID.test(config.keyId)) throw new Error("invalid Citely smoke key ID");
  if (!config.privateKeyPem.includes("PRIVATE KEY")) {
    throw new Error("invalid Citely smoke private key");
  }
  const privateKey = await importPKCS8(config.privateKeyPem, "EdDSA");
  const fetchImpl = config.fetchImpl ?? fetch;
  const now = config.now ?? (() => new Date());
  const timeoutMs = config.timeoutMs ?? 20_000;
  const idempotencyKey = `citely-smoke-${randomUUID()}`;
  const packageUrl = new URL("/v1/playbook-packages", baseUrl);
  const executeEntitlement: SmokeEntitlement = {
    scope: "playbook:execute",
    playbookId: config.request.playbookId,
  };

  const first = await postPackage({
    fetchImpl,
    url: packageUrl,
    token: await signToken(config, privateKey, executeEntitlement, now()),
    idempotencyKey,
    request: config.request,
    timeoutMs,
  });
  assertStatus(first, 201, "signed package creation");
  const created = await readArtifact(first, "signed package creation");
  assertArtifact(created, config.responseSchema);

  const retry = await postPackage({
    fetchImpl,
    url: packageUrl,
    token: await signToken(config, privateKey, executeEntitlement, now()),
    idempotencyKey,
    request: config.request,
    timeoutMs,
  });
  assertStatus(retry, 200, "exact idempotent retry");
  if (retry.headers.get("idempotency-replayed") !== "true") {
    throw new Error("exact idempotent retry omitted Idempotency-Replayed: true");
  }
  const retried = await readArtifact(retry, "exact idempotent retry");
  assertSameArtifact(created, retried, "exact idempotent retry");

  const changed = await postPackage({
    fetchImpl,
    url: packageUrl,
    token: await signToken(config, privateKey, executeEntitlement, now()),
    idempotencyKey,
    request: changedRequest(config.request),
    timeoutMs,
  });
  assertStatus(changed, 409, "changed request conflict");

  const wrongTarget = await postPackage({
    fetchImpl,
    url: packageUrl,
    token: await signToken(
      config,
      privateKey,
      {
        scope: "playbook:execute",
        playbookId: otherPlaybook(config.request.playbookId),
      },
      now(),
    ),
    idempotencyKey: `citely-smoke-${randomUUID()}`,
    request: config.request,
    timeoutMs,
  });
  assertStatus(wrongTarget, 403, "wrong-target entitlement");

  const wrongAudience = await postPackage({
    fetchImpl,
    url: packageUrl,
    token: await signToken(
      config,
      privateKey,
      executeEntitlement,
      now(),
      "wrong-policy-audience",
    ),
    idempotencyKey: `citely-smoke-${randomUUID()}`,
    request: config.request,
    timeoutMs,
  });
  assertStatus(wrongAudience, 401, "wrong-audience token");

  const expiredAt = new Date(now().getTime() - 10 * 60 * 1_000);
  const expiredToken = await postPackage({
    fetchImpl,
    url: packageUrl,
    token: await signToken(
      config,
      privateKey,
      executeEntitlement,
      expiredAt,
    ),
    idempotencyKey: `citely-smoke-${randomUUID()}`,
    request: config.request,
    timeoutMs,
  });
  assertStatus(expiredToken, 401, "expired token");

  const readToken = await signToken(
    config,
    privateKey,
    { scope: "playbook:read", packageId: created.package.packageId },
    now(),
  );
  const replay = await fetchImpl(
    new URL(
      `/v1/playbook-packages/${encodeURIComponent(created.package.packageId)}`,
      baseUrl,
    ),
    {
      headers: { authorization: `Bearer ${readToken}`, accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    },
  );
  assertStatus(replay, 200, "signed package replay");
  const replayed = await readArtifact(replay, "signed package replay");
  assertSameArtifact(created, replayed, "signed package replay");
  assertArtifact(replayed, config.responseSchema);

  return {
    baseUrl: baseUrl.toString(),
    packageId: created.package.packageId,
    schemaVersion: created.package.schemaVersion,
    reviewStatus: created.package.assurance.reviewStatus,
    capabilityCount: created.package.conclusions.length,
    claimCount: created.evidenceBundle.claims.length,
    retrievalStatus: created.evidenceBundle.retrieval.status,
    checks: {
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
    },
  };
}

async function signToken(
  config: CitelyPackageSmokeConfig,
  privateKey: CryptoKey,
  entitlement: SmokeEntitlement,
  issuedAt: Date,
  audience = AUDIENCE,
): Promise<string> {
  const issuedAtSeconds = Math.floor(issuedAt.getTime() / 1_000);
  return new SignJWT({
    entitlement: {
      id: `smoke-entitlement-${randomUUID()}`,
      domain: "stablecoin",
      ...entitlement,
    },
  })
    .setProtectedHeader({ alg: "EdDSA", typ: "JWT", kid: config.keyId })
    .setIssuer(ISSUER)
    .setAudience(audience)
    .setSubject(SUBJECT)
    .setJti(`smoke-token-${randomUUID()}`)
    .setIssuedAt(issuedAtSeconds)
    .setNotBefore(issuedAtSeconds)
    .setExpirationTime(issuedAtSeconds + TOKEN_TTL_SECONDS)
    .sign(privateKey);
}

async function postPackage(input: {
  fetchImpl: typeof fetch;
  url: URL;
  token: string;
  idempotencyKey: string;
  request: CreateRequest;
  timeoutMs: number;
}): Promise<Response> {
  return input.fetchImpl(input.url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.token}`,
      "content-type": "application/json",
      accept: "application/json",
      "idempotency-key": input.idempotencyKey,
    },
    body: JSON.stringify(input.request),
    cache: "no-store",
    signal: AbortSignal.timeout(input.timeoutMs),
  });
}

function changedRequest(request: CreateRequest): CreateRequest {
  return {
    ...request,
    profile: {
      ...request.profile,
      operatorJurisdiction: `${request.profile.operatorJurisdiction}-CONFLICT`,
    },
  };
}

function otherPlaybook(playbookId: string): string {
  return playbookId === "stablecoin-pre-listing"
    ? "business-model-regulatory-boundary"
    : "stablecoin-pre-listing";
}

function assertStatus(response: Response, expected: number, label: string): void {
  if (response.status !== expected) {
    throw new Error(`${label} returned ${response.status}; expected ${expected}`);
  }
  if (response.headers.get("cache-control") !== "no-store") {
    throw new Error(`${label} did not return Cache-Control: no-store`);
  }
}

async function readArtifact(
  response: Response,
  label: string,
): Promise<PlaybookPackageArtifact> {
  try {
    return await response.json() as PlaybookPackageArtifact;
  } catch {
    throw new Error(`${label} did not return a JSON artifact`);
  }
}

function assertArtifact(
  artifact: PlaybookPackageArtifact,
  responseSchema: Record<string, unknown>,
): void {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(responseSchema);
  if (!validate(artifact)) throw new Error("package response failed the v1 schema");
  if (!verifyPlaybookPackageIntegrity(artifact.package)) {
    throw new Error("package response failed integrity verification");
  }
  if (artifact.evidenceBundle.packageId !== artifact.package.packageId) {
    throw new Error("evidence bundle package ID does not match the package");
  }
  if (
    artifact.package.assurance.limitations.length === 0
    || artifact.package.assurance.counselTriggers.length === 0
    || artifact.package.conclusions.length === 0
  ) {
    throw new Error("package is missing generic-render legal posture fields");
  }
  const claims = new Set(
    artifact.evidenceBundle.claims.map((claim) => claim.claimId),
  );
  for (const conclusion of artifact.package.conclusions) {
    if (conclusion.actions.length === 0) {
      throw new Error("capability result is missing generic-render actions");
    }
    for (const claimId of conclusion.evidenceClaimIds) {
      if (!claims.has(claimId)) {
        throw new Error("capability result references an unresolved evidence claim");
      }
    }
  }
  for (const claim of artifact.evidenceBundle.claims) {
    if (claim.citations.length === 0) {
      throw new Error("evidence claim is missing a generic-render citation");
    }
  }
  if (
    artifact.evidenceBundle.retrieval.status !== "SUCCESS"
    && artifact.evidenceBundle.retrieval.limitations.length === 0
  ) {
    throw new Error("degraded retrieval is missing its visible limitation");
  }
}

function assertSameArtifact(
  expected: PlaybookPackageArtifact,
  actual: PlaybookPackageArtifact,
  label: string,
): void {
  if (replayChecksum(expected) !== replayChecksum(actual)) {
    throw new Error(`${label} did not return the exact immutable artifact`);
  }
}

function normalizeBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("CITELY_SMOKE_BASE_URL must be an absolute URL");
  }
  const localHttp = url.protocol === "http:"
    && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (url.protocol !== "https:" && !localHttp) {
    throw new Error("Citely smoke requires HTTPS except on localhost");
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("CITELY_SMOKE_BASE_URL must be an origin without credentials or a path");
  }
  return url;
}
