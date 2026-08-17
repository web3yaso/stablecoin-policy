import { createHmac } from "node:crypto";
import { DataIntegrityError } from "../data/external-storage-errors";
import type { FetchLike } from "../data/supabase-client";
import { SupabaseHttpClient } from "../data/supabase-client";
import {
  encodeChangeDeltaCursor,
  parseRawChangeToActionDelta,
  type ChangeToActionDelta,
} from "./change-to-action-deltas";

const DELIVERY_ID = /^webhook-delivery:[0-9a-f]{32}$/;
const LEASE_TOKEN = /^lease:[0-9a-f]{32}$/;
const MAX_BATCH_SIZE = 20;

export type ChangeDeltaWebhookPayload = {
  schemaVersion: "1.0.0";
  type: "playbook.watchlist.change";
  id: string;
  createdAt: string;
  data: ChangeToActionDelta;
};

export type WebhookDeliveryClaim = {
  deliveryId: string;
  leaseToken: string;
  leaseExpiresAt: string;
  attemptNumber: number;
  replayNumber: number;
  payload: ChangeDeltaWebhookPayload;
};

export type WebhookDeliveryOutcome =
  | { outcome: "SUCCEEDED"; responseStatus: number; errorCode: null }
  | {
    outcome: "RETRYABLE_FAILURE" | "PERMANENT_FAILURE";
    responseStatus: number | null;
    errorCode: string;
  };

export type ChangeDeltaWebhookConfig = {
  url: string;
  signingSecret: string;
  batchSize: number;
  leaseSeconds: number;
  requestTimeoutMs: number;
};

export type ChangeDeltaWebhookDispatchSummary = {
  schemaVersion: "1.0.0";
  claimed: number;
  delivered: number;
  retryScheduled: number;
  deadLettered: number;
};

export type WebhookDeliveryStore = {
  claim(limit: number, leaseSeconds: number): Promise<WebhookDeliveryClaim[]>;
  complete(
    claim: WebhookDeliveryClaim,
    outcome: WebhookDeliveryOutcome,
  ): Promise<"PENDING" | "DELIVERED" | "DEAD_LETTER">;
};

export class ChangeDeltaWebhookStore {
  constructor(private readonly client: SupabaseHttpClient) {}

  async claim(limit: number, leaseSeconds: number): Promise<WebhookDeliveryClaim[]> {
    const raw = await this.client.rpc<unknown>("claim_playbook_webhook_deliveries", {
      p_limit: limit,
      p_lease_seconds: leaseSeconds,
    });
    return parseWebhookDeliveryClaims(raw, limit);
  }

  async complete(
    claim: WebhookDeliveryClaim,
    outcome: WebhookDeliveryOutcome,
  ): Promise<"PENDING" | "DELIVERED" | "DEAD_LETTER"> {
    const raw = await this.client.rpc<unknown>("complete_playbook_webhook_delivery", {
      p_delivery_id: claim.deliveryId,
      p_lease_token: claim.leaseToken,
      p_outcome: outcome.outcome,
      p_response_status: outcome.responseStatus,
      p_error_code: outcome.errorCode,
    });
    if (!isExactRecord(raw, [
      "status", "deliveryId", "deliveryState", "attemptNumber",
    ]) || raw.status !== "RECORDED"
      || raw.deliveryId !== claim.deliveryId
      || raw.attemptNumber !== claim.attemptNumber
      || !isDeliveryState(raw.deliveryState)) {
      throw new DataIntegrityError("webhook delivery completion was not recorded");
    }
    return raw.deliveryState;
  }
}

