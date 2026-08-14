import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { GET as getOpenApi } from "../app/openapi.json/route";
import { POST } from "../app/v1/playbook-packages/[id]/watchlist/route";

const API_KEY = "watchlist-route-test-key";
const PACKAGE_ID = "package:stablecoin-pre-listing:aaaaaaaaaaaaaaaa";

test("watchlist route returns 201 on creation and 200 on exact replay", async () => {
  await withEnvironment(async () => {
    await withFetch({ status: "CREATED", watchlist: fixture() }, async () => {
      const response = await request(PACKAGE_ID);
      assert.equal(response.status, 201);
      assert.deepEqual(await response.json(), fixture());
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(response.headers.get("idempotency-replayed"), null);
    });
    await withFetch({ status: "REPLAYED", watchlist: fixture() }, async () => {
      const response = await request(PACKAGE_ID);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), fixture());
      assert.equal(response.headers.get("idempotency-replayed"), "true");
    });
  });
});

test("watchlist route maps missing and empty-dependency packages", async () => {
  await withEnvironment(async () => {
    await withFetch({ status: "NOT_FOUND" }, async () => {
      const response = await request(PACKAGE_ID);
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: "playbook-package-not-found" });
    });
    await withFetch({
      status: "NOT_WATCHLISTABLE",
      reason: "EMPTY_DEPENDENCIES",
    }, async () => {
      const response = await request(PACKAGE_ID);
      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), {
        error: "playbook-package-not-watchlistable",
      });
    });
  });
});

test("watchlist route rejects malformed IDs and request bodies before database IO", async () => {
  await withEnvironment(async () => {
    let called = false;
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      called = true;
      throw new Error("unexpected database call");
    };
    try {
      const malformed = await request("not-a-package");
      assert.equal(malformed.status, 404);
      const body = await request(PACKAGE_ID, "{}");
      assert.equal(body.status, 400);
      assert.deepEqual(await body.json(), { error: "unexpected-request-body" });
      assert.equal(called, false);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});

test("OpenAPI advertises the authenticated bodyless watchlist contract", async () => {
  const response = await getOpenApi(
    new NextRequest("https://policy.citely.info/openapi.json"),
  );
  const document = await response.json();
  const operation = document.paths["/v1/playbook-packages/{id}/watchlist"].post;
  assert.equal(operation.operationId, "createPlaybookPackageWatchlist");
  assert.deepEqual(operation.security, [{ playbookServiceKey: [] }]);
  assert.equal(operation.requestBody, undefined);
  assert.equal(
    operation.responses["201"].content["application/json"].schema.$ref,
    "#/components/schemas/PlaybookWatchlistResponse",
  );
  assert.ok(document.components.schemas.PlaybookWatchlistResponse);
});

async function request(packageId: string, body?: string) {
  return POST(new NextRequest(
    `https://example.test/v1/playbook-packages/${packageId}/watchlist`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${API_KEY}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body,
    },
  ), { params: Promise.resolve({ id: packageId }) });
}

async function withEnvironment(run: () => Promise<void>) {
  const names = [
    "PLAYBOOK_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY",
  ] as const;
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  process.env.PLAYBOOK_API_KEY = API_KEY;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  try {
    await run();
  } finally {
    for (const name of names) {
      const value = previous[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

async function withFetch(response: unknown, run: () => Promise<void>) {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => Response.json(response);
  try {
    await run();
  } finally {
    globalThis.fetch = previous;
  }
}

function fixture() {
  return {
    schemaVersion: "1.0.0" as const,
    watchlistId: "watchlist:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    packageId: PACKAGE_ID,
    state: "ACTIVE" as const,
    createdAt: "2026-08-14T20:00:00.000Z",
  };
}
