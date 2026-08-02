import assert from "node:assert/strict";
import test from "node:test";
import {
  MachineAssuranceClient,
  machineAssuranceCanAdvance,
  machineAssuranceInputErrors,
  type MachineAssuranceChecks,
  type MachineAssuranceRecordInput,
} from "../lib/legal-corpus/machine-assurance";
import { SupabaseHttpClient, type FetchLike } from "../lib/data/supabase-client";

const HEX64 = "a".repeat(64);

function passingChecks(
  overrides: Partial<MachineAssuranceChecks> = {},
): MachineAssuranceChecks {
  return {
    contradiction: "PASS",
    freshness: "PASS",
    rights: "PASS",
    jurisdiction: "PASS",
    effectiveDates: "PASS",
    citationLocator: "PASS",
    ...overrides,
  };
}

function sourceValidatedInput(
  overrides: Partial<MachineAssuranceRecordInput> = {},
): MachineAssuranceRecordInput {
  return {
    recordId: "assurance:eu:mica:v1:validate",
    subjectType: "SOURCE_VERSION",
    subjectId: "document:eu:fixture:en:abc123",
    assuranceLevel: "SOURCE_VALIDATED",
    sourceVersionFingerprint: HEX64,
    claimFingerprint: null,
    model: null,
    promptTemplateId: null,
    promptTemplateVersion: null,
    parametersVersion: null,
    confidence: null,
    checks: passingChecks({
      contradiction: "NOT_EVALUATED",
      jurisdiction: "NOT_EVALUATED",
      effectiveDates: "NOT_EVALUATED",
    }),
    inputChecksumSha256: HEX64,
    outputChecksumSha256: HEX64,
    blockers: [],
    limitations: [],
    ...overrides,
  };
}

function aiExtractedInput(
  overrides: Partial<MachineAssuranceRecordInput> = {},
): MachineAssuranceRecordInput {
  return {
    ...sourceValidatedInput(),
    recordId: "assurance:eu:mica:claim1:extract",
    subjectType: "CLAIM_DRAFT",
    subjectId: "claim:eu:fixture:1",
    assuranceLevel: "AI_EXTRACTED",
    claimFingerprint: "b".repeat(64),
    model: "gpt-5.6-terra",
    promptTemplateId: "claim-extraction",
    promptTemplateVersion: "1.0.0",
    parametersVersion: "1.0.0",
    confidence: 0.9,
    checks: passingChecks(),
    ...overrides,
  };
}

test("deterministic and model-backed records validate with level-appropriate fields", () => {
  assert.deepEqual(machineAssuranceInputErrors(sourceValidatedInput()), []);
  assert.deepEqual(machineAssuranceInputErrors(aiExtractedInput()), []);
});

test("AI levels require model, prompt template, parameters version, and confidence", () => {
  for (const gap of [
    { model: null },
    { promptTemplateId: null },
    { promptTemplateVersion: null },
    { parametersVersion: null },
    { confidence: null },
  ] as const) {
    const errors = machineAssuranceInputErrors(aiExtractedInput(gap));
    assert.ok(
      errors.includes("model_provenance_missing"),
      `expected model_provenance_missing for ${JSON.stringify(gap)}`,
    );
  }
});

test("deterministic SOURCE_VALIDATED records must not carry model provenance", () => {
  const errors = machineAssuranceInputErrors(
    sourceValidatedInput({ model: "gpt-5.6-terra", confidence: 0.5 }),
  );
  assert.ok(errors.includes("model_provenance_forbidden"));
});

test("subject type and claim fingerprint must agree with the level", () => {
  assert.ok(
    machineAssuranceInputErrors(
      sourceValidatedInput({ claimFingerprint: HEX64 }),
    ).includes("claim_fingerprint_forbidden"),
  );
  assert.ok(
    machineAssuranceInputErrors(
      aiExtractedInput({ claimFingerprint: null }),
    ).includes("claim_fingerprint_missing"),
  );
  assert.ok(
    machineAssuranceInputErrors(
      aiExtractedInput({ subjectType: "SOURCE_VERSION" }),
    ).includes("subject_level_mismatch"),
  );
});

test("confidence outside [0,1] is rejected", () => {
  for (const confidence of [-0.1, 1.1, Number.NaN]) {
    assert.ok(
      machineAssuranceInputErrors(aiExtractedInput({ confidence })).includes(
        "confidence_out_of_range",
      ),
      `expected rejection for confidence ${confidence}`,
    );
  }
});

