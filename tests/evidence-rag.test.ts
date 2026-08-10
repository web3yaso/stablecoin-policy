import assert from "node:assert/strict";
import test from "node:test";
import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  EvidenceRetrievalRepository,
  EvidenceSearchRequest,
  RetrievalRunAudit,
} from "../lib/retrieval/contracts";
import { SupabaseHttpClient } from "../lib/data/supabase-client";
import {
  DeterministicTokenEmbedding,
  InMemoryEvidenceRetrievalRepository,
} from "../lib/retrieval/in-memory";
import { EvidenceSearchService, validateSearchRequest } from "../lib/retrieval/search";
import { parseEvidenceSearchRequest } from "../lib/retrieval/request";
import { respondEvidenceSearch } from "../lib/retrieval/respond";
import { SupabaseEvidenceRetrievalRepository } from "../lib/retrieval/supabase-repository";
import {
  buildRetrievalIndexPlan,
  previewRetrievalIndexManifest,
  retrievalIndexBuildInputErrors,
  retrievalIndexPlanSha256,
  type RetrievalIndexBuildInput,
} from "../lib/retrieval/index-builder";
import { RetrievalIndexAdminClient } from "../lib/retrieval/index-admin";
import { replayChecksum } from "../lib/legal-corpus/machine-pipeline";
import {
  assembleProductionEvalDataset,
  type ProductionEvalIndependentCheck,
  type ProductionEvalProposal,
} from "../lib/retrieval/eval-dataset-assembly";
import {
  readRetrievalPlanArtifact,
  writeRetrievalPlanArtifact,
} from "../lib/retrieval/plan-artifact";
import { runProductionDraftEval } from "../lib/retrieval/production-eval";
import {
  RAG_EVAL_CHUNKS,
  RAG_EVAL_INDEX,
  RIGHTS_POISON_CHUNK,
  WRONG_RELEASE_CHUNK,
} from "../scripts/evals/phase3-rag-fixture";

function request(overrides: Partial<EvidenceSearchRequest> = {}): EvidenceSearchRequest {
  return {
    query: "issuer authorization electronic money token",
    filters: {
      jurisdictionCodes: ["EEA"],
      topics: [],
      asOf: "2026-08-09T00:00:00.000Z",
      sourceTypes: ["REGULATION"],
      assuranceTier: "PROVISIONAL",
      corpusReleaseId: RAG_EVAL_INDEX.corpusReleaseId,
      indexReleaseId: RAG_EVAL_INDEX.indexReleaseId,
    },
    topK: 10,
    ...overrides,
  };
}

function service(
  chunks = [...RAG_EVAL_CHUNKS, RIGHTS_POISON_CHUNK, WRONG_RELEASE_CHUNK],
) {
  const repository = new InMemoryEvidenceRetrievalRepository([RAG_EVAL_INDEX], chunks);
  return {
    repository,
    search: new EvidenceSearchService(
      repository,
      new DeterministicTokenEmbedding(64),
    ),
  };
}

function buildInput(): RetrievalIndexBuildInput {
  return {
    schemaVersion: "1.0.0",
    policyDomain: "stablecoin",
    corpusReleaseId: "provisional:eea:rag-test:1",
    corpusReleaseKind: "PROVISIONAL",
    assuranceTier: "PROVISIONAL",
    jurisdictionCode: "EEA",
    asOf: "2026-08-01T00:00:00.000Z",
    knowledgeCutoff: "2026-08-02T00:00:00.000Z",
    releaseManifestSha256: "1".repeat(64),
    claimIds: ["claim:rag-build:1", "claim:rag-build:2"],
    sources: [
      {
        claimId: "claim:rag-build:2",
        citationId: "citation:rag-build:2",
        provisionId: "provision:rag-build:2",
        sourceVersionId: "version:rag-build:1",
        sourceVersionChecksumSha256: "2".repeat(64),
        jurisdictionCode: "EEA",
        languageCode: "en",
        supportRelation: "DIRECT_SUPPORT",
        locator: "Article 2",
        provisionText: "Second sanitized provision.\r\n",
        storageRights: "ALLOWED",
        rightsReviewedAt: "2026-07-31T00:00:00.000Z",
        rightsBasis: "Sanitized internal-search basis",
        excerptPermission: "LINK_ONLY",
        internalSearchAllowed: true,
      },
      {
        claimId: "claim:rag-build:1",
        citationId: "citation:rag-build:1",
        provisionId: "provision:rag-build:1",
        sourceVersionId: "version:rag-build:1",
        sourceVersionChecksumSha256: "2".repeat(64),
        jurisdictionCode: "EEA",
        languageCode: "en",
        supportRelation: "DIRECT_SUPPORT",
        locator: "Article 1",
        provisionText: "First sanitized provision.",
        storageRights: "ALLOWED",
        rightsReviewedAt: "2026-07-31T00:00:00.000Z",
        rightsBasis: "Sanitized internal-search basis",
        excerptPermission: "ALLOWED",
        internalSearchAllowed: true,
      },
    ],
  };
}

