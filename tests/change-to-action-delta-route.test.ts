import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { GET as getOpenApi } from "../app/openapi.json/route";
import { GET } from "../app/v1/playbook-packages/[id]/watchlist/changes/route";
import { encodeChangeDeltaCursor } from "../lib/monitoring/change-to-action-deltas";

const API_KEY = "change-delta-route-test-key";
const PACKAGE_ID = "package:stablecoin-pre-listing:aaaaaaaaaaaaaaaa";
const WATCHLIST_ID = "watchlist:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

test("watchlist changes route returns a private replayable delta page", async () => {
  await withEnvironment(async () => {
    let rpcBody: Record<string, unknown> | null = null;
    await withFetch(rawPage(), async (_input, init) => {
      rpcBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    }, async () => {
      const response = await request("?limit=1");
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      const body = await response.json();
      assert.equal(body.schemaVersion, "1.0.0");
      assert.equal(body.items.length, 1);
      assert.equal(body.items[0].status, "REVIEW_REQUIRED");
      assert.deepEqual(body.items[0].actions, [
        "REVIEW_EVIDENCE_CHANGE", "REQUEST_PLAYBOOK_RERUN",
      ]);
      assert.equal(body.nextCursor, encodeChangeDeltaCursor(
        PACKAGE_ID, WATCHLIST_ID, 7,
      ));
      assert.deepEqual(rpcBody, {
        p_package_id: PACKAGE_ID,
        p_after_sequence: 0,
        p_cursor_watchlist_id: null,
        p_limit: 1,
      });
    });
  });
});

test("watchlist changes route maps not-found and database cursor rejection", async () => {
  await withEnvironment(async () => {
    await withFetch({ status: "NOT_FOUND" }, undefined, async () => {
      const response = await request();
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: "playbook-watchlist-not-found" });
    });
    const cursor = encodeChangeDeltaCursor(PACKAGE_ID, WATCHLIST_ID, 7);
    await withFetch({ status: "INVALID_CURSOR" }, undefined, async () => {
      const response = await request(`?after_cursor=${cursor}`);
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: "invalid-after-cursor" });
    });
  });
});

test("watchlist changes route rejects malformed query before database IO", async () => {
  await withEnvironment(async () => {
    let called = false;
    const previous = globalThis.fetch;
    globalThis.fetch = async () => {
      called = true;
      throw new Error("unexpected database call");
    };
    try {
      for (const query of [
        "?limit=0", "?limit=101", "?after_cursor=", "?unknown=true",
        "?limit=1&limit=2",
      ]) {
        const response = await request(query);
        assert.equal(response.status, 400);
        assert.deepEqual(await response.json(), {
          error: "invalid-change-delta-query",
        });
      }
      assert.equal(called, false);
    } finally {
      globalThis.fetch = previous;
    }
  });
});

test("OpenAPI advertises the authenticated Change-to-Action Delta contract", async () => {
  const response = await getOpenApi(
    new NextRequest("https://policy.citely.info/openapi.json"),
  );
  const document = await response.json();
  const operation = document.paths[
    "/v1/playbook-packages/{id}/watchlist/changes"
  ].get;
  assert.equal(operation.operationId, "getPlaybookPackageWatchlistChanges");
  assert.deepEqual(operation.security, [{ playbookServiceKey: [] }]);
  assert.equal(
    operation.responses["200"].content["application/json"].schema.$ref,
    "#/components/schemas/PlaybookWatchlistChangesResponse",
  );
  assert.ok(document.components.schemas.PlaybookWatchlistChangesResponse);
});

async function request(query = "") {
  return GET(new NextRequest(
    `https://example.test/v1/playbook-packages/${PACKAGE_ID}/watchlist/changes${query}`,
    { headers: { authorization: `Bearer ${API_KEY}` } },
  ), { params: Promise.resolve({ id: PACKAGE_ID }) });
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

async function withFetch(
  response: unknown,
  inspect: ((input: RequestInfo | URL, init?: RequestInit) => Promise<void> | void) | undefined,
  run: () => Promise<void>,
) {
  const previous = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    await inspect?.(input, init);
    return Response.json(response);
  };
  try {
    await run();
  } finally {
    globalThis.fetch = previous;
  }
}

function rawPage() {
  return {
    status: "OK",
    schemaVersion: "1.0.0",
    watchlistId: WATCHLIST_ID,
    packageId: PACKAGE_ID,
    items: [{
      deltaId: "delta:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      deltaSequence: 7,
      watchlistId: WATCHLIST_ID,
      packageId: PACKAGE_ID,
      event: {
        eventId: "event:delta-route:test",
        eventType: "AMENDMENT",
        title: "Sanitized route delta",
        publishedAt: "2026-08-16T12:00:00.000Z",
        effectiveAt: null,
        beforeVersionId: "version:test:1",
        afterVersionId: "version:test:2",
      },
      evidenceChanges: [{
        claimId: "claim:delta-route:test",
        impactType: "MAY_AFFECT",
      }],
      status: "REVIEW_REQUIRED",
      packageAssuranceReviewStatus: "PROVISIONAL",
      actions: ["REVIEW_EVIDENCE_CHANGE", "REQUEST_PLAYBOOK_RERUN"],
      requiredCustomerResponse: "ACKNOWLEDGE_AND_RERUN",
      createdAt: "2026-08-16T12:00:01.000Z",
    }],
    nextSequence: 7,
    hasMore: false,
  };
}
