import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { SupabaseHttpClient } from "../lib/data/supabase-client";
import {
  ChangeDeltaWebhookStore,
  dispatchChangeDeltaWebhooks,
  parseWebhookDeliveryClaims,
  readChangeDeltaWebhookConfig,
  signChangeDeltaWebhook,
  type WebhookDeliveryClaim,
  type WebhookDeliveryOutcome,
  type WebhookDeliveryStore,
} from "../lib/monitoring/change-delta-webhooks";
import { encodeChangeDeltaCursor } from "../lib/monitoring/change-to-action-deltas";

const PACKAGE_ID = "package:stablecoin-pre-listing:aaaaaaaaaaaaaaaa";
const WATCHLIST_ID = "watchlist:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const DELTA_ID = "delta:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const DELIVERY_ID = "webhook-delivery:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const LEASE_TOKEN = "lease:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SECRET = "s".repeat(48);

test("webhook claim parser builds a strict replayable delta envelope", () => {
  const [claim] = parseWebhookDeliveryClaims(rawClaimBatch(), 10);
  assert.equal(claim.deliveryId, DELIVERY_ID);
  assert.equal(claim.attemptNumber, 1);
  assert.equal(claim.payload.type, "playbook.watchlist.change");
  assert.equal(claim.payload.id, DELTA_ID);
  assert.equal(claim.payload.data.cursor, encodeChangeDeltaCursor(
    PACKAGE_ID, WATCHLIST_ID, 7,
  ));
  assert.deepEqual(claim.payload.data.actions, [
    "REVIEW_EVIDENCE_CHANGE", "REQUEST_PLAYBOOK_RERUN",
  ]);
});

test("webhook payload validates as a strict versioned Citely contract", async () => {
  const [webhookSchema, deltaSchema] = await Promise.all([
    readJson("contracts/v1/playbook-change-webhook.schema.json"),
    readJson("contracts/v1/playbook-watchlist-changes-response.schema.json"),
  ]);
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  ajv.addSchema(deltaSchema);
  const validate = ajv.compile(webhookSchema);
  const payload = claimFixture().payload;
  assert.equal(validate(payload), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...payload, secret: "must-not-leak" }), false);
});

test("webhook claim parser rejects duplicate, foreign, and expanded shapes", () => {
  assert.throws(() => parseWebhookDeliveryClaims({
    ...rawClaimBatch(),
    items: [rawClaimBatch().items[0], rawClaimBatch().items[0]],
  }, 10), /duplicate webhook delivery claim/);
  assert.throws(() => parseWebhookDeliveryClaims({
    ...rawClaimBatch(),
    items: [{ ...rawClaimBatch().items[0], unexpected: true }],
  }, 10), /invalid webhook delivery claim/);
  assert.throws(() => parseWebhookDeliveryClaims({
    ...rawClaimBatch(),
    items: [{
      ...rawClaimBatch().items[0],
      delta: { ...rawDelta(), packageId: "not-a-package" },
    }],
  }, 10), /invalid change delta/);
});

test("webhook signing covers immutable event identity, timestamp, and exact body", () => {
  const input = {
    secret: SECRET,
    eventId: DELTA_ID,
    timestamp: "1786968000",
    body: JSON.stringify({ stable: true }),
  };
  assert.equal(
    signChangeDeltaWebhook(input),
    `v1=${createHmac("sha256", SECRET)
      .update(`${input.eventId}.${input.timestamp}.${input.body}`, "utf8")
      .digest("base64url")}`,
  );
  assert.notEqual(
    signChangeDeltaWebhook(input),
    signChangeDeltaWebhook({ ...input, body: JSON.stringify({ stable: false }) }),
  );
});

test("webhook dispatcher sends signed body and records successful completion", async () => {
  const claim = claimFixture();
  let completed: WebhookDeliveryOutcome | null = null;
  const store: WebhookDeliveryStore = {
    async claim(limit, leaseSeconds) {
      assert.equal(limit, 10);
      assert.equal(leaseSeconds, 60);
      return [claim];
    },
    async complete(received, outcome) {
      assert.equal(received, claim);
      completed = outcome;
      return "DELIVERED";
    },
  };
  const summary = await dispatchChangeDeltaWebhooks({
    store,
    config: config(),
    now: () => new Date("2026-08-17T12:00:00.000Z"),
    fetchImpl: async (input, init) => {
      assert.equal(String(input), "https://citely.example/internal/policy-events");
      assert.equal(init?.method, "POST");
      assert.equal(init?.redirect, "manual");
      const headers = new Headers(init?.headers);
      const body = String(init?.body);
      assert.equal(headers.get("webhook-id"), DELTA_ID);
      assert.equal(headers.get("webhook-timestamp"), "1786968000");
      assert.equal(
        headers.get("webhook-signature"),
        signChangeDeltaWebhook({
          secret: SECRET,
          eventId: DELTA_ID,
          timestamp: "1786968000",
          body,
        }),
      );
      assert.deepEqual(JSON.parse(body), claim.payload);
      return new Response("ignored response body", { status: 200 });
    },
  });
  assert.deepEqual(completed, {
    outcome: "SUCCEEDED", responseStatus: 200, errorCode: null,
  });
  assert.deepEqual(summary, {
    schemaVersion: "1.0.0",
    claimed: 1,
    delivered: 1,
    retryScheduled: 0,
    deadLettered: 0,
  });
});