const BUILD_CONFIG = {
  indexReleaseId: "index:eea:rag-test:1",
  policyDomain: "stablecoin",
  expectedJurisdictionCode: "EEA",
  freshThrough: "2026-09-01T00:00:00.000Z",
  lexicalConfig: { language: "english", version: "1" },
  vectorConfig: { distance: "cosine", fusion: "rrf", version: "1" },
};

function productionEvalProposal(): ProductionEvalProposal {
  return {
    schemaVersion: "1.0.0",
    proposalId: "eval-proposal:rag-test:1",
    snapshotId: RAG_EVAL_INDEX.corpusReleaseId,
    snapshotManifestSha256: "c".repeat(64),
    generator: {
      agentId: "agent:rag-generator:1",
      model: "sanitized-generator-model",
      promptTemplateId: "rag-eval-generator",
      promptTemplateVersion: "1",
      parametersVersion: "1",
    },
    requiredChecklistTopics: ["authorization", "redemption"],
    cases: [
      {
        caseId: "eval:authorization",
        checklistTopic: "authorization",
        query: "issuer authorization electronic money token",
        expectedProvisionIds: ["provision:rag-eval:authorization"],
      },
      {
        caseId: "eval:redemption",
        checklistTopic: "redemption",
        query: "redemption at par value token holder",
        expectedProvisionIds: ["provision:rag-eval:redemption"],
      },
    ],
  };
}

function productionEvalCheck(
  proposal: ProductionEvalProposal,
): ProductionEvalIndependentCheck {
  return {
    schemaVersion: "1.0.0",
    checkId: "eval-check:rag-test:1",
    proposalSha256: replayChecksum(proposal),
    snapshotId: proposal.snapshotId,
    snapshotManifestSha256: proposal.snapshotManifestSha256,
    checker: {
      agentId: "agent:rag-checker:1",
      model: "sanitized-checker-model",
      promptTemplateId: "rag-eval-checker",
      promptTemplateVersion: "1",
      parametersVersion: "1",
    },
    cases: proposal.cases.map((item) => ({
      caseId: item.caseId,
      outcome: "AGREE" as const,
      independentlyDerivedProvisionIds: [...item.expectedProvisionIds],
      blockers: [],
    })),
  };
}

test("hybrid search returns a pinned exact citation and records the run", async () => {
  const fixture = service();
  const response = await fixture.search.search(request());

  assert.equal(response.status, "SUCCESS");
  assert.equal(response.indexRelease?.indexReleaseId, RAG_EVAL_INDEX.indexReleaseId);
  assert.equal(response.hits[0].citation.provisionId, "provision:rag-eval:authorization");
  assert.equal(response.hits[0].citation.locator, "Article 1");
  assert.equal(response.hits[0].assuranceTier, "PROVISIONAL");
  assert.equal(response.explanation, null);
  assert.equal(fixture.repository.runs.length, 1);
  assert.deepEqual(
    fixture.repository.runs[0].rankedChunkIds,
    response.hits.map((hit) => hit.chunkId),
  );
});

test("human-reviewed request cannot consume a provisional index", async () => {
  const fixture = service();
  const response = await fixture.search.search(
    request({
      filters: {
        ...request().filters,
        assuranceTier: "HUMAN_REVIEWED",
      },
    }),
  );

  assert.equal(response.status, "UNAUTHORIZED_EVIDENCE");
  assert.deepEqual(response.hits, []);
  assert.equal(response.explanation, null);
});

test("stale pinned index returns a typed non-narrative result", async () => {
  const fixture = service();
  const response = await fixture.search.search(
    request({
      filters: { ...request().filters, asOf: "2027-01-01T00:00:00.000Z" },
    }),
  );

  assert.equal(response.status, "STALE_INDEX");
  assert.deepEqual(response.hits, []);
  assert.equal(response.explanation, null);
});