export async function dispatchChangeDeltaWebhooks(options: {
  store: WebhookDeliveryStore;
  config: ChangeDeltaWebhookConfig;
  fetchImpl?: FetchLike;
  now?: () => Date;
}): Promise<ChangeDeltaWebhookDispatchSummary> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  const claims = await options.store.claim(
    options.config.batchSize,
    options.config.leaseSeconds,
  );
  const summary: ChangeDeltaWebhookDispatchSummary = {
    schemaVersion: "1.0.0",
    claimed: claims.length,
    delivered: 0,
    retryScheduled: 0,
    deadLettered: 0,
  };

  for (const claim of claims) {
    const body = JSON.stringify(claim.payload);
    const timestamp = Math.floor(now().getTime() / 1_000).toString();
    const signature = signChangeDeltaWebhook({
      secret: options.config.signingSecret,
      eventId: claim.payload.id,
      timestamp,
      body,
    });
    const outcome = await sendWebhook({
      url: options.config.url,
      eventId: claim.payload.id,
      timestamp,
      signature,
      body,
      timeoutMs: options.config.requestTimeoutMs,
      fetchImpl,
    });
    const state = await options.store.complete(claim, outcome);
    if (state === "DELIVERED") summary.delivered += 1;
    else if (state === "PENDING") summary.retryScheduled += 1;
    else summary.deadLettered += 1;
  }

  return summary;
}

export function readChangeDeltaWebhookConfig(
  env: Record<string, string | undefined> = process.env,
): ChangeDeltaWebhookConfig {
  const rawUrl = env.CITELY_WEBHOOK_URL?.trim() ?? "";
  const signingSecret = env.CITELY_WEBHOOK_SIGNING_SECRET?.trim() ?? "";
  if (!rawUrl || !signingSecret) {
    throw new Error(
      "CITELY_WEBHOOK_URL and CITELY_WEBHOOK_SIGNING_SECRET are required",
    );
  }
  const url = new URL(rawUrl);
  const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(isLocal && url.protocol === "http:")) {
    throw new Error("CITELY_WEBHOOK_URL must use HTTPS unless it targets localhost");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("CITELY_WEBHOOK_URL must not contain credentials, query, or fragment");
  }
  if (signingSecret.length < 32 || signingSecret.length > 256) {
    throw new Error("CITELY_WEBHOOK_SIGNING_SECRET must contain 32 to 256 characters");
  }
  const batchSize = Number(env.POLICY_WEBHOOK_BATCH_SIZE ?? "10");
  const leaseSeconds = Number(env.POLICY_WEBHOOK_LEASE_SECONDS ?? "60");
  const requestTimeoutMs = Number(env.POLICY_WEBHOOK_TIMEOUT_MS ?? "10000");
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
    throw new Error("POLICY_WEBHOOK_BATCH_SIZE must be between 1 and 20");
  }
  if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds < 10 || leaseSeconds > 300) {
    throw new Error("POLICY_WEBHOOK_LEASE_SECONDS must be between 10 and 300");
  }
  if (
    !Number.isSafeInteger(requestTimeoutMs)
    || requestTimeoutMs < 100
    || requestTimeoutMs > 30_000
    || requestTimeoutMs >= leaseSeconds * 1_000
  ) {
    throw new Error(
      "POLICY_WEBHOOK_TIMEOUT_MS must be between 100 and 30000 and below the lease duration",
    );
  }
  return {
    url: url.toString(),
    signingSecret,
    batchSize,
    leaseSeconds,
    requestTimeoutMs,
  };
}

export function signChangeDeltaWebhook(input: {
  secret: string;
  eventId: string;
  timestamp: string;
  body: string;
}): string {
  return `v1=${createHmac("sha256", input.secret)
    .update(`${input.eventId}.${input.timestamp}.${input.body}`, "utf8")
    .digest("base64url")}`;
}

