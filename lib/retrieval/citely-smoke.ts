import { createHash, randomUUID } from "node:crypto";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { importPKCS8, SignJWT } from "jose";
import requestSchema from "../../contracts/v1/evidence-search-request.schema.json";
import responseSchema from "../../contracts/v1/evidence-search-response.schema.json";
import { replayChecksum } from "../legal-corpus/machine-pipeline";
import type { EvidenceSearchRequest, EvidenceSearchResponse, RetrievalIndexRelease } from "./contracts";
import { parseEvidenceSearchRequest } from "./request";

type CitationPin = {
  chunkId: string;
  claimId: string;
  citationId: string;
  provisionId: string;
  sourceVersionId: string;
  sourceVersionChecksumSha256: string;
};
export type EvidenceSmokeCase = {
  schemaVersion: "1.0.0";
  mode: "ACTIVE" | "UNAVAILABLE";
  request: EvidenceSearchRequest;
  expectedIndex: RetrievalIndexRelease;
  expectedCitations: CitationPin[];
  requiredProvisionIds: string[];
};

const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);
ajv.addSchema(requestSchema);
ajv.addSchema(responseSchema);
const validateResponse = ajv.compile<EvidenceSearchResponse>(responseSchema);
const stringId = { type: "string", minLength: 3, maxLength: 201 };
const validateCase = ajv.compile<EvidenceSmokeCase>({
  type: "object", additionalProperties: false,
  required: ["schemaVersion", "mode", "request", "expectedIndex", "expectedCitations", "requiredProvisionIds"],
  properties: {
    schemaVersion: { const: "1.0.0" }, mode: { enum: ["ACTIVE", "UNAVAILABLE"] },
    request: { $ref: requestSchema.$id },
    expectedIndex: { $ref: `${responseSchema.$id}#/$defs/indexRelease` },
    expectedCitations: { type: "array", maxItems: 1000, items: {
      type: "object", additionalProperties: false,
      required: ["chunkId", "claimId", "citationId", "provisionId", "sourceVersionId", "sourceVersionChecksumSha256"],
      properties: {
        chunkId: stringId, claimId: stringId, citationId: stringId,
        provisionId: stringId, sourceVersionId: stringId,
        sourceVersionChecksumSha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
      },
    } },
    requiredProvisionIds: { type: "array", maxItems: 10, uniqueItems: true, items: stringId },
  },
});

/** The case is trusted operator input, never inferred from the endpoint under test. */
export function parseEvidenceSmokeCase(value: unknown): EvidenceSmokeCase {
  if (!validateCase(value)) throw new Error("invalid evidence smoke case contract");
  const request = parseEvidenceSearchRequest(value.request);
  if (!request || request.filters.indexReleaseId !== null || request.filters.corpusReleaseId !== null
    || request.filters.assuranceTier !== value.expectedIndex.assuranceTier
    || Date.parse(request.filters.asOf) > Date.parse(value.expectedIndex.freshThrough)) {
    throw new Error("evidence smoke case must use unpinned, tier-matched, non-stale base filters");
  }
  const chunkIds = new Set(value.expectedCitations.map(pin => pin.chunkId));
  if (chunkIds.size !== value.expectedCitations.length
    || value.requiredProvisionIds.length > request.topK
    || value.requiredProvisionIds.some(id => !value.expectedCitations.some(pin => pin.provisionId === id))
    || (value.mode === "ACTIVE" && value.requiredProvisionIds.length === 0)) {
    throw new Error("evidence smoke case has incomplete or duplicate citation expectations");
  }
  return { ...structuredClone(value), request: structuredClone(request) };
}

export function evidenceSmokeOrigin(input: string): URL {
  let url: URL;
  try { url = new URL(input); } catch { throw new Error("invalid evidence smoke origin"); }
  const local = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
  if ((!local && url.protocol !== "https:") || url.username || url.password
    || url.pathname !== "/" || url.search || url.hash) throw new Error("invalid evidence smoke origin");
  return url;
}

