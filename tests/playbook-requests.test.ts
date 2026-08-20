import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020";
import {
  parseBusinessProfile,
  parseSupersedingEvaluationRequest,
} from "../lib/playbooks/requests";

const PROFILE = {
  operatorJurisdiction: "SG",
  targetJurisdiction: "EEA",
  activities: ["list-stablecoin"],
  asset: { symbol: "USDC", networks: ["Ethereum"] },
};

test("shared Business Profile parser preserves the strict existing intake", () => {
  assert.deepEqual(parseBusinessProfile(PROFILE), PROFILE);
  assert.equal(parseBusinessProfile({ ...PROFILE, customerId: "private" }), null);
  assert.equal(parseBusinessProfile({ ...PROFILE, targetJurisdiction: "US" }), null);
});

test("superseding requests require exact unique canonical delta IDs", () => {
  const first = "delta:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const second = "delta:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  assert.deepEqual(parseSupersedingEvaluationRequest({
    profile: PROFILE,
    deltaIds: [second, first],
  }), {
    profile: PROFILE,
    deltaIds: [first, second],
  });
  assert.equal(parseSupersedingEvaluationRequest({
    profile: PROFILE,
    deltaIds: [first, first],
  }), null);
  assert.equal(parseSupersedingEvaluationRequest({
    profile: PROFILE,
    deltaIds: [],
  }), null);
  assert.equal(parseSupersedingEvaluationRequest({
    profile: PROFILE,
    deltaIds: [first],
    customerId: "must-not-cross-domain-boundary",
  }), null);
});

test("superseding request JSON Schema accepts the wire contract and rejects extras", async () => {
  const schema = JSON.parse(await readFile(
    "contracts/v1/playbook-package-rerun-request.schema.json",
    "utf8",
  ));
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  const request = {
    profile: PROFILE,
    deltaIds: ["delta:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
  };
  assert.equal(validate(request), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...request, customerId: "private" }), false);
  assert.equal(validate({ ...request, deltaIds: [] }), false);
});
