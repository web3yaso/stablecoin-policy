import { createSign } from "node:crypto";
import { kv } from "@vercel/kv";
import { AlipaySdk } from "alipay-sdk";

/**
 * Alipay "AI 收" (A2M / agent-payment) server helpers.
 *
 * Mirrors the x402 paid-report flow but speaks Alipay's HTTP-402 scheme:
 *   1. No `Payment-Proof` request header  → 402 + `Payment-Needed` header
 *      (Base64URL of {protocol, method}, protocol RSA2-signed by the seller).
 *   2. With `Payment-Proof` header        → verify via
 *      `alipay.aipay.agent.payment.verify`, fulfil, then confirm via
 *      `alipay.aipay.agent.fulfillment.confirm`.
 *
 * Protocol field names and the signing recipe follow Alipay's official
 * Node.js reference (skills/alipay-payment-integration/.../10_AI收).
 *
 * AI 收 has NO sandbox — the live path requires production merchant
 * credentials. Construction + signing are exercised offline by
 * scripts/smoke/alipay-402-dryrun.ts.
 */

const DEFAULT_GATEWAY = "https://openapi.alipay.com/gateway.do";
const DEFAULT_PRICE_CNY = "0.10";
const DEFAULT_CURRENCY = "CNY";
/** AI 收 fixes these per Alipay's integration guide; not user-configurable. */
const SIGN_TYPE = "RSA2";
/** How long a 402 quote stays payable. */
const PAY_WINDOW_MS = 30 * 60 * 1000;
/** Fulfillment idempotency record lifetime. */
const FULFILLMENT_TTL_SECONDS = 90 * 24 * 60 * 60;

type KeyType = "PKCS1" | "PKCS8";

export type AlipayConfig = {
  appId: string;
  /** Raw key body (no PEM armor) as downloaded from Alipay's key tool. */
  privateKey: string;
  privateKeyPem: string;
  alipayPublicKey?: string;
  gateway: string;
  sellerId: string;
  serviceId: string;
  sellerName: string;
  keyType: KeyType;
  priceCNY: string;
  currency: string;
};

export class AlipayConfigMissingError extends Error {
  constructor(missing: string[]) {
    super(`Alipay AI-collection is not configured: missing ${missing.join(", ")}`);
    this.name = "AlipayConfigMissingError";
  }
}

const REQUIRED_ENV = [
  "ALIPAY_APP_ID",
  "ALIPAY_PRIVATE_KEY",
  "ALIPAY_SELLER_ID",
  "ALIPAY_SERVICE_ID",
] as const;

