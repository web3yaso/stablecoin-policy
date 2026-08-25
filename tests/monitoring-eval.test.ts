import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020";
import {
  parseMonitoringEvalCase,
  runMonitoringEval,
  type MonitoringEvalCase,
} from "../lib/monitoring/eval";

test("monitoring eval meets the formal recall and critical-miss gates per scope", async () => {
  const cases = await loadCases();
  const report = runMonitoringEval(cases);

  assert.equal(report.caseCount, 12);
  assert.equal(report.knownAffectedPackageCount, 8);
  assert.equal(report.recalledPackageCount, 8);
  assert.equal(report.monitoringRecall, 1);
  assert.equal(report.criticalMissCount, 0);
  assert.equal(report.falsePositiveCount, 0);
  assert.equal(report.exactCaseAccuracy, 1);
  assert.equal(report.outcome, "PASSED");
  assert.equal(report.scopes.length, 2);
  assert.equal(report.scopes.every((scope) => scope.monitoringGatePassed), true);
  assert.equal(runMonitoringEval(cases).datasetId, report.datasetId);
});

test("monitoring eval fails closed on a critical miss or false positive", async () => {
  const cases = await loadCases();
  const critical = structuredClone(cases[0]);
  critical.watchlists.push({
    packageId: "package:stablecoin-pre-listing:bbbbbbbbbbbbbbbb",
    state: "ACTIVE",
    dependencyClaimIds: ["claim:eval:unrelated"],
  });
  critical.expectedAffectedPackageIds.push(
    "package:stablecoin-pre-listing:bbbbbbbbbbbbbbbb",
  );
  const criticalReport = runMonitoringEval([critical, ...cases.slice(1)]);
  assert.equal(criticalReport.outcome, "FAILED");
  assert.equal(criticalReport.criticalMissCount, 1);
  assert.ok(criticalReport.monitoringRecall < 0.95);

  const falsePositive = structuredClone(cases[3]);
  falsePositive.event.state = "PUBLISHED";
  const falsePositiveReport = runMonitoringEval([
    ...cases.slice(0, 3), falsePositive, ...cases.slice(4),
  ]);
  assert.equal(falsePositiveReport.outcome, "FAILED");
  assert.equal(falsePositiveReport.falsePositiveCount, 1);

  const vacuousReport = runMonitoringEval([cases[3]]);
  assert.equal(vacuousReport.monitoringRecall, 1);
  assert.equal(vacuousReport.knownAffectedPackageCount, 0);
  assert.equal(vacuousReport.scopes[0].monitoringGatePassed, false);
  assert.equal(vacuousReport.outcome, "FAILED");
});

test("monitoring eval cases and reports satisfy strict versioned schemas", async () => {
  const cases = await loadCases();
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const caseSchema = JSON.parse(await readFile(
    path.join(process.cwd(), "contracts/v1/monitoring-eval-case.schema.json"),
    "utf8",
  )) as object;
  const reportSchema = JSON.parse(await readFile(
    path.join(process.cwd(), "contracts/v1/monitoring-eval-report.schema.json"),
    "utf8",
  )) as object;
  const validateCase = ajv.compile(caseSchema);
  const validateReport = ajv.compile(reportSchema);

  for (const evalCase of cases) {
    assert.equal(validateCase(evalCase), true, JSON.stringify(validateCase.errors));
  }
  const report = runMonitoringEval(cases);
  assert.equal(validateReport(report), true, JSON.stringify(validateReport.errors));
  assert.equal(validateReport({ ...report, customerId: "private" }), false);
});

test("monitoring eval parser rejects expansion, duplicates, and cross-playbook packages", async () => {
  const [fixture] = await loadCases();
  assert.throws(
    () => parseMonitoringEvalCase({ ...fixture, customerId: "private" }),
    /shape/,
  );
  assert.throws(
    () => parseMonitoringEvalCase({
      ...fixture,
      event: { ...fixture.event, impacts: [fixture.event.impacts[0], fixture.event.impacts[0]] },
    }),
    /unique and canonical/,
  );
  assert.throws(
    () => parseMonitoringEvalCase({
      ...fixture,
      watchlists: [{
        ...fixture.watchlists[0],
        packageId: "package:business-model-regulatory-boundary:aaaaaaaaaaaaaaaa",
      }],
      expectedAffectedPackageIds: [
        "package:business-model-regulatory-boundary:aaaaaaaaaaaaaaaa",
      ],
    }),
    /package ID/,
  );
});

async function loadCases(): Promise<MonitoringEvalCase[]> {
  return (await readFile(
    path.join(process.cwd(), "evals/monitoring-events.jsonl"),
    "utf8",
  )).split("\n").filter(Boolean).map((line) =>
    parseMonitoringEvalCase(JSON.parse(line) as unknown));
}
