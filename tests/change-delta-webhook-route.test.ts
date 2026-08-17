import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { GET } from "../app/api/cron/change-delta-webhooks/route";

const CRON_SECRET = "c".repeat(48);
const SIGNING_SECRET = "s".repeat(48);
const PACKAGE_ID = "package:stablecoin-pre-listing:aaaaaaaaaaaaaaaa";
const WATCHLIST_ID = "watchlist:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const DELTA_ID = "delta:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

test("cron route authenticates, dispatches one signed webhook, and records success", async () => {
  await withEnvironment(async () => {
    const calls: string[] = [];
    const previous = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("claim_playbook_webhook_deliveries")) {
        return Response.json(rawClaimBatch());
      }
      if (url === "https://citely.example/internal/policy-events") {
        const headers = new Headers(init?.headers);
        assert.equal(headers.get("webhook-id"), DELTA_ID);
        assert.match(headers.get("webhook-signature") ?? "", /^v1=[A-Za-z0-9_-]+$/);
        return new Response(null, { status: 204 });
      }
      if (url.includes("complete_playbook_webhook_delivery")) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        assert.equal(body.p_outcome, "SUCCEEDED");
        assert.equal(body.p_response_status, 204);
        return Response.json({
          status: "RECORDED",
          deliveryId: "webhook-delivery:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          deliveryState: "DELIVERED",
          attemptNumber: 1,
        });
      }
      throw new Error("unexpected fetch target");
    };
    try {
      const response = await request(`Bearer ${CRON_SECRET}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.deepEqual(await response.json(), {
        schemaVersion: "1.0.0",
        claimed: 1,
        delivered: 1,
        retryScheduled: 0,
        deadLettered: 0,
      });
      assert.equal(calls.length, 3);
    } finally {
      globalThis.fetch = previous;
    }
  });
});

test("cron route rejects missing or incorrect credentials before database IO", async () => {
  await withEnvironment(async () => {
    let called = false;
    const previous = globalThis.fetch;
    globalThis.fetch = async () => {
      called = true;
      throw new Error("unexpected fetch");
    };
    try {
      const missing = await request();
      assert.equal(missing.status, 401);
      assert.deepEqual(await missing.json(), { error: "unauthorized" });
      const incorrect = await request("Bearer wrong");
      assert.equal(incorrect.status, 401);
      assert.equal(called, false);
    } finally {
      globalThis.fetch = previous;
    }
  });
});

test("cron route fails closed when secrets are not configured", async () => {
  const previous = process.env.CRON_SECRET;
  delete process.env.CRON_SECRET;
  try {
    const response = await request();
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: "webhook-dispatch-unconfigured",
    });
  } finally {
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  }
});

async function request(authorization?: string) {
  return GET(new NextRequest(
    "https://policy.citely.info/api/cron/change-delta-webhooks",
    { headers: authorization ? { authorization } : {} },
  ));
}

async function withEnvironment(run: () => Promise<void>) {
  const names = [
    "CRON_SECRET", "CITELY_WEBHOOK_URL", "CITELY_WEBHOOK_SIGNING_SECRET",
    "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY",
  ] as const;
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  process.env.CRON_SECRET = CRON_SECRET;
  process.env.CITELY_WEBHOOK_URL = "https://citely.example/internal/policy-events";
  process.env.CITELY_WEBHOOK_SIGNING_SECRET = SIGNING_SECRET;
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

function rawClaimBatch() {
  return {
    schemaVersion: "1.0.0",
    claimedAt: "2026-08-17T11:59:00.000Z",
    items: [{
      deliveryId: "webhook-delivery:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      leaseToken: "lease:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      leaseExpiresAt: "2026-08-17T12:00:00.000Z",
      attemptNumber: 1,
      replayNumber: 0,
      delta: {
        deltaId: DELTA_ID,
        deltaSequence: 7,
        watchlistId: WATCHLIST_ID,
        packageId: PACKAGE_ID,
        event: {
          eventId: "event:webhook:test",
          eventType: "AMENDMENT",
          title: "Sanitized webhook delta",
          publishedAt: "2026-08-17T11:58:00.000Z",
          effectiveAt: null,
          beforeVersionId: "version:test:1",
          afterVersionId: "version:test:2",
        },
        evidenceChanges: [{
          claimId: "claim:webhook:test",
          impactType: "MAY_AFFECT",
        }],
        status: "REVIEW_REQUIRED",
        packageAssuranceReviewStatus: "PROVISIONAL",
        actions: ["REVIEW_EVIDENCE_CHANGE", "REQUEST_PLAYBOOK_RERUN"],
        requiredCustomerResponse: "ACKNOWLEDGE_AND_RERUN",
        createdAt: "2026-08-17T11:58:01.000Z",
      },
    }],
  };
}