test("webhook dispatcher classifies retryable, permanent, and network failures", async () => {
  for (const scenario of [
    { response: new Response(null, { status: 503 }), state: "PENDING" as const,
      outcome: "RETRYABLE_FAILURE", errorCode: "HTTP_503" },
    { response: new Response(null, { status: 400 }), state: "DEAD_LETTER" as const,
      outcome: "PERMANENT_FAILURE", errorCode: "HTTP_400" },
  ]) {
    let recorded: WebhookDeliveryOutcome | null = null;
    const summary = await dispatchChangeDeltaWebhooks({
      store: singleClaimStore(scenario.state, (outcome) => { recorded = outcome; }),
      config: config(),
      fetchImpl: async () => scenario.response,
    });
    const outcome = recorded as WebhookDeliveryOutcome | null;
    assert.ok(outcome);
    assert.equal(outcome.outcome, scenario.outcome);
    assert.equal(outcome.errorCode, scenario.errorCode);
    assert.equal(summary.retryScheduled, scenario.state === "PENDING" ? 1 : 0);
    assert.equal(summary.deadLettered, scenario.state === "DEAD_LETTER" ? 1 : 0);
  }

  let networkOutcome: WebhookDeliveryOutcome | null = null;
  await dispatchChangeDeltaWebhooks({
    store: singleClaimStore("PENDING", (outcome) => { networkOutcome = outcome; }),
    config: config(),
    fetchImpl: async () => { throw new Error("sensitive upstream message"); },
  });
  assert.deepEqual(networkOutcome, {
    outcome: "RETRYABLE_FAILURE",
    responseStatus: null,
    errorCode: "NETWORK_ERROR",
  });
});

test("webhook store rejects lease completion responses that were not recorded", async () => {
  const client = {
    async rpc() { return { status: "LEASE_EXPIRED" }; },
  } as unknown as SupabaseHttpClient;
  const store = new ChangeDeltaWebhookStore(client);
  await assert.rejects(() => store.complete(claimFixture(), {
    outcome: "SUCCEEDED", responseStatus: 204, errorCode: null,
  }), /webhook delivery completion was not recorded/);
});

test("webhook configuration keeps receiver and secret server-only and bounded", () => {
  assert.deepEqual(readChangeDeltaWebhookConfig({
    CITELY_WEBHOOK_URL: "https://citely.example/internal/policy-events",
    CITELY_WEBHOOK_SIGNING_SECRET: SECRET,
  }), config());
  assert.throws(() => readChangeDeltaWebhookConfig({}), /are required/);
  assert.throws(() => readChangeDeltaWebhookConfig({
    CITELY_WEBHOOK_URL: "http://citely.example/events",
    CITELY_WEBHOOK_SIGNING_SECRET: SECRET,
  }), /must use HTTPS/);
  assert.throws(() => readChangeDeltaWebhookConfig({
    CITELY_WEBHOOK_URL: "https://citely.example/events?secret=bad",
    CITELY_WEBHOOK_SIGNING_SECRET: SECRET,
  }), /must not contain/);
  assert.throws(() => readChangeDeltaWebhookConfig({
    CITELY_WEBHOOK_URL: "https://citely.example/events",
    CITELY_WEBHOOK_SIGNING_SECRET: "short",
  }), /32 to 256/);
  assert.throws(() => readChangeDeltaWebhookConfig({
    CITELY_WEBHOOK_URL: "https://citely.example/events",
    CITELY_WEBHOOK_SIGNING_SECRET: SECRET,
    POLICY_WEBHOOK_TIMEOUT_MS: "60000",
  }), /below the lease duration/);
});

function singleClaimStore(
  state: "PENDING" | "DELIVERED" | "DEAD_LETTER",
  inspect: (outcome: WebhookDeliveryOutcome) => void,
): WebhookDeliveryStore {
  return {
    async claim() { return [claimFixture()]; },
    async complete(_claim, outcome) {
      inspect(outcome);
      return state;
    },
  };
}

function config() {
  return {
    url: "https://citely.example/internal/policy-events",
    signingSecret: SECRET,
    batchSize: 10,
    leaseSeconds: 60,
    requestTimeoutMs: 10_000,
  };
}

function claimFixture(): WebhookDeliveryClaim {
  return parseWebhookDeliveryClaims(rawClaimBatch(), 10)[0];
}

function rawClaimBatch() {
  return {
    schemaVersion: "1.0.0",
    claimedAt: "2026-08-17T11:59:00.000Z",
    items: [{
      deliveryId: DELIVERY_ID,
      leaseToken: LEASE_TOKEN,
      leaseExpiresAt: "2026-08-17T12:00:00.000Z",
      attemptNumber: 1,
      replayNumber: 0,
      delta: rawDelta(),
    }],
  };
}

function rawDelta() {
  return {
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
  };
}

async function readJson(path: string): Promise<object> {
  return JSON.parse(await readFile(path, "utf8")) as object;
}