export function parseWebhookDeliveryClaims(
  value: unknown,
  limit: number,
): WebhookDeliveryClaim[] {
  if (!isExactRecord(value, ["schemaVersion", "claimedAt", "items"])
    || value.schemaVersion !== "1.0.0"
    || typeof value.claimedAt !== "string"
    || !Number.isFinite(Date.parse(value.claimedAt))
    || !Array.isArray(value.items)
    || value.items.length > limit) {
    throw new DataIntegrityError("invalid webhook delivery claim batch");
  }
  const claimedAt = Date.parse(value.claimedAt);
  const deliveryIds = new Set<string>();
  const claims = value.items.map((item) => {
    if (!isExactRecord(item, [
      "deliveryId", "leaseToken", "leaseExpiresAt", "attemptNumber",
      "replayNumber", "delta",
    ])
      || typeof item.deliveryId !== "string"
      || !DELIVERY_ID.test(item.deliveryId)
      || typeof item.leaseToken !== "string"
      || !LEASE_TOKEN.test(item.leaseToken)
      || typeof item.leaseExpiresAt !== "string"
      || !Number.isFinite(Date.parse(item.leaseExpiresAt))
      || Date.parse(item.leaseExpiresAt) <= claimedAt
      || !isPositiveSafeInteger(item.attemptNumber)
      || !isNonNegativeSafeInteger(item.replayNumber)
      || !isRecord(item.delta)
      || typeof item.delta.packageId !== "string"
      || typeof item.delta.watchlistId !== "string") {
      throw new DataIntegrityError("invalid webhook delivery claim");
    }
    if (deliveryIds.has(item.deliveryId)) {
      throw new DataIntegrityError("duplicate webhook delivery claim");
    }
    deliveryIds.add(item.deliveryId);
    const rawDelta = parseRawChangeToActionDelta(
      item.delta,
      item.delta.packageId,
      item.delta.watchlistId,
    );
    const { deltaSequence, ...snapshot } = rawDelta;
    const data: ChangeToActionDelta = {
      ...snapshot,
      cursor: encodeChangeDeltaCursor(
        snapshot.packageId,
        snapshot.watchlistId,
        deltaSequence,
      ),
    };
    const payload: ChangeDeltaWebhookPayload = {
      schemaVersion: "1.0.0",
      type: "playbook.watchlist.change",
      id: data.deltaId,
      createdAt: data.createdAt,
      data,
    };
    return {
      deliveryId: item.deliveryId,
      leaseToken: item.leaseToken,
      leaseExpiresAt: new Date(item.leaseExpiresAt).toISOString(),
      attemptNumber: item.attemptNumber,
      replayNumber: item.replayNumber,
      payload,
    };
  });
  return claims;
}

async function sendWebhook(input: {
  url: string;
  eventId: string;
  timestamp: string;
  signature: string;
  body: string;
  timeoutMs: number;
  fetchImpl: FetchLike;
}): Promise<WebhookDeliveryOutcome> {
  try {
    const response = await input.fetchImpl(input.url, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(input.timeoutMs),
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "citely-stablecoin-policy-webhook/1.0",
        "Webhook-Id": input.eventId,
        "Webhook-Timestamp": input.timestamp,
        "Webhook-Signature": input.signature,
      },
      body: input.body,
    });
    if (response.ok) {
      return {
        outcome: "SUCCEEDED",
        responseStatus: response.status,
        errorCode: null,
      };
    }
    const retryable = response.status === 408
      || response.status === 409
      || response.status === 425
      || response.status === 429
      || response.status >= 500;
    return {
      outcome: retryable ? "RETRYABLE_FAILURE" : "PERMANENT_FAILURE",
      responseStatus: response.status,
      errorCode: `HTTP_${response.status}`,
    };
  } catch (error: unknown) {
    const errorName = error instanceof Error ? error.name : "";
    return {
      outcome: "RETRYABLE_FAILURE",
      responseStatus: null,
      errorCode: errorName === "TimeoutError" || errorName === "AbortError"
        ? "TIMEOUT"
        : "NETWORK_ERROR",
    };
  }
}

function isDeliveryState(value: unknown): value is "PENDING" | "DELIVERED" | "DEAD_LETTER" {
  return value === "PENDING" || value === "DELIVERED" || value === "DEAD_LETTER";
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isExactRecord(
  value: unknown,
  expectedKeys: string[],
): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}
