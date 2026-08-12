import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import type { PlaybookPackageArtifact } from "../lib/playbooks/contracts";
import { verifyPlaybookPackageIntegrity } from "../lib/playbooks/runtime";

const FIXTURE_DIRECTORY = path.join(
  process.cwd(),
  "contracts",
  "fixtures",
  "citely",
  "v1",
);

type CreateRequest = {
  playbookId: string;
  profile: unknown;
};

type FixturePair = {
  slug: string;
  request: CreateRequest;
  response: PlaybookPackageArtifact;
};

type GenericRenderModel = {
  schemaVersion: string;
  packageId: string;
  title: string;
  reviewBadge: string;
  limitations: string[];
  counselTriggers: string[];
  capabilities: Array<{
    id: string;
    title: string;
    status: string;
    reasons: string[];
    actions: string[];
    evidenceClaimIds: string[];
  }>;
  claims: Array<{
    id: string;
    proposition: string;
    citations: Array<{ provisionId: string; locator: string }>;
  }>;
  retrieval: {
    status: string;
    limitations: string[];
    citations: Array<{
      claimId: string;
      locator: string;
      canonicalUrl: string;
      excerpt: string | null;
    }>;
  };
  versionPins: {
    corpusReleaseId: string | null;
    retrievalIndexReleaseId: string | null;
    evaluatedAt: string;
  };
};

async function schema(name: string): Promise<Record<string, unknown>> {
  return JSON.parse(
    await readFile(path.join(process.cwd(), "contracts", "v1", name), "utf8"),
  ) as Record<string, unknown>;
}

async function fixturePairs(): Promise<FixturePair[]> {
  const files = (await readdir(FIXTURE_DIRECTORY))
    .filter((file) => file.endsWith(".request.json"))
    .sort();
  return Promise.all(
    files.map(async (file) => {
      const slug = file.slice(0, -".request.json".length);
      const [request, response] = await Promise.all([
        readFile(path.join(FIXTURE_DIRECTORY, file), "utf8"),
        readFile(
          path.join(FIXTURE_DIRECTORY, `${slug}.response.json`),
          "utf8",
        ),
      ]);
      return {
        slug,
        request: JSON.parse(request) as CreateRequest,
        response: JSON.parse(response) as PlaybookPackageArtifact,
      };
    }),
  );
}

/**
 * Reference projection for the thin Citely client. It deliberately switches
 * on no domain identifiers or reason codes: every visible value comes from
 * the package contract, so the same projection works for future policy
 * domains that implement this envelope.
 */
function toGenericRenderModel(
  artifact: PlaybookPackageArtifact,
): GenericRenderModel {
  const pkg = artifact.package;
  const bundle = artifact.evidenceBundle;
  const availableClaims = new Set(bundle.claims.map((claim) => claim.claimId));
  for (const conclusion of pkg.conclusions) {
    for (const claimId of conclusion.evidenceClaimIds) {
      if (!availableClaims.has(claimId)) {
        throw new Error(`unresolved evidence claim: ${claimId}`);
      }
    }
  }
  return {
    schemaVersion: pkg.schemaVersion,
    packageId: pkg.packageId,
    title: pkg.playbookName,
    reviewBadge: pkg.assurance.reviewStatus,
    limitations: [...pkg.assurance.limitations],
    counselTriggers: [...pkg.assurance.counselTriggers],
    capabilities: pkg.conclusions.map((conclusion) => ({
      id: conclusion.capabilityId,
      title: conclusion.title,
      status: conclusion.conclusion,
      reasons: [...conclusion.reasonCodes],
      actions: [...conclusion.actions],
      evidenceClaimIds: [...conclusion.evidenceClaimIds],
    })),
    claims: bundle.claims.map((claim) => ({
      id: claim.claimId,
      proposition: claim.proposition,
      citations: claim.citations.map((citation) => ({ ...citation })),
    })),
    retrieval: {
      status: bundle.retrieval.status,
      limitations: [...bundle.retrieval.limitations],
      citations: bundle.retrieval.items.map((item) => ({
        claimId: item.claimId,
        locator: item.locator,
        canonicalUrl: item.canonicalUrl,
        excerpt: item.excerpt,
      })),
    },
    versionPins: {
      corpusReleaseId: pkg.versions.corpusReleaseId,
      retrievalIndexReleaseId: pkg.versions.retrievalIndexReleaseId,
      evaluatedAt: pkg.evaluatedAt,
    },
  };
}

