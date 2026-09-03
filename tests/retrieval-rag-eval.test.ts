import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020";
import {
  runRetrievalRagEval,
  type RetrievalRagEvalCase,
} from "../lib/playbooks/retrieval-rag-eval";
import type { EvidenceSearchResponse } from "../lib/retrieval/contracts";
import {
  RAG_EVAL_CHUNKS,
  RAG_EVAL_INDEX,
  RIGHTS_POISON_CHUNK,
  WRONG_RELEASE_CHUNK,
} from "../scripts/evals/phase3-rag-fixture";
import {
  buildRetrievalRagEvalCases,
  buildRetrievalRagEvalReport,
  executeRetrievalRagEvalCase,
} from "../scripts/evals/run-phase5-retrieval-rag";

test("retrieval/RAG fixtures pass every metric for both exact scopes", async () => {
  const report = await buildRetrievalRagEvalReport();

  assert.equal(report.caseCount, 16);
  assert.equal(report.outcome, "PASSED");
  assert.equal(report.scopes.length, 2);
  assert.equal(report.scopes.every((scope) => scope.retrievalRagGatePassed), true);
  assert.equal(report.results.every((result) => result.exactMatch), true);
  assert.equal((await buildRetrievalRagEvalReport()).datasetId, report.datasetId);
  assert.deepEqual(report.scopes.map((scope) => scope.scopeId), [
    "eea:generic:business-model-regulatory-boundary",
    "eea:usdc:stablecoin-pre-listing",
  ]);
  assert.equal(report.results.filter(
    (result) => result.actualStatus === "SUCCESS",
  ).every((result) => result.firstExpectedRank === 1), true);
  assert.equal(report.results.filter(
    (result) => result.actualStatus !== "SUCCESS",
  ).every((result) => result.firstExpectedRank === null), true);
});

test("malformed expectations and duplicate case IDs fail closed", async () => {
  const evalCase = await caseById("retrieval:boundary:authorization");
  await assert.rejects(
    run([evalCase, structuredClone(evalCase)]),
    /valid and unique/,
  );
  await assert.rejects(
    run([{ ...evalCase, expectedStatus: "STALE_INDEX" }]),
    /expectations do not match/,
  );
  await assert.rejects(
    run([{ ...evalCase, expectedProvisionId: null }]),
    /expectations do not match/,
  );
});

test("ranking, citation, filter, and release drift fail their exact metrics", async () => {
  const evalCase = await caseById("retrieval:boundary:authorization");

  const missing = await run([evalCase], async (item) => {
    const response = await executeRetrievalRagEvalCase(item);
    return { ...response, hits: [] };
  });
  assert.equal(missing.scopes[0].recallAt10, 0);
  assert.equal(missing.scopes[0].mrrAt10, 0);
  assert.equal(missing.scopes[0].citationPrecision, 0);

  const citation = await run([evalCase], async (item) => {
    const response = structuredClone(await executeRetrievalRagEvalCase(item));
    response.hits[0].citation.locator = "Drifted locator";
    return response;
  });
  assert.equal(citation.results[0].citationIntegrityValid, false);

  const filter = await run([evalCase], async (item) => {
    const response = structuredClone(await executeRetrievalRagEvalCase(item));
    response.hits[0].jurisdictionCode = "SG";
    return response;
  });
  assert.equal(filter.results[0].structuredFiltersValid, false);

  const release = await run([evalCase], async (item) => {
    const response = structuredClone(await executeRetrievalRagEvalCase(item));
    assert.ok(response.indexRelease);
    response.indexRelease.corpusReleaseId = "provisional:wrong:release";
    return response;
  });
  assert.equal(release.results[0].versionIsolationValid, false);
});

