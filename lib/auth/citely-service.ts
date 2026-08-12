import { timingSafeEqual } from "node:crypto";
import {
  decodeProtectedHeader,
  importSPKI,
  jwtVerify,
  type JWTPayload,
} from "jose";

const ISSUER = "https://www.citely.info";
const AUDIENCE = "stablecoin-policy";
const SUBJECT = "citely:playbook-service";
const MAX_TOKEN_AGE_SECONDS = 300;
const CLOCK_TOLERANCE_SECONDS = 30;
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const PLAYBOOK_ID = /^[a-z0-9][a-z0-9-]{2,80}$/;
const PACKAGE_ID = /^package:[a-z0-9-]+:[0-9a-f]{16}$/;
type CitelyAuthEnv = Record<string, string | undefined>;

export type CitelyServiceScope =
  | "playbook:execute"
  | "playbook:read"
  | "evidence:search";

export type CitelyServicePrincipal = {
  mode: "SIGNED" | "LEGACY";
  subject: string;
  tokenId: string | null;
  entitlementId: string | null;
  scope: CitelyServiceScope | null;
  playbookId: string | null;
  packageId: string | null;
  expiresAt: string | null;
};

export type CitelyEntitlementRequirement =
  | { scope: "playbook:execute"; playbookId: string }
  | { scope: "playbook:read"; packageId: string }
  | { scope: "evidence:search" };

export class CitelyServiceAuthConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CitelyServiceAuthConfigurationError";
  }
}

export class CitelyServiceAuthenticationError extends Error {
  constructor() {
    super("invalid Citely service authentication");
    this.name = "CitelyServiceAuthenticationError";
  }
}

export async function authenticateCitelyService(input: {
  authorization: string | null;
  legacySecret?: string | null;
  env?: CitelyAuthEnv;
  now?: Date;
}): Promise<CitelyServicePrincipal> {
  const env = input.env ?? process.env;
  const requireSigned = readBoolean(env.CITELY_REQUIRE_SIGNED_SERVICE_TOKEN);
  const publicKeys = await readPublicKeys(env.CITELY_SERVICE_PUBLIC_KEYS_JSON);
  const legacySecret = input.legacySecret?.trim() ?? "";
  const legacyAvailable = !requireSigned && legacySecret.length > 0;
  if (requireSigned && publicKeys.size === 0) {
    throw new CitelyServiceAuthConfigurationError(
      "signed Citely service authentication is required but no public keys are configured",
    );
  }
  if (publicKeys.size === 0 && !legacyAvailable) {
    throw new CitelyServiceAuthConfigurationError(
      "Citely service authentication is not configured",
    );
  }

  const token = readBearerToken(input.authorization);
  if (token === null) throw new CitelyServiceAuthenticationError();
  if (token.split(".").length === 3) {
    if (publicKeys.size === 0) throw new CitelyServiceAuthenticationError();
    return verifySignedToken(token, publicKeys, input.now ?? new Date());
  }
  if (!legacyAvailable || !constantTimeEqual(token, legacySecret)) {
    throw new CitelyServiceAuthenticationError();
  }
  return {
    mode: "LEGACY",
    subject: "legacy:citely-service",
    tokenId: null,
    entitlementId: null,
    scope: null,
    playbookId: null,
    packageId: null,
    expiresAt: null,
  };
}

export function isCitelyEntitled(
  principal: CitelyServicePrincipal,
  requirement: CitelyEntitlementRequirement,
): boolean {
  if (principal.mode === "LEGACY") return true;
  if (principal.scope !== requirement.scope) return false;
  if (requirement.scope === "playbook:execute") {
    return principal.playbookId === requirement.playbookId
      && principal.packageId === null;
  }
  if (requirement.scope === "playbook:read") {
    return principal.packageId === requirement.packageId;
  }
  return principal.playbookId === null && principal.packageId === null;
}

async function verifySignedToken(
  token: string,
  publicKeys: Map<string, CryptoKey>,
  now: Date,
): Promise<CitelyServicePrincipal> {
  try {
    const header = decodeProtectedHeader(token);
    if (
      !hasOnlyKeys(header, ["alg", "typ", "kid"])
      || header.alg !== "EdDSA"
      || header.typ !== "JWT"
      || typeof header.kid !== "string"
      || !OPAQUE_ID.test(header.kid)
    ) {
      throw new CitelyServiceAuthenticationError();
    }
    const key = publicKeys.get(header.kid);
    if (!key) throw new CitelyServiceAuthenticationError();
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["EdDSA"],
      issuer: ISSUER,
      audience: AUDIENCE,
      subject: SUBJECT,
      currentDate: now,
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
      maxTokenAge: MAX_TOKEN_AGE_SECONDS,
      requiredClaims: ["iss", "aud", "sub", "iat", "nbf", "exp", "jti"],
    });
    if (payload.iss !== ISSUER || payload.aud !== AUDIENCE || payload.sub !== SUBJECT) {
      throw new CitelyServiceAuthenticationError();
    }
    return parseSignedPrincipal(payload, now);
  } catch (error: unknown) {
    if (error instanceof CitelyServiceAuthenticationError) throw error;
    throw new CitelyServiceAuthenticationError();
  }
}

