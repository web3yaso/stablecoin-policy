import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020";
import {
  runDeterministicRuleActionEval,
  type DeterministicRuleActionEvalCase,
} from "../lib/playbooks/deterministic-rule-action-eval";
import { evaluatePlaybook } from "../lib/playbooks/runtime";
import {
  buildDeterministicRuleActionEvalCases,
  buildDeterministicRuleActionEvalReport,
} from "../scripts/evals/run-phase5-deterministic";

test("deterministic rule/action fixtures pass every metric for both exact scopes", async () => {
  const report = await buildDeterministicRuleActionEvalReport();

  assert.equal(report.caseCount, 11);
  assert.equal(report.outcome, "PASSED");
  assert.equal(report.scopes.length, 2);
  assert.equal(report.scopes.every(
    (scope) => scope.deterministicRuleActionGatePassed,
  ), true);
  assert.equal(report.results.every((result) => result.exactMatch), true);
  assert.equal((await buildDeterministicRuleActionEvalReport()).datasetId, report.datasetId);
  assert.deepEqual(report.scopes.map((scope) => scope.scopeId), [
    "eea:generic:business-model-regulatory-boundary",
    "eea:usdc:stablecoin-pre-listing",
  ]);
});

test("expectation drift and duplicate case IDs fail closed", async () => {
  const evalCase = await caseById("deterministic:boundary-issue-emt-fresh");
  const drifted: DeterministicRuleActionEvalCase = {
    ...evalCase,
    expected: { ...evalCase.expected, conclusion: "PERMITTED" },
  };
  const report = await runDeterministicRuleActionEval([drifted]);
  assert.equal(report.outcome, "FAILED");
  assert.equal(report.results[0].statusReasonExactMatch, false);

  await assert.rejects(
    runDeterministicRuleActionEval([evalCase, structuredClone(evalCase)]),
    /valid and unique/,
  );
});

test("nondeterminism and a RAG-dependent decision each fail their exact metric", async () => {
  const evalCase = await caseById("deterministic:boundary-issue-emt-fresh");
  let repeatedCalls = 0;
  const nondeterministic: typeof evaluatePlaybook = (...args) => {
    repeatedCalls += 1;
    const output = structuredClone(evaluatePlaybook(...args));
    if (repeatedCalls === 2) output[0].title = `${output[0].title} drift`;
    return output;
  };
  const repeatedReport = await runDeterministicRuleActionEval(
    [evalCase],
    nondeterministic,
  );
  assert.equal(repeatedReport.results[0].repeatedRunExactMatch, false);

  let ragCalls = 0;
  const ragDependent: typeof evaluatePlaybook = (...args) => {
    ragCalls += 1;
    const output = structuredClone(evaluatePlaybook(...args));
    if (ragCalls >= 3) output[0].reasonCodes.push("RAG_CHANGED_DECISION");
    return output;
  };
  const ragReport = await runDeterministicRuleActionEval([evalCase], ragDependent);
  assert.equal(ragReport.results[0].ragIsolationValid, false);
});

test("unsafe degraded actions and ungrounded material actions fail closed", async () => {
  const degraded = await caseById("deterministic:boundary-missing-evidence");
  const unsafe: typeof evaluatePlaybook = (...args) => {
    const output = structuredClone(evaluatePlaybook(...args));
    output[0].actions = ["Proceed without direct evidence."];
    return output;
  };
  const unsafeReport = await runDeterministicRuleActionEval([degraded], unsafe);
  assert.equal(unsafeReport.results[0].safeDegradationValid, false);
  assert.equal(unsafeReport.results[0].materialActionGroundingValid, false);

  const material = await caseById("deterministic:boundary-issue-emt-fresh");
  const ungrounded: typeof evaluatePlaybook = (...args) => {
    const output = structuredClone(evaluatePlaybook(...args));
    output[0].evidenceClaimIds = [];
    return output;
  };
  const ungroundedReport = await runDeterministicRuleActionEval([material], ungrounded);
  assert.equal(ungroundedReport.results[0].materialActionGroundingValid, false);
});

test("report satisfies its strict schema and contains hashes, not eval inputs", async () => {
  const report = await buildDeterministicRuleActionEvalReport();
  const schema = JSON.parse(await readFile(
    path.join(
      process.cwd(),
      "contracts/v1/deterministic-rule-action-eval-report.schema.json",
    ),
    "utf8",
  )) as object;
  const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);

  assert.equal(validate(report), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...report, rawProfile: { customerId: "private" } }), false);
  const serialized = JSON.stringify(report);
  for (const forbidden of [
    "operatorJurisdiction", "activities", "proposition", "canonicalUrl",
    "contractAddress", "rawDecisionRules",
  ]) assert.equal(serialized.includes(forbidden), false, forbidden);

  const caseSchema = JSON.parse(await readFile(
    path.join(
      process.cwd(),
      "contracts/v1/deterministic-rule-action-eval-case.schema.json",
    ),
    "utf8",
  )) as object;
  const validateCase = new Ajv2020({ strict: true, allErrors: true }).compile(caseSchema);
  const firstCase = JSON.parse((await readFile(
    path.join(process.cwd(), "evals/playbook-actions.jsonl"),
    "utf8",
  )).split("\n")[0]) as Record<string, unknown>;
  assert.equal(validateCase(firstCase), true, JSON.stringify(validateCase.errors));
  assert.equal(validateCase({ ...firstCase, rawProfile: { customerId: "private" } }), false);
});

async function caseById(caseId: string): Promise<DeterministicRuleActionEvalCase> {
  const evalCase = (await buildDeterministicRuleActionEvalCases()).find(
    (candidate) => candidate.caseId === caseId,
  );
  assert.ok(evalCase);
  return evalCase;
}