export async function runCitelyEvidenceSmoke(config: {
  baseUrl: string;
  keyId: string;
  privateKeyPem: string;
  smokeCase: unknown;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
}) {
  const base = evidenceSmokeOrigin(config.baseUrl);
  const smoke = parseEvidenceSmokeCase(config.smokeCase);
  const timeoutMs = config.timeoutMs ?? 20_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new Error("invalid evidence smoke timeout");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(config.keyId)) {
    throw new Error("invalid evidence smoke key ID");
  }
  let key: CryptoKey;
  try { key = await importPKCS8(config.privateKeyPem, "EdDSA"); }
  catch { throw new Error("invalid evidence smoke signing key"); }
  const now = config.now ?? (() => new Date());
  const fetchImpl = config.fetchImpl ?? fetch;
  const checks: string[] = [];
  async function token(kind: "valid" | "scope" | "audience" | "expired" = "valid") {
    const time = Math.floor(now().getTime() / 1000) - (kind === "expired" ? 600 : 0);
    const entitlement = kind === "scope"
      ? { scope: "playbook:execute", playbookId: "stablecoin-pre-listing" }
      : { scope: "evidence:search" };
    return new SignJWT({ entitlement: { id: `smoke-entitlement-${randomUUID()}`, domain: "stablecoin", ...entitlement } })
      .setProtectedHeader({ alg: "EdDSA", typ: "JWT", kid: config.keyId })
      .setIssuer("https://www.citely.info").setSubject("citely:playbook-service")
      .setAudience(kind === "audience" ? "wrong-policy-audience" : "stablecoin-policy")
      .setJti(`smoke-token-${randomUUID()}`).setIssuedAt(time).setNotBefore(time)
      .setExpirationTime(time + 300).sign(key);
  }
  async function post(label: string, request: EvidenceSearchRequest, bearer: string | null, status: number) {
    let response: Response;
    try {
      response = await fetchImpl(new URL("/v1/evidence/search", base), {
        method: "POST", redirect: "error", cache: "no-store",
        headers: { accept: "application/json", "content-type": "application/json",
          ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
        body: JSON.stringify(request), signal: AbortSignal.timeout(timeoutMs),
      });
    } catch { throw new Error(`${label}: transport failed (details suppressed)`); }
    if (response.status !== status) throw new Error(`${label}: unexpected HTTP status ${response.status}`);
    if (response.redirected || response.headers.get("cache-control") !== "no-store") {
      throw new Error(`${label}: unsafe redirect or cache policy`);
    }
    let body: unknown;
    try { body = await response.json(); }
    catch { throw new Error(`${label}: invalid JSON response`); }
    return { response, body };
  }
  // Negative checks first: a broken auth boundary never progresses to billable searches.
  for (const [label, kind, status, error] of [
    ["unsigned", null, 401, "unauthorized"],
    ["wrong-scope", "scope", 403, "entitlement-denied"],
    ["wrong-audience", "audience", 401, "unauthorized"],
    ["expired-token", "expired", 401, "unauthorized"],
  ] as const) {
    const { body } = await post(label, smoke.request, kind ? await token(kind) : null, status);
    if (replayChecksum(body) !== replayChecksum({ error })) throw new Error(`${label}: invalid rejection envelope`);
    checks.push(label);
  }
  const pinned = { ...smoke.request, filters: { ...smoke.request.filters,
    indexReleaseId: smoke.expectedIndex.indexReleaseId, corpusReleaseId: smoke.expectedIndex.corpusReleaseId } };
  async function search(label: string, request: EvidenceSearchRequest, expected: "SUCCESS" | "STALE_INDEX" | "RETRIEVAL_UNAVAILABLE") {
    const { response, body } = await post(label, request, await token(), expected === "RETRIEVAL_UNAVAILABLE" ? 503 : 200);
    if (!validateResponse(body)) throw new Error(`${label}: invalid evidence response contract`);
    if (body.status !== expected || body.querySha256 !== createHash("sha256").update(request.query).digest("hex")
      || response.headers.get("x-retrieval-status") !== expected
      || response.headers.get("x-evidence-assurance") !== request.filters.assuranceTier) {
      throw new Error(`${label}: response status, query, or assurance mismatch`);
    }
    if (expected === "RETRIEVAL_UNAVAILABLE") {
      if (body.indexRelease !== null || body.hits.length !== 0) throw new Error(`${label}: unavailable evidence leaked`);
    } else {
      if (replayChecksum(body.indexRelease) !== replayChecksum(smoke.expectedIndex)) {
        throw new Error(`${label}: index metadata differs from operator pin`);
      }
      if (expected === "STALE_INDEX" && body.hits.length !== 0) throw new Error(`${label}: stale evidence leaked`);
      if (expected === "SUCCESS") assertHits(body, smoke);
    }
    checks.push(label);
    return body;
  }
  const outcome = smoke.mode === "ACTIVE" ? "SUCCESS" : "RETRIEVAL_UNAVAILABLE";
  const first = await search("default-search", smoke.request, outcome);
  const second = await search("pinned-search", pinned, outcome);
  if (smoke.mode === "ACTIVE") {
    if (replayChecksum(first.hits) !== replayChecksum(second.hits)) throw new Error("pinned-search: retrieval drift");
    const stale = new Date(Date.parse(smoke.expectedIndex.freshThrough) + 1000).toISOString();
    await search("stale-search", { ...pinned, filters: { ...pinned.filters, asOf: stale } }, "STALE_INDEX");
  }
  return { schemaVersion: "1.0.0", baseUrl: base.origin, mode: smoke.mode,
    checkedAt: now().toISOString(), caseSha256: replayChecksum(smoke),
    hitCount: first.hits.length, checks, passed: true, productionActivationAuthorized: false };
}