test("checks must contain exactly the six known checks with known outcomes", () => {
  const missing = { ...passingChecks() } as Record<string, string>;
  delete missing.freshness;
  assert.ok(
    machineAssuranceInputErrors(
      aiExtractedInput({ checks: missing as unknown as MachineAssuranceChecks }),
    ).includes("checks_shape_invalid"),
  );

  assert.ok(
    machineAssuranceInputErrors(
      aiExtractedInput({
        checks: passingChecks({
          contradiction: "MAYBE" as unknown as "PASS",
        }),
      }),
    ).includes("checks_shape_invalid"),
  );

  assert.ok(
    machineAssuranceInputErrors(
      aiExtractedInput({
        checks: {
          ...passingChecks(),
          extraCheck: "PASS",
        } as unknown as MachineAssuranceChecks,
      }),
    ).includes("checks_shape_invalid"),
  );
});

test("fingerprints and checksums must be 64-char lowercase hex", () => {
  for (const field of [
    "sourceVersionFingerprint",
    "inputChecksumSha256",
    "outputChecksumSha256",
  ] as const) {
    assert.ok(
      machineAssuranceInputErrors(
        aiExtractedInput({ [field]: "XYZ" }),
      ).includes("checksum_invalid"),
      `expected checksum_invalid for ${field}`,
    );
  }
});

test("PROVISIONAL_PUBLISHED cannot be recorded directly; it belongs to the release path", () => {
  assert.ok(
    machineAssuranceInputErrors(
      aiExtractedInput({ assuranceLevel: "PROVISIONAL_PUBLISHED" }),
    ).includes("level_reserved_for_release"),
  );
});

test("advance requires every check passing and zero blockers", () => {
  assert.equal(machineAssuranceCanAdvance(aiExtractedInput()), true);
  assert.equal(
    machineAssuranceCanAdvance(
      aiExtractedInput({ checks: passingChecks({ contradiction: "FAIL" }) }),
    ),
    false,
  );
  assert.equal(
    machineAssuranceCanAdvance(
      aiExtractedInput({ checks: passingChecks({ freshness: "NOT_EVALUATED" }) }),
    ),
    false,
  );
  assert.equal(
    machineAssuranceCanAdvance(
      aiExtractedInput({ blockers: ["SOURCE_STALE"] }),
    ),
    false,
  );
});

test("a blocked record is still a valid record: failure is captured, not dropped", () => {
  const blocked = aiExtractedInput({
    checks: passingChecks({ contradiction: "FAIL" }),
    blockers: ["CROSS_CHECK_CONTRADICTION"],
  });
  assert.deepEqual(machineAssuranceInputErrors(blocked), []);
  assert.equal(machineAssuranceCanAdvance(blocked), false);
});

test("the client submits valid records over the service RPC", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const fetchStub: FetchLike = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ recordId: "assurance:x", outcome: "ADVANCED" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const client = new MachineAssuranceClient(
    new SupabaseHttpClient(
      {
        url: "https://fixture.supabase.co",
        serviceRoleKey: "fixture-key",
        reportsBucket: "policy-reports",
        datasetsBucket: "policy-datasets",
        sourcesBucket: "policy-sources",
        requestTimeoutMs: 5000,
      },
      fetchStub,
    ),
  );

  await client.record(aiExtractedInput());
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.includes("record_machine_assurance"));
  const body = calls[0].body as Record<string, unknown>;
  assert.equal(body.p_assurance_level, "AI_EXTRACTED");
  assert.equal(body.p_model, "gpt-5.6-terra");
  assert.deepEqual(body.p_blockers, []);
});

test("the client rejects invalid records locally without calling the network", async () => {
  const fetchStub: FetchLike = async () => {
    throw new Error("network must not be reached for invalid input");
  };
  const client = new MachineAssuranceClient(
    new SupabaseHttpClient(
      {
        url: "https://fixture.supabase.co",
        serviceRoleKey: "fixture-key",
        reportsBucket: "policy-reports",
        datasetsBucket: "policy-datasets",
        sourcesBucket: "policy-sources",
        requestTimeoutMs: 5000,
      },
      fetchStub,
    ),
  );

  await assert.rejects(
    () => client.record(aiExtractedInput({ confidence: 2 })),
    /confidence_out_of_range/,
  );
});