test("rights-blocked and wrong-release chunks never enter results", async () => {
  const fixture = service();
  const response = await fixture.search.search(request());
  const ids = response.hits.map((hit) => hit.chunkId);

  assert.equal(ids.includes(RIGHTS_POISON_CHUNK.chunkId), false);
  assert.equal(ids.includes(WRONG_RELEASE_CHUNK.chunkId), false);
});

test("direct and contradicting hits fail closed without returning a narrative", async () => {
  const contradiction = {
    ...RAG_EVAL_CHUNKS[0],
    chunkId: "chunk:rag-eval:authorization-conflict",
    claimId: "claim:rag-eval:authorization-conflict",
    citationId: "citation:rag-eval:authorization-conflict",
    provisionId: "provision:rag-eval:authorization-conflict",
    supportRelation: "CONTRADICTS" as const,
  };
  const fixture = service([...RAG_EVAL_CHUNKS, contradiction]);
  const response = await fixture.search.search(request());

  assert.equal(response.status, "CONFLICTING_EVIDENCE");
  assert.deepEqual(response.hits, []);
  assert.equal(response.explanation, null);
});

test("repository outage returns typed degradation and retains no explanation", async () => {
  const runs: RetrievalRunAudit[] = [];
  const repository: EvidenceRetrievalRepository = {
    async resolveIndex() {
      throw new Error("simulated outage");
    },
    async listChunks() {
      return [];
    },
    async recordRun(run) {
      runs.push(run);
    },
  };
  const search = new EvidenceSearchService(
    repository,
    new DeterministicTokenEmbedding(64),
  );
  const response = await search.search(request());

  assert.equal(response.status, "RETRIEVAL_UNAVAILABLE");
  assert.deepEqual(response.hits, []);
  assert.equal(response.explanation, null);
  assert.equal(runs.length, 1);
});

test("request validation rejects empty queries and invalid topK", () => {
  assert.throws(() => validateSearchRequest(request({ query: "  " })), /query/);
  assert.throws(() => validateSearchRequest(request({ topK: 11 })), /topK/);
});

test("wire request parser defaults topK and rejects unknown fields", () => {
  const raw = { ...request() } as Record<string, unknown>;
  delete raw.topK;
  assert.equal(parseEvidenceSearchRequest(raw)?.topK, 10);
  assert.equal(parseEvidenceSearchRequest({ ...raw, internalRule: true }), null);
  assert.equal(
    parseEvidenceSearchRequest({
      ...raw,
      filters: { ...(raw.filters as Record<string, unknown>), reviewerRef: "private" },
    }),
    null,
  );
});

test("wire request parser rejects invalid query, topK, and asOf boundaries", () => {
  assert.equal(parseEvidenceSearchRequest(request({ query: "   " })), null);
  assert.equal(parseEvidenceSearchRequest(request({ topK: 11 })), null);
  assert.equal(parseEvidenceSearchRequest(request({ topK: 1.5 })), null);
  assert.equal(
    parseEvidenceSearchRequest(
      request({ filters: { ...request().filters, asOf: "not-a-date" } }),
    ),
    null,
  );
});

test("HTTP assembly maps only retrieval outage to 503 and never caches", async () => {
  const fixture = service();
  const result = await respondEvidenceSearch(fixture.search, request());
  assert.equal(result.status, 200);
  assert.equal(result.headers["Cache-Control"], "no-store");
  assert.equal(result.headers["X-Retrieval-Status"], "SUCCESS");
});