function parseSignedPrincipal(
  payload: JWTPayload,
  now: Date,
): CitelyServicePrincipal {
  if (
    !hasOnlyKeys(payload, [
      "iss", "aud", "sub", "iat", "nbf", "exp", "jti", "entitlement",
    ])
    || typeof payload.iat !== "number"
    || !Number.isSafeInteger(payload.iat)
    || typeof payload.nbf !== "number"
    || !Number.isSafeInteger(payload.nbf)
    || typeof payload.exp !== "number"
    || !Number.isSafeInteger(payload.exp)
    || typeof payload.jti !== "string"
    || !OPAQUE_ID.test(payload.jti)
    || payload.exp <= payload.iat
    || payload.nbf > payload.exp
    || payload.exp - payload.iat > MAX_TOKEN_AGE_SECONDS
    || Math.abs(payload.nbf - payload.iat) > CLOCK_TOLERANCE_SECONDS
    || payload.iat > Math.floor(now.getTime() / 1_000) + CLOCK_TOLERANCE_SECONDS
  ) {
    throw new CitelyServiceAuthenticationError();
  }
  const entitlement = payload.entitlement;
  if (!isRecord(entitlement)) throw new CitelyServiceAuthenticationError();
  const id = entitlement.id;
  const domain = entitlement.domain;
  const scope = entitlement.scope;
  const playbookId = entitlement.playbookId ?? null;
  const packageId = entitlement.packageId ?? null;
  if (
    !hasOnlyKeys(entitlement, ["id", "domain", "scope", "playbookId", "packageId"])
    || typeof id !== "string"
    || !OPAQUE_ID.test(id)
    || domain !== "stablecoin"
    || !isScope(scope)
    || (playbookId !== null
      && (typeof playbookId !== "string" || !PLAYBOOK_ID.test(playbookId)))
    || (packageId !== null
      && (typeof packageId !== "string" || !PACKAGE_ID.test(packageId)))
  ) {
    throw new CitelyServiceAuthenticationError();
  }
  if (
    (scope === "playbook:execute" && (playbookId === null || packageId !== null))
    || (scope === "playbook:read" && (packageId === null || playbookId !== null))
    || (scope === "evidence:search" && (playbookId !== null || packageId !== null))
  ) {
    throw new CitelyServiceAuthenticationError();
  }
  return {
    mode: "SIGNED",
    subject: SUBJECT,
    tokenId: payload.jti,
    entitlementId: id,
    scope,
    playbookId,
    packageId,
    expiresAt: new Date(payload.exp * 1_000).toISOString(),
  };
}

async function readPublicKeys(raw: string | undefined): Promise<Map<string, CryptoKey>> {
  const keys = new Map<string, CryptoKey>();
  if (!raw?.trim()) return keys;
  if (raw.length > 64_000) {
    throw new CitelyServiceAuthConfigurationError(
      "CITELY_SERVICE_PUBLIC_KEYS_JSON is too large",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CitelyServiceAuthConfigurationError(
      "CITELY_SERVICE_PUBLIC_KEYS_JSON is not valid JSON",
    );
  }
  if (
    !isRecord(parsed)
    || Object.keys(parsed).length === 0
    || Object.keys(parsed).length > 10
  ) {
    throw new CitelyServiceAuthConfigurationError(
      "CITELY_SERVICE_PUBLIC_KEYS_JSON must contain at least one key",
    );
  }
  for (const [kid, pem] of Object.entries(parsed)) {
    if (!OPAQUE_ID.test(kid) || typeof pem !== "string" || !pem.includes("PUBLIC KEY")) {
      throw new CitelyServiceAuthConfigurationError(
        "CITELY_SERVICE_PUBLIC_KEYS_JSON contains an invalid key",
      );
    }
    try {
      keys.set(kid, await importSPKI(pem, "EdDSA"));
    } catch {
      throw new CitelyServiceAuthConfigurationError(
        "CITELY_SERVICE_PUBLIC_KEYS_JSON contains an invalid Ed25519 public key",
      );
    }
  }
  return keys;
}

function readBearerToken(value: string | null): string | null {
  if (!value?.startsWith("Bearer ")) return null;
  const token = value.slice(7);
  if (!token || token.length > 8_192 || /\s/.test(token)) return null;
  return token;
}

function readBoolean(value: string | undefined): boolean {
  if (value === undefined || value.trim() === "" || value === "0") return false;
  if (value === "1") return true;
  throw new CitelyServiceAuthConfigurationError(
    "CITELY_REQUIRE_SIGNED_SERVICE_TOKEN must be 0 or 1",
  );
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length
    && timingSafeEqual(leftBytes, rightBytes);
}

function isScope(value: unknown): value is CitelyServiceScope {
  return value === "playbook:execute"
    || value === "playbook:read"
    || value === "evidence:search";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: object, allowed: string[]): boolean {
  const allowlist = new Set(allowed);
  return Object.keys(value).every((key) => allowlist.has(key));
}