function assertHits(body: EvidenceSearchResponse, smoke: EvidenceSmokeCase) {
  const { filters, topK } = smoke.request;
  const at = Date.parse(filters.asOf);
  if (body.hits.length === 0 || body.hits.length > topK
    || new Set(body.hits.map(hit => hit.chunkId)).size !== body.hits.length) throw new Error("success: invalid hit count");
  for (const [i, hit] of body.hits.entries()) {
    const pin = smoke.expectedCitations.find(item => item.chunkId === hit.chunkId);
    if (!pin || pin.claimId !== hit.claim.claimId || pin.citationId !== hit.citation.citationId
      || pin.provisionId !== hit.citation.provisionId || pin.sourceVersionId !== hit.citation.sourceVersionId
      || pin.sourceVersionChecksumSha256 !== hit.citation.sourceVersionChecksumSha256) {
      throw new Error("success: unrecognized citation/version membership");
    }
    if (hit.rank !== i + 1 || hit.assuranceTier !== filters.assuranceTier || hit.reviewStatus !== hit.assuranceTier
      || (filters.jurisdictionCodes.length > 0 && !filters.jurisdictionCodes.includes(hit.jurisdictionCode))
      || (filters.topics.length > 0 && !filters.topics.includes(hit.claim.topic))
      || (filters.sourceTypes.length > 0 && !filters.sourceTypes.includes(hit.citation.sourceType))
      || Date.parse(hit.effectiveFrom) > at || (hit.effectiveTo !== null && Date.parse(hit.effectiveTo) <= at)
      || (hit.citation.excerptPermission === "LINK_ONLY" && hit.citation.excerpt !== null)) {
      throw new Error("success: evidence violates filters, assurance, or excerpt rights");
    }
  }
  if (smoke.requiredProvisionIds.some(id => !body.hits.some(hit => hit.citation.provisionId === id))) {
    throw new Error("success: required provision missing");
  }
}