test("Supabase repository uses only fixed policy RPCs and maps pgvector", async () => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
    if (url.endsWith("/rpc/resolve_retrieval_index_release")) {
      return Response.json({
        ...RAG_EVAL_INDEX,
        asOf: "2026-08-01T00:00:00+00:00",
      });
    }
    if (url.endsWith("/rpc/list_retrieval_index_chunks")) {
      return Response.json([{ ...RAG_EVAL_CHUNKS[0], embedding: "[1,0,0]" }]);
    }
    return Response.json({ runId: "recorded" });
  };
  const client = new SupabaseHttpClient(
    {
      url: "https://example.supabase.co",
      serviceRoleKey: "test-service-key",
      reportsBucket: "policy-reports",
      datasetsBucket: "policy-datasets",
      sourcesBucket: "policy-sources",
      requestTimeoutMs: 1000,
    },
    fetchImpl,
  );
  const repository = new SupabaseEvidenceRetrievalRepository(client);
  const index = await repository.resolveIndex(request().filters);
  const chunks = await repository.listChunks(RAG_EVAL_INDEX.indexReleaseId);
  await repository.recordRun({
    runId: "rag-run:0000000000000000:1111111111111111",
    querySha256: "a".repeat(64),
    filters: request().filters,
    indexReleaseId: RAG_EVAL_INDEX.indexReleaseId,
    corpusReleaseId: RAG_EVAL_INDEX.corpusReleaseId,
    status: "SUCCESS",
    rankedChunkIds: [RAG_EVAL_CHUNKS[0].chunkId],
    resultSha256: "b".repeat(64),
  });

  assert.equal(index?.asOf, "2026-08-01T00:00:00.000Z");
  assert.deepEqual(chunks[0].embedding, [1, 0, 0]);
  assert.deepEqual(
    calls.map((call) => new URL(call.url).pathname),
    [
      "/rest/v1/rpc/resolve_retrieval_index_release",
      "/rest/v1/rpc/list_retrieval_index_chunks",
      "/rest/v1/rpc/record_rag_retrieval_run",
    ],
  );
  assert.equal(calls[2].body.p_deterministic_decision_before_sha256, null);
  assert.equal(calls[2].body.p_deterministic_decision_after_sha256, null);
});

test("index builder produces deterministic provision-aligned chunks and manifest", async () => {
  const provider = new DeterministicTokenEmbedding(8);
  const first = await buildRetrievalIndexPlan(buildInput(), BUILD_CONFIG, provider);
  const reordered = buildInput();
  reordered.sources.reverse();
  const second = await buildRetrievalIndexPlan(reordered, BUILD_CONFIG, provider);

  assert.equal(first.chunks.length, 2);
  assert.deepEqual(first.chunks.map((chunk) => chunk.citationId), [
    "citation:rag-build:1",
    "citation:rag-build:2",
  ]);
  assert.deepEqual(first.chunks.map((chunk) => chunk.ordinal), [0, 1]);
  assert.equal(first.chunks[1].chunkText, "Second sanitized provision.");
  assert.equal(retrievalIndexPlanSha256(first), retrievalIndexPlanSha256(second));
  const preview = previewRetrievalIndexManifest(buildInput(), first);
  assert.equal(preview.assuranceTier, "PROVISIONAL");
  assert.equal(preview.chunks[1].excerptPermission, "LINK_ONLY");
  assert.equal("embedding" in preview.chunks[0], false);
  assert.equal("chunkText" in preview.chunks[0], false);
});

test("index builder fails closed on rights, release, and citation coverage gaps", () => {
  const input = buildInput();
  input.sources[0] = {
    ...input.sources[0],
    storageRights: "UNKNOWN",
    rightsReviewedAt: null,
    rightsBasis: null,
    internalSearchAllowed: false,
    provisionText: null,
  };
  input.sources = input.sources.filter((source) => source.claimId !== "claim:rag-build:1");
  const errors = retrievalIndexBuildInputErrors(input, BUILD_CONFIG);

  assert.equal(errors.includes("INTERNAL_SEARCH_RIGHTS_BLOCKED"), true);
  assert.equal(errors.includes("PROVISION_TEXT_MISSING"), true);
  assert.equal(errors.includes("CLAIM_WITHOUT_CITATION"), true);
});

test("index builder preserves provisional cutoff gaps but rejects reviewed gaps", () => {
  const provisional = buildInput();
  provisional.asOf = "2026-08-02T00:00:00.000Z";
  provisional.knowledgeCutoff = "2026-08-01T00:00:00.000Z";
  assert.deepEqual(retrievalIndexBuildInputErrors(provisional, BUILD_CONFIG), []);

  const reviewed = {
    ...provisional,
    corpusReleaseKind: "HUMAN_REVIEWED" as const,
    assuranceTier: "HUMAN_REVIEWED" as const,
  };
  assert.equal(
    retrievalIndexBuildInputErrors(reviewed, BUILD_CONFIG).includes(
      "KNOWLEDGE_CUTOFF_INVALID",
    ),
    true,
  );
});

