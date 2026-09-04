import assert from "node:assert/strict";
import test from "node:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { exportPKCS8, exportSPKI, generateKeyPair } from "jose";
import { authenticateCitelyService, isCitelyEntitled } from "../lib/auth/citely-service";
import { runCitelyEvidenceSmoke, parseEvidenceSmokeCase, type EvidenceSmokeCase } from "../lib/retrieval/citely-smoke";
import { readEvidenceSmokeCaseFile, runEvidenceSmokeCommand } from "../lib/retrieval/smoke-command";
import { EvidenceSearchService } from "../lib/retrieval/search";
import { respondEvidenceSearch } from "../lib/retrieval/respond";
import { DeterministicTokenEmbedding, InMemoryEvidenceRetrievalRepository } from "../lib/retrieval/in-memory";
import type { EvidenceSearchResponse } from "../lib/retrieval/contracts";
import { RAG_EVAL_CHUNKS, RAG_EVAL_INDEX } from "../scripts/evals/phase3-rag-fixture";

function smokeCase(): EvidenceSmokeCase {
  return {
    schemaVersion: "1.0.0", mode: "ACTIVE", expectedIndex: structuredClone(RAG_EVAL_INDEX),
    request: { query: "issuer authorization electronic money token", topK: 10, filters: {
      jurisdictionCodes: ["EEA"], topics: [], sourceTypes: ["REGULATION"],
      assuranceTier: "PROVISIONAL", asOf: "2026-09-04T00:00:00.000Z",
      indexReleaseId: null, corpusReleaseId: null,
    } },
    expectedCitations: RAG_EVAL_CHUNKS.map(chunk => ({
      chunkId: chunk.chunkId, claimId: chunk.claimId, citationId: chunk.citationId,
      provisionId: chunk.provisionId, sourceVersionId: chunk.sourceVersionId,
      sourceVersionChecksumSha256: chunk.sourceVersionChecksumSha256,
    })),
    requiredProvisionIds: [RAG_EVAL_CHUNKS[0].provisionId],
  };
}

async function fixture(options: {
  unavailable?: boolean;
  change?: (response: Response, count: number) => Promise<Response>;
} = {}) {
  const { publicKey, privateKey } = await generateKeyPair("EdDSA", { extractable: true });
  const keyId = "evidence-smoke-test-key";
  const now = () => new Date("2026-09-04T01:00:00.000Z");
  const env = { CITELY_REQUIRE_SIGNED_SERVICE_TOKEN: "1",
    CITELY_SERVICE_PUBLIC_KEYS_JSON: JSON.stringify({ [keyId]: await exportSPKI(publicKey) }) };
  const repository = new InMemoryEvidenceRetrievalRepository(options.unavailable ? [] : [RAG_EVAL_INDEX], RAG_EVAL_CHUNKS);
  const service = new EvidenceSearchService(repository, new DeterministicTokenEmbedding(64));
  let calls = 0;
  let retrievals = 0;
  const problem = (status: number, error: string) => Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
  const fetchImpl: typeof fetch = async (url, init) => {
    calls++;
    assert.equal(String(url), "https://policy.example.test/v1/evidence/search");
    assert.equal(init?.method, "POST");
    assert.equal(init?.redirect, "error");
    assert.equal(init?.cache, "no-store");
    assert.ok(init?.signal);
    let response: Response;
    let principal;
    try {
      principal = await authenticateCitelyService({
        authorization: new Headers(init.headers).get("authorization"), env, now: now(),
      });
    } catch { response = problem(401, "unauthorized"); }
    if (principal) {
      if (!isCitelyEntitled(principal, { scope: "evidence:search" })) response = problem(403, "entitlement-denied");
      else {
        retrievals++;
        const result = await respondEvidenceSearch(service, JSON.parse(String(init.body)));
        response = Response.json(result.body, { status: result.status, headers: result.headers });
      }
    }
    return options.change ? options.change(response!, calls) : response!;
  };
  const input = smokeCase();
  if (options.unavailable) input.mode = "UNAVAILABLE";
  return { config: { baseUrl: "https://policy.example.test", keyId, privateKeyPem: await exportPKCS8(privateKey),
    smokeCase: input, fetchImpl, now }, calls: () => calls, retrievals: () => retrievals };
}

test("signed ACTIVE smoke uses real auth and deterministic retrieval, then tests stale denial", async () => {
  const f = await fixture();
  const result = await runCitelyEvidenceSmoke(f.config);
  assert.equal(result.passed, true);
  assert.equal(result.productionActivationAuthorized, false);
  assert.equal(result.checks.length, 7);
  assert.equal(f.calls(), 7);
  assert.equal(f.retrievals(), 3);
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes(f.config.privateKeyPem));
  assert.ok(!serialized.includes(f.config.smokeCase.request.query));
  assert.ok(!serialized.includes(RAG_EVAL_CHUNKS[0].proposition));
});