test("unsafe degraded hits, narrative output, and prompt authority fail closed", async () => {
  const degraded = await caseById("retrieval:boundary:unauthorized");
  const success = await executeRetrievalRagEvalCase(
    await caseById("retrieval:boundary:authorization"),
  );
  const leaked = await run([degraded], async () => ({
    ...structuredClone(success),
    status: "UNAUTHORIZED_EVIDENCE",
  }));
  assert.equal(leaked.results[0].safeDegradationValid, false);
  assert.equal(leaked.outcome, "FAILED");

  const successCase = await caseById("retrieval:boundary:authorization");
  const narrative = await run([successCase], async (item) => {
    const response = await executeRetrievalRagEvalCase(item);
    return { ...response, explanation: "unverified narrative" } as unknown as EvidenceSearchResponse;
  });
  assert.equal(narrative.results[0].nonNarrativeSafe, false);

  const poisoned = await run([successCase], async (item) => {
    const response = structuredClone(await executeRetrievalRagEvalCase(item));
    response.hits[0].chunkId = RIGHTS_POISON_CHUNK.chunkId;
    return response;
  });
  assert.equal(poisoned.results[0].unauthorizedAuthorityUseCount, 1);
  assert.equal(poisoned.outcome, "FAILED");
});

test("retrieval replay drift fails independently of ranking quality", async () => {
  const evalCase = await caseById("retrieval:boundary:authorization");
  let calls = 0;
  const report = await run([evalCase], async (item) => {
    const call = ++calls;
    const response = structuredClone(await executeRetrievalRagEvalCase(item));
    if (call === 2) response.limitations.push("drifted repeated result");
    return response;
  });

  assert.equal(report.results[0].firstExpectedRank, 1);
  assert.equal(report.results[0].repeatedRunExactMatch, false);
  assert.equal(report.scopes[0].repeatedRunExactMatchRate, 0);
  assert.equal(report.outcome, "FAILED");
});

test("report satisfies its strict schema and contains no eval or evidence content", async () => {
  const report = await buildRetrievalRagEvalReport();
  const schema = JSON.parse(await readFile(
    path.join(process.cwd(), "contracts/v1/retrieval-rag-eval-report.schema.json"),
    "utf8",
  )) as object;
  const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);

  assert.equal(validate(report), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...report, rawQuery: "private" }), false);
  const serialized = JSON.stringify(report);
  for (const forbidden of [
    "issuer authorization for", "provision:rag-eval", "canonicalUrl", "excerpt",
    "proposition", "example.europa.eu", "customerId", "prompt",
  ]) assert.equal(serialized.includes(forbidden), false, forbidden);

  const caseSchema = JSON.parse(await readFile(
    path.join(process.cwd(), "contracts/v1/retrieval-rag-eval-case.schema.json"),
    "utf8",
  )) as object;
  const validateCase = new Ajv2020({ strict: true, allErrors: true }).compile(caseSchema);
  const firstCase = JSON.parse((await readFile(
    path.join(process.cwd(), "evals/playbook-retrieval-rag.jsonl"),
    "utf8",
  )).split("\n")[0]) as Record<string, unknown>;
  assert.equal(validateCase(firstCase), true, JSON.stringify(validateCase.errors));
  assert.equal(validateCase({ ...firstCase, rawPrompt: "private" }), false);
});

async function caseById(caseId: string): Promise<RetrievalRagEvalCase> {
  const evalCase = (await buildRetrievalRagEvalCases()).find(
    (candidate) => candidate.caseId === caseId,
  );
  assert.ok(evalCase);
  return evalCase;
}

async function run(
  cases: RetrievalRagEvalCase[],
  searchCase: (evalCase: RetrievalRagEvalCase) => Promise<EvidenceSearchResponse> =
    executeRetrievalRagEvalCase,
) {
  return runRetrievalRagEval(cases, {
    index: RAG_EVAL_INDEX,
    chunks: [...RAG_EVAL_CHUNKS, RIGHTS_POISON_CHUNK, WRONG_RELEASE_CHUNK],
    searchCase,
  });
}