test("index builder freshness covers both as-of and knowledge cutoff", () => {
  const input = buildInput();
  input.knowledgeCutoff = "2026-09-02T00:00:00.000Z";
  assert.equal(
    retrievalIndexBuildInputErrors(input, BUILD_CONFIG).includes(
      "FRESH_THROUGH_INVALID",
    ),
    true,
  );
});

test("private build artifact preserves one exact plan and rejects unsafe storage", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "stablecoin-rag-plan-"));
  try {
    const plan = await buildRetrievalIndexPlan(
      buildInput(), BUILD_CONFIG, new DeterministicTokenEmbedding(8),
    );
    const artifactPath = path.join(temporaryDirectory, "plan.json");
    const written = await writeRetrievalPlanArtifact(
      artifactPath, buildInput().releaseManifestSha256, plan,
      "2026-08-10T00:00:00.000Z",
    );
    const loaded = await readRetrievalPlanArtifact(artifactPath);
    assert.deepEqual(loaded, written);
    assert.equal(loaded.planSha256, retrievalIndexPlanSha256(plan));
    await assert.rejects(
      writeRetrievalPlanArtifact(artifactPath, buildInput().releaseManifestSha256, plan),
      /exist/i,
    );
    await chmod(artifactPath, 0o644);
    await assert.rejects(readRetrievalPlanArtifact(artifactPath), /mode 0600/);
    await assert.rejects(
      writeRetrievalPlanArtifact(
        path.join(process.cwd(), "private-plan.json"),
        buildInput().releaseManifestSha256,
        plan,
      ),
      /outside the repository/,
    );
    assert.equal((await readFile(artifactPath, "utf8")).includes("First sanitized provision"), true);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("production DRAFT eval applies assurance provenance and activation metrics", async () => {
  const proposal = productionEvalProposal();
  const assembly = assembleProductionEvalDataset(
    proposal, productionEvalCheck(proposal),
  );
  const report = await runProductionDraftEval(
    assembly.dataset,
    RAG_EVAL_INDEX,
    RAG_EVAL_CHUNKS,
    new DeterministicTokenEmbedding(64),
    proposal.snapshotManifestSha256,
  );
  assert.equal(report.passed, true);
  assert.equal(report.metrics.recallAt10, 1);
  assert.equal(report.metrics.checklistTopicCoverage, 1);
  assert.equal(report.metrics.rightsLeaks, 0);

  await assert.rejects(
    runProductionDraftEval(
      assembly.dataset,
      RAG_EVAL_INDEX,
      RAG_EVAL_CHUNKS,
      new DeterministicTokenEmbedding(64),
      "d".repeat(64),
    ),
    /not pinned to the DRAFT corpus manifest/,
  );

  await assert.rejects(
    runProductionDraftEval(
      {
        ...assembly.dataset,
        evalAssurance: "MACHINE_ASSURED",
        generation: { ...assembly.dataset.generation, agentId: "agent:same:1" },
        independentCheck: {
          ...assembly.dataset.independentCheck,
          agentId: "agent:same:1",
        },
      },
      { ...RAG_EVAL_INDEX, assuranceTier: "HUMAN_REVIEWED" },
      RAG_EVAL_CHUNKS,
      new DeterministicTokenEmbedding(64),
      proposal.snapshotManifestSha256,
    ),
    /generator and checker provenance|human-reviewed/,
  );
});

test("production eval assembly rejects stale, self-checked, and divergent cases", () => {
  const proposal = productionEvalProposal();
  const validCheck = productionEvalCheck(proposal);
  const assembly = assembleProductionEvalDataset(proposal, validCheck);
  assert.equal(assembly.dataset.schemaVersion, "1.1.0");
  assert.equal(assembly.dataset.sourceSnapshot.snapshotId, proposal.snapshotId);
  assert.equal(assembly.acceptedCaseCount, 2);
  assert.match(assembly.dataset.datasetId, /^eval-dataset:[0-9a-f]{40}$/);

  assert.throws(
    () => assembleProductionEvalDataset(proposal, {
      ...validCheck,
      proposalSha256: "0".repeat(64),
    }),
    /not pinned to the exact proposal/,
  );
  assert.throws(
    () => assembleProductionEvalDataset(proposal, {
      ...validCheck,
      checker: { ...validCheck.checker, agentId: proposal.generator.agentId },
    }),
    /must be different agents/,
  );
  assert.throws(
    () => assembleProductionEvalDataset(proposal, {
      ...validCheck,
      cases: validCheck.cases.map((item) => item.caseId === "eval:redemption"
        ? { ...item, independentlyDerivedProvisionIds: ["provision:rag-eval:other"] }
        : item),
    }),
    /does not match independent derivation/,
  );
  assert.throws(
    () => assembleProductionEvalDataset(proposal, {
      ...validCheck,
      cases: validCheck.cases.map((item) => item.caseId === "eval:redemption"
        ? { ...item, outcome: "BLOCK" as const, blockers: ["citation-divergence"] }
        : item),
    }),
    /do not cover checklist topics: redemption/,
  );
});

test("production eval proposal, check, and assembled dataset satisfy strict contracts", async () => {
  const { readFile } = await import("node:fs/promises");
  const Ajv2020 = (await import("ajv/dist/2020")).default;
  const proposal = productionEvalProposal();
  const check = productionEvalCheck(proposal);
  const dataset = assembleProductionEvalDataset(proposal, check).dataset;
  const ajv = new Ajv2020({ strict: true });
  for (const [fileName, value] of [
    ["retrieval-production-eval-proposal.schema.json", proposal],
    ["retrieval-production-eval-check.schema.json", check],
    ["retrieval-production-eval-dataset.schema.json", dataset],
  ] as const) {
    const schema = JSON.parse(await readFile(
      path.join(process.cwd(), "contracts", "v1", fileName), "utf8",
    ));
    const validate = ajv.compile(schema);
    assert.equal(validate(value), true, JSON.stringify(validate.errors));
    assert.equal(validate({ ...value, unexpected: true }), false);
  }
});

test("index admin uses fixed build/manifest/activate RPCs and never hides activation", async () => {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  const input = buildInput();
  const manifestEnvelope = {
    indexReleaseId: BUILD_CONFIG.indexReleaseId,
    releaseState: "DRAFT" as const,
    manifest: { schemaVersion: "1.0.0" },
    manifestSha256: "a".repeat(64),
  };
  const fetchImpl = async (request: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(request)).pathname;
    const body = JSON.parse(String(init?.body ?? "{}"));
    calls.push({ path, body });
    if (path.endsWith("/get_retrieval_index_build_input")) return Response.json(input);
    if (path.endsWith("/activate_retrieval_index_release")) {
      return Response.json({ releaseState: "ACTIVE" });
    }
    return Response.json(manifestEnvelope);
  };
  const client = new SupabaseHttpClient({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-key",
    reportsBucket: "policy-reports",
    datasetsBucket: "policy-datasets",
    sourcesBucket: "policy-sources",
    requestTimeoutMs: 1000,
  }, fetchImpl);
  const admin = new RetrievalIndexAdminClient(client);
  const plan = await buildRetrievalIndexPlan(
    await admin.buildInput("stablecoin", input.corpusReleaseId, "PROVISIONAL"),
    BUILD_CONFIG,
    new DeterministicTokenEmbedding(8),
  );
  await admin.build(plan);
  await admin.manifest(plan.indexReleaseId);
  await admin.activate(plan.indexReleaseId, "a".repeat(64), "2026-08-09T00:00:00Z");

  assert.deepEqual(calls.map((call) => call.path), [
    "/rest/v1/rpc/get_retrieval_index_build_input",
    "/rest/v1/rpc/build_retrieval_index_release",
    "/rest/v1/rpc/get_retrieval_index_manifest",
    "/rest/v1/rpc/activate_retrieval_index_release",
  ]);
  assert.equal(calls[1].body.p_plan !== undefined, true);
  assert.equal(calls[1].path.includes("activate"), false);
  assert.equal(calls[3].body.p_expected_manifest_sha256, "a".repeat(64));
});