function env(name: string): string | undefined {
  const raw = process.env[name];
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

export function alipayConfigured(): boolean {
  return REQUIRED_ENV.every((name) => !!env(name));
}

export function getAlipayConfig(): AlipayConfig {
  const missing = REQUIRED_ENV.filter((name) => !env(name));
  if (missing.length > 0) {
    throw new AlipayConfigMissingError(missing);
  }

  const keyType = (env("ALIPAY_KEY_TYPE") ?? "PKCS1").toUpperCase() as KeyType;
  if (keyType !== "PKCS1" && keyType !== "PKCS8") {
    throw new Error("ALIPAY_KEY_TYPE must be PKCS1 or PKCS8");
  }

  const privateKey = env("ALIPAY_PRIVATE_KEY")!;

  return {
    appId: env("ALIPAY_APP_ID")!,
    privateKey,
    privateKeyPem: toPrivateKeyPem(privateKey, keyType),
    alipayPublicKey: env("ALIPAY_PUBLIC_KEY"),
    gateway: env("ALIPAY_GATEWAY") ?? DEFAULT_GATEWAY,
    sellerId: env("ALIPAY_SELLER_ID")!,
    serviceId: env("ALIPAY_SERVICE_ID")!,
    sellerName: env("ALIPAY_SELLER_NAME") ?? "Stablecoin Policy",
    keyType,
    priceCNY: env("ALIPAY_REPORT_PRICE_CNY") ?? DEFAULT_PRICE_CNY,
    currency: env("ALIPAY_CURRENCY") ?? DEFAULT_CURRENCY,
  };
}

let cachedSdk: AlipaySdk | null = null;

export function getAlipaySdk(config: AlipayConfig): AlipaySdk {
  if (!cachedSdk) {
    cachedSdk = new AlipaySdk({
      appId: config.appId,
      privateKey: config.privateKey,
      alipayPublicKey: config.alipayPublicKey,
      gateway: config.gateway,
      keyType: config.keyType,
      signType: SIGN_TYPE,
    });
  }
  return cachedSdk;
}

// ---------------------------------------------------------------------------
// Encoding / key helpers
// ---------------------------------------------------------------------------

/** ISO 8601 with timezone offset, e.g. 2026-06-16T12:08:36+08:00. */
export function formatISO8601WithTimezone(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

export function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function base64UrlDecode(input: string): string {
  let s = input.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64").toString("utf8");
}

/** Wrap a raw base64 key body (as Alipay's tool emits) into PEM armor. */
export function toPrivateKeyPem(key: string, keyType: KeyType): string {
  if (key.includes("BEGIN")) {
    // Already PEM (possibly with escaped newlines from a single-line env var).
    return key.replace(/\\n/g, "\n");
  }
  const label = keyType === "PKCS1" ? "RSA PRIVATE KEY" : "PRIVATE KEY";
  const body = key.replace(/\s+/g, "").match(/.{1,64}/g)?.join("\n") ?? "";
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`;
}

/**
 * seller_signature: RSA2 over `k1=v1&k2=v2...` of the protocol params, keys in
 * ascii order, empty/null values dropped. Matches the official reference.
 */
export function generateSellerSignature(
  params: Record<string, string>,
  privateKeyPem: string,
): string {
  const signContent = Object.keys(params)
    .sort()
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== "")
    .map((k) => `${k}=${params[k]}`)
    .join("&");

  return createSign("RSA-SHA256").update(signContent, "utf8").sign(privateKeyPem, "base64");
}

// ---------------------------------------------------------------------------
// Payment-Needed (402) construction
// ---------------------------------------------------------------------------

export type PaymentNeeded = {
  protocol: {
    out_trade_no: string;
    amount: string;
    currency: string;
    resource_id: string;
    pay_before: string;
    seller_signature: string;
    seller_sign_type: string;
    seller_unique_id: string;
  };
  method: {
    seller_name: string;
    seller_id: string;
    seller_app_id: string;
    goods_name: string;
    seller_unique_id_key: string;
    service_id: string;
  };
};

export function newOutTradeNo(now: number, suffix: string): string {
  return `RPT_${now}_${suffix}`;
}

/**
 * Build the decoded Payment-Needed object and its Base64URL header value.
 * `now` is injected so the smoke test is deterministic.
 */
export function buildPaymentNeeded(opts: {
  config: AlipayConfig;
  resourceId: string;
  goodsName: string;
  outTradeNo: string;
  now: Date;
}): { decoded: PaymentNeeded; header: string; payBefore: string } {
  const { config, resourceId, goodsName, outTradeNo, now } = opts;
  const payBefore = formatISO8601WithTimezone(new Date(now.getTime() + PAY_WINDOW_MS));

  const sellerSignature = generateSellerSignature(
    {
      amount: config.priceCNY,
      currency: config.currency,
      goods_name: goodsName,
      out_trade_no: outTradeNo,
      pay_before: payBefore,
      resource_id: resourceId,
      seller_id: config.sellerId,
      service_id: config.serviceId,
    },
    config.privateKeyPem,
  );

  const decoded: PaymentNeeded = {
    protocol: {
      out_trade_no: outTradeNo,
      amount: config.priceCNY,
      currency: config.currency,
      resource_id: resourceId,
      pay_before: payBefore,
      seller_signature: sellerSignature,
      seller_sign_type: SIGN_TYPE,
      seller_unique_id: config.sellerId,
    },
    method: {
      seller_name: config.sellerName,
      seller_id: config.sellerId,
      seller_app_id: config.appId,
      goods_name: goodsName,
      seller_unique_id_key: "seller_id",
      service_id: config.serviceId,
    },
  };

  return { decoded, header: base64UrlEncode(JSON.stringify(decoded)), payBefore };
}

// ---------------------------------------------------------------------------
// Payment-Proof verification + fulfillment
// ---------------------------------------------------------------------------

export type ParsedProof = {
  paymentProof: string;
  tradeNo: string;
  clientSession?: string;
};

export function parsePaymentProof(headerValue: string): ParsedProof {
  const proof = JSON.parse(base64UrlDecode(headerValue)) as {
    protocol?: { payment_proof?: string; trade_no?: string };
    method?: { client_session?: string };
  };

  const paymentProof = proof.protocol?.payment_proof?.trim();
  const tradeNo = proof.protocol?.trade_no?.trim();
  if (!paymentProof) throw new Error("Payment-Proof missing protocol.payment_proof");
  if (!tradeNo) throw new Error("Payment-Proof missing protocol.trade_no");

  return { paymentProof, tradeNo, clientSession: proof.method?.client_session };
}

export type VerifyResult = {
  code: string;
  subCode?: string;
  subMsg?: string;
  active: boolean;
  tradeNo?: string;
  outTradeNo?: string;
  resourceId?: string;
};

export async function verifyPaymentProof(
  sdk: AlipaySdk,
  parsed: ParsedProof,
): Promise<VerifyResult> {
  const raw = (await sdk.exec("alipay.aipay.agent.payment.verify", {
    bizContent: {
      payment_proof: parsed.paymentProof,
      trade_no: parsed.tradeNo,
      client_session: parsed.clientSession,
    },
  })) as Record<string, unknown>;

  // SDK may return flat or nested under the response key.
  const data = (raw.alipay_aipay_agent_payment_verify_response ?? raw) as Record<
    string,
    unknown
  >;

  return {
    code: String(data.code ?? ""),
    subCode: data.sub_code ? String(data.sub_code) : undefined,
    subMsg: data.sub_msg ? String(data.sub_msg) : undefined,
    active: data.active === true,
    tradeNo: data.trade_no ? String(data.trade_no) : undefined,
    outTradeNo: data.out_trade_no ? String(data.out_trade_no) : undefined,
    resourceId: data.resource_id ? String(data.resource_id) : undefined,
  };
}

export async function sendFulfillmentConfirm(
  sdk: AlipaySdk,
  tradeNo: string,
): Promise<boolean> {
  const raw = (await sdk.exec("alipay.aipay.agent.fulfillment.confirm", {
    bizContent: { trade_no: tradeNo },
  })) as Record<string, unknown>;

  const data = (raw.alipay_aipay_agent_fulfillment_confirm_response ?? raw) as Record<
    string,
    unknown
  >;
  return String(data.code ?? "") === "10000";
}

export function buildPaymentValidation(opts: {
  tradeNo: string;
  outTradeNo: string;
  resourceId: string;
}): string {
  return base64UrlEncode(
    JSON.stringify({
      trade_no: opts.tradeNo,
      out_trade_no: opts.outTradeNo,
      validated: true,
      resource_id: opts.resourceId,
    }),
  );
}

// ---------------------------------------------------------------------------
// Fulfillment idempotency (Vercel KV) — guards against replayed proofs
// double-delivering the report. No-op when KV is unconfigured.
// ---------------------------------------------------------------------------

export function fulfillmentLogConfigured(): boolean {
  return !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN;
}

/** Returns true if this trade_no was newly reserved (i.e. not a replay). */
export async function reserveFulfillment(tradeNo: string): Promise<boolean> {
  if (!fulfillmentLogConfigured()) {
    return true;
  }
  const result = await kv.set(
    `alipay-fulfillment:${tradeNo}`,
    { tradeNo, fulfilledAt: new Date().toISOString() },
    { ex: FULFILLMENT_TTL_SECONDS, nx: true },
  );
  return result === "OK";
}