test("UNAVAILABLE smoke requires default and explicit target denial", async () => {
  const f = await fixture({ unavailable: true });
  const result = await runCitelyEvidenceSmoke(f.config);
  assert.equal(result.hitCount, 0);
  assert.equal(f.calls(), 6);
  assert.equal(f.retrievals(), 2);
});

const badResponses: Array<[string, (body: EvidenceSearchResponse) => void]> = [
  ["unknown response field", body => Object.assign(body, { privateQuery: "SECRET" })],
  ["unsupported schema version", body => Object.assign(body, { schemaVersion: "2.0.0" })],
  ["narrative", body => Object.assign(body, { explanation: "SECRET" })],
  ["query mismatch", body => { body.querySha256 = "f".repeat(64); }],
  ["index mismatch", body => { body.indexRelease!.indexReleaseId = "index:wrong"; }],
  ["corpus mismatch", body => { body.indexRelease!.corpusReleaseId = "corpus:wrong"; }],
  ["model mismatch", body => { body.indexRelease!.embeddingModel = "wrong"; }],
  ["empty success", body => { body.hits = []; }],
  ["duplicate hits", body => { body.hits = [body.hits[0], body.hits[0]]; }],
  ["unexpected claim", body => { body.hits[0].claim.claimId = "claim:wrong"; }],
  ["unexpected provision", body => { body.hits[0].citation.provisionId = "provision:wrong"; }],
  ["wrong source version", body => { body.hits[0].citation.sourceVersionId = "version:wrong"; }],
  ["wrong checksum", body => { body.hits[0].citation.sourceVersionChecksumSha256 = "b".repeat(64); }],
  ["cross jurisdiction", body => { body.hits[0].jurisdictionCode = "SG"; }],
  ["cross source type", body => { body.hits[0].citation.sourceType = "BLOG"; }],
  ["assurance upgrade", body => { body.hits[0].reviewStatus = "HUMAN_REVIEWED"; }],
  ["future provision", body => { body.hits[0].effectiveFrom = "2027-01-01T00:00:00Z"; }],
  ["expired provision", body => { body.hits[0].effectiveTo = "2026-01-01T00:00:00Z"; }],
  ["excerpt rights", body => { body.hits[0].citation.excerptPermission = "LINK_ONLY"; }],
  ["missing required provision", body => { body.hits = body.hits.filter(hit => hit.citation.provisionId !== RAG_EVAL_CHUNKS[0].provisionId).map((hit, i) => ({ ...hit, rank: i + 1 })); }],
];
for (const [label, mutate] of badResponses) {
  test(`smoke rejects ${label}`, async () => {
    const f = await fixture({ change: async (response, count) => {
      if (count !== 5) return response;
      const body = await response.json() as EvidenceSearchResponse;
      mutate(body);
      return Response.json(body, { status: response.status, headers: response.headers });
    } });
    await assert.rejects(runCitelyEvidenceSmoke(f.config), error => {
      assert.ok(error instanceof Error);
      assert.ok(!error.message.includes("SECRET"));
      return true;
    });
    assert.equal(f.calls(), 5);
  });
}

for (const count of [1, 2, 3, 4]) {
  test(`unexpected auth response ${count} stops before retrieval`, async () => {
    const f = await fixture({ change: async (response, i) => i === count
      ? Response.json({ SECRET: "leak" }, { status: 200, headers: { "cache-control": "no-store" } }) : response });
    await assert.rejects(runCitelyEvidenceSmoke(f.config), /unexpected HTTP/);
    assert.equal(f.calls(), count);
    assert.equal(f.retrievals(), 0);
  });
}

for (const bad of ["problem", "pinned-index", "stale-hits", "cache", "header", "json", "redirect", "drift"] as const) {
  test(`smoke rejects ${bad} false positive`, async () => {
    const unavailable = bad === "problem" || bad === "pinned-index";
    const f = await fixture({ unavailable, change: async (response, count) => {
      const target = bad === "stale-hits" ? 7 : bad === "drift" ? 6 : 5;
      if (count !== target) return response;
      if (bad === "problem") return Response.json({ error: "unavailable" }, { status: 503, headers: response.headers });
      if (bad === "json") return new Response("SECRET", { status: 200, headers: response.headers });
      const body = await response.json() as EvidenceSearchResponse;
      const headers = new Headers(response.headers);
      if (bad === "pinned-index") body.indexRelease = RAG_EVAL_INDEX;
      if (bad === "stale-hits") body.hits = [{}] as EvidenceSearchResponse["hits"];
      if (bad === "cache") headers.set("cache-control", "public");
      if (bad === "header") headers.set("x-retrieval-status", "SUCCESS-WRONG");
      if (bad === "drift") body.hits[0].score += 0.1;
      const result = Response.json(body, { status: response.status, headers });
      if (bad === "redirect") Object.defineProperty(result, "redirected", { value: true });
      return result;
    } });
    await assert.rejects(runCitelyEvidenceSmoke(f.config));
  });
}

