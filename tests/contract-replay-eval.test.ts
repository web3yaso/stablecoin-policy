import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020";
import {
  runContractReplayEval,
  type ContractReplayEvalCase,
} from "../lib/playbooks/contract-replay-eval";
import { buildContractReplayEvalReport } from "../scripts/evals/run-phase5-contract-replay";

test("committed Citely fixtures pass contract and exact replay gates per scope", async () => {
  const report = await buildContractReplayEvalReport();

  assert.equal(report.caseCount, 2);
  assert.equal(report.scopes.length, 2);
  assert.equal(report.outcome, "PASSED");
  assert.equal(report.scopes.every((scope) => scope.contractReplayGatePassed), true);
  assert.equal(report.results.every((result) => result.exactMatch), true);
  assert.equal((await buildContractReplayEvalReport()).datasetId, report.datasetId);
  assert.deepEqual(report.scopes.map((scope) => scope.scopeId), [
    "eea:generic:business-model-regulatory-boundary",
    "eea:usdc:stablecoin-pre-listing",
  ]);
});

test("contract replay eval fails closed on drift, integrity, and scope mismatches", async () => {
  const base = await fixtureCase();

  const replayDrift = runContractReplayEval([{
    ...base,
    replayedResponseJson: `${base.replayedResponseJson}\n`,
  }], permissiveValidators());
  assert.equal(replayDrift.outcome, "FAILED");
  assert.equal(replayDrift.results[0].replayExactMatch, false);

  const response = JSON.parse(base.committedResponseJson) as {
    package: { evaluatedAt: string };
  };
  response.package.evaluatedAt = "2026-08-12T12:00:00.001Z";
  const tampered = `${JSON.stringify(response, null, 2)}\n`;
  const badIntegrity = runContractReplayEval([{
    ...base,
    committedResponseJson: tampered,
    replayedResponseJson: tampered,
  }], permissiveValidators());
  assert.equal(badIntegrity.outcome, "FAILED");
  assert.equal(badIntegrity.results[0].packageIntegrityValid, false);

  const wrongScope = runContractReplayEval([{
    ...base,
    scope: { ...base.scope, assetId: "usdt" },
  }], permissiveValidators());
  assert.equal(wrongScope.outcome, "FAILED");
  assert.equal(wrongScope.results[0].referentialIntegrityValid, false);

  const request = JSON.parse(base.committedRequestJson) as {
    profile: { operatorJurisdiction: string };
  };
  request.profile.operatorJurisdiction = "CA";
  const changedRequest = `${JSON.stringify(request, null, 2)}\n`;
  const staleProfileBinding = runContractReplayEval([{
    ...base,
    committedRequestJson: changedRequest,
    replayedRequestJson: changedRequest,
  }], permissiveValidators());
  assert.equal(staleProfileBinding.outcome, "FAILED");
  assert.equal(staleProfileBinding.results[0].referentialIntegrityValid, false);
});

test("malformed JSON and schema rejection produce report failures, not partial success", async () => {
  const base = await fixtureCase();
  const malformed = runContractReplayEval([{
    ...base,
    committedRequestJson: "{",
    replayedRequestJson: "{",
  }], permissiveValidators());
  assert.equal(malformed.outcome, "FAILED");
  assert.equal(malformed.results[0].requestContractValid, false);
  assert.equal(malformed.results[0].referentialIntegrityValid, false);

  const rejected = runContractReplayEval([base], {
    request: () => true,
    response: () => false,
  });
  assert.equal(rejected.outcome, "FAILED");
  assert.equal(rejected.results[0].responseContractValid, false);
});

test("contract replay report satisfies its schema and contains hashes, not artifacts", async () => {
  const report = await buildContractReplayEvalReport();
  const schema = JSON.parse(await readFile(
    path.join(process.cwd(), "contracts/v1/contract-replay-eval-report.schema.json"),
    "utf8",
  )) as object;
  const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);

  assert.equal(validate(report), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...report, rawProfile: { customerId: "private" } }), false);
  const serialized = JSON.stringify(report);
  for (const forbidden of [
    "operatorJurisdiction", "activities", "networks", "proposition",
    "canonicalUrl", "rawDecisionRules",
  ]) assert.equal(serialized.includes(forbidden), false, forbidden);
});

async function fixtureCase(): Promise<ContractReplayEvalCase> {
  const slug = "stablecoin-pre-listing-success";
  const request = await readFile(
    path.join(process.cwd(), `contracts/fixtures/citely/v1/${slug}.request.json`),
    "utf8",
  );
  const response = await readFile(
    path.join(process.cwd(), `contracts/fixtures/citely/v1/${slug}.response.json`),
    "utf8",
  );
  return {
    caseId: "contract-replay:test-pre-listing",
    scope: {
      jurisdictionCode: "EEA",
      assetId: "usdc",
      playbookId: "stablecoin-pre-listing",
    },
    committedRequestJson: request,
    committedResponseJson: response,
    replayedRequestJson: request,
    replayedResponseJson: response,
  };
}

function permissiveValidators() {
  return { request: () => true, response: () => true };
}
