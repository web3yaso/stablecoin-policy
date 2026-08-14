import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020";
import { NextRequest } from "next/server";
import { GET as getOpenApi } from "../app/openapi.json/route";
import { GET as listPlaybooks } from "../app/v1/playbooks/route";
import {
  GET as getPlaybook,
  OPTIONS as playbookOptions,
} from "../app/v1/playbooks/[id]/route";

type PublicPlaybook = {
  playbookId: string;
  name: string;
  version: string;
  templateVersion: string;
  description: string;
  capabilities: Array<{ capabilityId: string; title: string }>;
  intakeSchema: Record<string, unknown>;
  assuranceNote: string;
};

type DetailResponse = {
  schemaVersion: string;
  playbook: PublicPlaybook;
};

async function detail(id: string) {
  return getPlaybook(
    new NextRequest(`https://example.test/v1/playbooks/${id}`),
    { params: Promise.resolve({ id }) },
  );
}

async function responseSchema(): Promise<Record<string, unknown>> {
  return JSON.parse(
    await readFile(
      path.join(
        process.cwd(),
        "contracts",
        "v1",
        "playbook-detail-response.schema.json",
      ),
      "utf8",
    ),
  ) as Record<string, unknown>;
}

test("single-playbook detail is contract-valid and matches the public catalog", async () => {
  const [catalogResponse, detailResponse] = await Promise.all([
    listPlaybooks(),
    detail("stablecoin-pre-listing"),
  ]);
  const catalog = await catalogResponse.json();
  const body = await detailResponse.json() as DetailResponse;
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  const validate = ajv.compile(await responseSchema());

  assert.equal(detailResponse.status, 200);
  assert.equal(validate(body), true, JSON.stringify(validate.errors));
  assert.equal(
    detailResponse.headers.get("cache-control"),
    "public, max-age=300, stale-while-revalidate=3600",
  );
  assert.equal(detailResponse.headers.get("access-control-allow-origin"), "*");

  const summary = catalog.playbooks.find(
    (playbook: { playbookId: string }) =>
      playbook.playbookId === body.playbook.playbookId,
  );
  assert.ok(summary);
  assert.deepEqual(
    {
      playbookId: body.playbook.playbookId,
      name: body.playbook.name,
      version: body.playbook.version,
      description: body.playbook.description,
      capabilities: body.playbook.capabilities,
      assuranceNote: body.playbook.assuranceNote,
    },
    summary,
  );
});

test("Pre-listing intake schema is directly renderable and fails closed", async () => {
  const response = await detail("stablecoin-pre-listing");
  const body = await response.json() as DetailResponse;
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  const validate = ajv.compile(body.playbook.intakeSchema);
  const validProfile = {
    operatorJurisdiction: "SG",
    targetJurisdiction: "EEA",
    activities: ["list-for-trading", "custody-for-clients"],
    asset: { symbol: "USDC", networks: ["base", "ethereum"] },
  };

  assert.equal(validate(validProfile), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...validProfile, asset: undefined }), false);
  assert.equal(
    validate({ ...validProfile, activities: ["merchant-payment"] }),
    false,
  );
  assert.equal(validate({ ...validProfile, customerEmail: "private@example.test" }), false);
});

test("Business Model intake exposes only its own capabilities and no asset requirement", async () => {
  const response = await detail("business-model-regulatory-boundary");
  const body = await response.json() as DetailResponse;
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  const validate = ajv.compile(body.playbook.intakeSchema);
  const profile = {
    operatorJurisdiction: "SG",
    targetJurisdiction: "EEA",
    activities: ["issue-emt", "casp-transfer"],
  };

  assert.equal(validate(profile), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...profile, activities: ["list-for-trading"] }), false);
});

test("public detail never exposes raw rules, actions, prompts, or evidence topics", async () => {
  const response = await detail("stablecoin-pre-listing");
  const serialized = JSON.stringify(await response.json());

  for (const privateField of [
    "requirementTopics",
    "prohibitionTopics",
    "dossierChecks",
    "actions",
    "prompt",
    "decisionGraph",
    "crypto-asset-service-provider-authorisation",
  ]) {
    assert.equal(serialized.includes(privateField), false, privateField);
  }
});

test("unknown and malformed playbook IDs return the same no-store 404", async () => {
  for (const id of ["unknown-playbook", "NOT VALID"]) {
    const response = await detail(id);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "playbook-not-found" });
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
  }
});

test("OpenAPI advertises the detail contract without service authentication", async () => {
  const response = await getOpenApi(
    new NextRequest("https://policy.citely.info/openapi.json"),
  );
  const document = await response.json();
  const operation = document.paths["/v1/playbooks/{id}"].get;

  assert.equal(operation.operationId, "getPlaybook");
  assert.equal(operation.security, undefined);
  assert.equal(
    operation.responses["200"].content["application/json"].schema.$ref,
    "#/components/schemas/PlaybookDetailResponse",
  );
  assert.ok(document.components.schemas.PlaybookDetailResponse);
});

test("single-playbook preflight is public and side-effect free", async () => {
  const response = await playbookOptions();
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-methods"), "GET, OPTIONS");
  assert.equal(response.headers.get("access-control-allow-headers"), "Accept, Content-Type");
});