test("transport exceptions never echo tokens or response text", async () => {
  const f = await fixture();
  f.config.fetchImpl = async () => { throw new Error(`SECRET ${f.config.privateKeyPem}`); };
  await assert.rejects(runCitelyEvidenceSmoke(f.config), /^Error: unsigned: transport failed \(details suppressed\)$/);
});

test("a working default denial cannot hide a successful explicitly pinned lookup", async () => {
  const f = await fixture({ unavailable: true, change: async (response, count) => count === 6
    ? Response.json({ status: "SUCCESS" }, { status: 200, headers: response.headers }) : response });
  await assert.rejects(runCitelyEvidenceSmoke(f.config), /pinned-search: unexpected HTTP/);
  assert.equal(f.calls(), 6);
});

test("auth rejection body cannot contain extra private content", async () => {
  const f = await fixture({ change: async (response, count) => count === 1
    ? Response.json({ error: "unauthorized", token: "SECRET" }, { status: 401, headers: response.headers }) : response });
  await assert.rejects(runCitelyEvidenceSmoke(f.config), /invalid rejection envelope/);
  assert.equal(f.retrievals(), 0);
});

test("topic filtering is verified independently of citation membership", async () => {
  const f = await fixture({ change: async (response, count) => {
    if (count !== 5) return response;
    const body = await response.json() as EvidenceSearchResponse;
    body.hits[0].claim.topic = "unrequested-topic";
    return Response.json(body, { status: response.status, headers: response.headers });
  } });
  f.config.smokeCase.request.filters.topics = [RAG_EVAL_CHUNKS[0].topic];
  await assert.rejects(runCitelyEvidenceSmoke(f.config), /violates filters/);
});

test("case validation rejects unsafe origins, incomplete pins, stale input and bad limits without fetch", async () => {
  const f = await fixture();
  for (const baseUrl of ["http://remote.test", "https://user:pass@example.test", "https://example.test/path", "https://example.test/?secret=1", "not a url"]) {
    await assert.rejects(runCitelyEvidenceSmoke({ ...f.config, baseUrl }));
  }
  for (const value of [null, { ...smokeCase(), schemaVersion: "2" }, { ...smokeCase(), requiredProvisionIds: [] },
    { ...smokeCase(), expectedCitations: [] }, { ...smokeCase(), expectedCitations: [smokeCase().expectedCitations[0], smokeCase().expectedCitations[0]] }]) {
    assert.throws(() => parseEvidenceSmokeCase(value));
  }
  const stale = smokeCase(); stale.request.filters.asOf = "2027-01-01T00:00:00Z";
  assert.throws(() => parseEvidenceSmokeCase(stale));
  const pinned = smokeCase(); pinned.request.filters.indexReleaseId = RAG_EVAL_INDEX.indexReleaseId;
  assert.throws(() => parseEvidenceSmokeCase(pinned));
  await assert.rejects(runCitelyEvidenceSmoke({ ...f.config, timeoutMs: 0 }));
  await assert.rejects(runCitelyEvidenceSmoke({ ...f.config, privateKeyPem: "SECRET" }), /invalid evidence smoke signing key/);
  assert.equal(f.calls(), 0);
});

test("command defaults to no-network preview and requires explicit execution and private external file", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "citely-rag-smoke-test-"));
  const file = path.join(directory, "case.json");
  try {
    await writeFile(file, JSON.stringify(smokeCase()), { mode: 0o600 });
    const env = { CITELY_SMOKE_BASE_URL: "https://policy.example.test", CITELY_RAG_SMOKE_CASE_PATH: file };
    let called = false;
    const run: typeof runCitelyEvidenceSmoke = async () => { called = true; throw new Error("execute reached"); };
    const result = await runEvidenceSmokeCommand([], env, run);
    assert.equal(result.mode, "DRY_RUN");
    assert.equal(called, false);
    await assert.rejects(runEvidenceSmokeCommand(["--execute"], env, run), /SIGNING_KEY_ID/);
    await assert.rejects(runEvidenceSmokeCommand(["--execute", "--execute"], env, run), /only optional/);
    await assert.rejects(runEvidenceSmokeCommand(["--execute"], { ...env,
      CITELY_SERVICE_SIGNING_KEY_ID: "test-key", CITELY_SERVICE_PRIVATE_KEY_PEM: "test-key" }, run), /execute reached/);
    assert.equal(called, true);
    await chmod(file, 0o644);
    await assert.rejects(readEvidenceSmokeCaseFile(file), /mode-0600/);
    await assert.rejects(readEvidenceSmokeCaseFile("relative.json"), /absolute/);
    await assert.rejects(readEvidenceSmokeCaseFile(path.join(process.cwd(), "package.json")), /outside/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
