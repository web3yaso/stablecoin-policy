import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import type { PlaybookPackageArtifact } from "../lib/playbooks/contracts";
import { verifyPlaybookPackageIntegrity } from "../lib/playbooks/runtime";

const DEMO_DIRECTORY = path.join(
  process.cwd(),
  "contracts",
  "demos",
  "citely",
  "v1",
);

type DemoManifest = {
  schemaVersion: "1.0.0";
  kind: "STATIC_DEMO_SNAPSHOT";
  generatedAt: string;
  sourceBaseUrl: string;
  productionClaimUrls: string[];
  retrievalMode: "RETRIEVAL_UNAVAILABLE";
  limitations: string[];
};

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(
    await readFile(path.join(DEMO_DIRECTORY, file), "utf8"),
  ) as T;
}

async function readSchema(file: string): Promise<Record<string, unknown>> {
  return JSON.parse(
    await readFile(path.join(process.cwd(), "contracts", "v1", file), "utf8"),
  ) as Record<string, unknown>;
}

test("Citely Stablecoin demo snapshot is production-shaped and factual", async () => {
  const [request, response, manifest] = await Promise.all([
    readJson<Record<string, unknown>>("stablecoin-pre-listing.demo.request.json"),
    readJson<PlaybookPackageArtifact>("stablecoin-pre-listing.demo.response.json"),
    readJson<DemoManifest>("stablecoin-pre-listing.demo.manifest.json"),
  ]);
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  const validateRequest = ajv.compile(
    await readSchema("playbook-package-create-request.schema.json"),
  );
  const validateResponse = ajv.compile(
    await readSchema("playbook-package-response.schema.json"),
  );

  assert.equal(validateRequest(request), true, JSON.stringify(validateRequest.errors));
  assert.equal(validateResponse(response), true, JSON.stringify(validateResponse.errors));
  assert.equal(verifyPlaybookPackageIntegrity(response.package), true);
  assert.equal(manifest.kind, "STATIC_DEMO_SNAPSHOT");
  assert.equal(manifest.retrievalMode, "RETRIEVAL_UNAVAILABLE");
  assert.equal(response.evidenceBundle.retrieval.status, "RETRIEVAL_UNAVAILABLE");
  assert.deepEqual(response.evidenceBundle.retrieval.items, []);
  assert.equal(response.package.versions.retrievalIndexReleaseId, null);

  const expectedLocators = new Map([
    ["crypto-asset-service-provider-authorisation", "Article 59"],
    ["casp-client-asset-safeguarding", "Article 70"],
    ["custody-client-assets", "Article 75"],
    ["trading-platform-proprietary-trading", "Article 76"],
  ]);
  assert.equal(response.evidenceBundle.claims.length, expectedLocators.size);
  for (const claim of response.evidenceBundle.claims) {
    assert.equal(claim.proposition.startsWith("Sanitized fixture"), false);
    assert.equal(claim.citations[0]?.locator, expectedLocators.get(claim.topic));
    assert.ok(
      manifest.productionClaimUrls.some((url) =>
        url.endsWith(`/v1/claims/${claim.claimId}`)
      ),
    );
  }
  assert.deepEqual(
    response.package.conclusions.map((result) => result.conclusion),
    ["CONDITIONAL", "CONDITIONAL"],
  );
  assert.ok(manifest.limitations.some((item) => /not legal advice/i.test(item)));
});