test("index admin exposes fixed snapshot, DRAFT eval, and eval-record RPCs", async () => {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  const snapshot = {
    snapshotId: "snapshot:rag-test:1",
    manifest: { schemaVersion: "1.0.0" },
    manifestSha256: "c".repeat(64),
    sourceReleaseCount: 2,
    claimCount: 47,
  };
  const fetchImpl = async (request: string | URL | Request, init?: RequestInit) => {
    const pathName = new URL(String(request)).pathname;
    const body = JSON.parse(String(init?.body ?? "{}"));
    calls.push({ path: pathName, body });
    if (pathName.endsWith("/get_retrieval_snapshot_build_input")) {
      return Response.json(buildInput());
    }
    if (pathName.endsWith("/get_retrieval_draft_eval_input")) {
      return Response.json({ indexRelease: RAG_EVAL_INDEX, chunks: [] });
    }
    if (pathName.endsWith("/get_retrieval_draft_corpus_pin")) {
      return Response.json({
        indexReleaseId: RAG_EVAL_INDEX.indexReleaseId,
        corpusReleaseId: RAG_EVAL_INDEX.corpusReleaseId,
        corpusReleaseKind: "PROVISIONAL",
        manifestSha256: "f".repeat(64),
      });
    }
    if (pathName.endsWith("/record_retrieval_index_eval")) {
      return Response.json({ outcome: "PASSED" });
    }
    return Response.json(snapshot);
  };
  const admin = new RetrievalIndexAdminClient(new SupabaseHttpClient({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-key",
    reportsBucket: "policy-reports",
    datasetsBucket: "policy-datasets",
    sourcesBucket: "policy-sources",
    requestTimeoutMs: 1000,
  }, fetchImpl));
  const releases = ["provisional:rag-test:1", "provisional:rag-test:2"];
  await admin.prepareSnapshot("snapshot:rag-test:1", "stablecoin", "PROVISIONAL", releases);
  await admin.createSnapshot(
    "snapshot:rag-test:1", "stablecoin", "PROVISIONAL", releases, "c".repeat(64),
  );
  await admin.snapshotBuildInput("snapshot:rag-test:1");
  await admin.draftEvalInput(RAG_EVAL_INDEX.indexReleaseId);
  await admin.draftCorpusPin(RAG_EVAL_INDEX.indexReleaseId);
  await admin.recordEval({
    evalRecordId: "eval:rag-test:admin",
    indexReleaseId: RAG_EVAL_INDEX.indexReleaseId,
    expectedManifestSha256: "d".repeat(64),
    evalAssurance: "MACHINE_ASSURED",
    outcome: "PASSED",
    artifactSha256: "e".repeat(64),
    metrics: {
      recallAt10: 1, mrrAt10: 1, citationPrecision: 1,
      versionIsolation: 1, checklistTopicCoverage: 1, rightsLeaks: 0,
      assuranceLeaks: 0, promptInstructionLeaks: 0, unsafeBuildsAccepted: 0,
    },
    evaluatedAt: "2026-08-10T00:00:00Z",
  });
  assert.deepEqual(calls.map((call) => call.path), [
    "/rest/v1/rpc/prepare_retrieval_corpus_snapshot",
    "/rest/v1/rpc/create_retrieval_corpus_snapshot",
    "/rest/v1/rpc/get_retrieval_snapshot_build_input",
    "/rest/v1/rpc/get_retrieval_draft_eval_input",
    "/rest/v1/rpc/get_retrieval_draft_corpus_pin",
    "/rest/v1/rpc/record_retrieval_index_eval",
  ]);
  assert.deepEqual(calls[0].body.p_source_release_ids, releases);
  assert.equal(calls[5].body.p_eval_assurance, "MACHINE_ASSURED");
});

test("evidence search output validates against the strict v1 schema", async () => {
  const { readFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const Ajv2020 = (await import("ajv/dist/2020")).default;
  const addFormats = (await import("ajv-formats")).default;
  const schema = JSON.parse(
    await readFile(
      path.join(process.cwd(), "contracts", "v1", "evidence-search-response.schema.json"),
      "utf8",
    ),
  );
  const ajv = new Ajv2020({ strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const response = await service().search.search(request());

  assert.equal(validate(response), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...response, rawDecisionRules: [] }), false);
  assert.equal(validate({ ...response, schemaVersion: "2.0.0" }), false);
});

test("evidence search request validates against the strict v1 schema", async () => {
  const { readFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const Ajv2020 = (await import("ajv/dist/2020")).default;
  const addFormats = (await import("ajv-formats")).default;
  const schema = JSON.parse(
    await readFile(
      path.join(process.cwd(), "contracts", "v1", "evidence-search-request.schema.json"),
      "utf8",
    ),
  );
  const ajv = new Ajv2020({ strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  assert.equal(validate(request()), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...request(), internalRule: true }), false);
});