test("Citely consumer fixtures satisfy request/response schemas and package integrity", async () => {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  const validateRequest = ajv.compile(
    await schema("playbook-package-create-request.schema.json"),
  );
  const validateResponse = ajv.compile(
    await schema("playbook-package-response.schema.json"),
  );
  const fixtures = await fixturePairs();

  assert.equal(fixtures.length, 2);
  assert.deepEqual(
    fixtures.map((fixture) => fixture.request.playbookId).sort(),
    ["business-model-regulatory-boundary", "stablecoin-pre-listing"],
  );
  for (const fixture of fixtures) {
    assert.equal(
      validateRequest(fixture.request),
      true,
      `${fixture.slug} request: ${JSON.stringify(validateRequest.errors)}`,
    );
    assert.equal(
      validateResponse(fixture.response),
      true,
      `${fixture.slug} response: ${JSON.stringify(validateResponse.errors)}`,
    );
    assert.equal(
      fixture.response.package.playbookId,
      fixture.request.playbookId,
    );
    assert.equal(
      fixture.response.evidenceBundle.packageId,
      fixture.response.package.packageId,
    );
    assert.equal(verifyPlaybookPackageIntegrity(fixture.response.package), true);
  }
});

test("a domain-agnostic consumer can render every fixture without dropping legal posture", async () => {
  const fixtures = await fixturePairs();
  const views = fixtures.map((fixture) => toGenericRenderModel(fixture.response));

  for (const [index, view] of views.entries()) {
    const artifact = fixtures[index].response;
    assert.equal(view.reviewBadge, "PROVISIONAL");
    assert.deepEqual(view.limitations, artifact.package.assurance.limitations);
    assert.deepEqual(
      view.counselTriggers,
      artifact.package.assurance.counselTriggers,
    );
    assert.equal(view.capabilities.length, artifact.package.conclusions.length);
    assert.ok(view.capabilities.every((capability) => capability.actions.length > 0));
    assert.ok(
      view.claims.every((claim) => claim.citations.every((citation) => citation.locator.length > 0)),
    );
    assert.equal(
      view.versionPins.corpusReleaseId,
      artifact.package.versions.corpusReleaseId,
    );
    assert.equal(view.versionPins.evaluatedAt, artifact.package.evaluatedAt);
  }

  const success = views.find((view) => view.retrieval.status === "SUCCESS");
  const degraded = views.find(
    (view) => view.retrieval.status === "RETRIEVAL_UNAVAILABLE",
  );
  assert.ok(success);
  assert.ok(success.retrieval.citations.length > 0);
  assert.ok(degraded);
  assert.deepEqual(degraded.retrieval.citations, []);
  assert.ok(degraded.retrieval.limitations.length > 0);
});

test("consumer schemas reject silent inference and unknown fields", async () => {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  const validateRequest = ajv.compile(
    await schema("playbook-package-create-request.schema.json"),
  );
  const validateResponse = ajv.compile(
    await schema("playbook-package-response.schema.json"),
  );
  const [fixture] = await fixturePairs();

  assert.equal(
    validateRequest({ ...fixture.request, customerEmail: "not-allowed@example.test" }),
    false,
  );
  assert.equal(
    validateResponse({
      ...fixture.response,
      package: {
        ...fixture.response.package,
        conclusions: fixture.response.package.conclusions.map((conclusion, index) =>
          index === 0 ? { ...conclusion, conclusion: "COMPLIANT" } : conclusion,
        ),
      },
    }),
    false,
  );
  assert.equal(
    validateResponse({
      ...fixture.response,
      package: { ...fixture.response.package, rawDecisionRules: "private" },
    }),
    false,
  );
});
