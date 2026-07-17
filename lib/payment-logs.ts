import { createHash } from "node:crypto";
import { kv } from "@vercel/kv";
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
} from "@okxweb3/x402-core/types";

const PAYMENT_LOG_TTL_SECONDS = 90 * 24 * 60 * 60;

type PaymentLogRecord = {
  slug: string;
  txHash: string;
  paidAt: string;
  amountUSD: number;
  amountAtomic: string;
  network: string;
  payer?: string;
};

export function paymentLogConfigured(): boolean {
  return !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN;
}

export async function reservePaymentPayload(
  slug: string,
  paymentPayload: PaymentPayload,
): Promise<boolean> {
  if (!paymentLogConfigured()) {
    return false;
  }

  const key = `payment-payload:${slug}:${hashPaymentPayload(paymentPayload)}`;
  const result = await kv.set(
    key,
    { slug, seenAt: new Date().toISOString() },
    { ex: PAYMENT_LOG_TTL_SECONDS, nx: true },
  );

  return result === "OK";
}

export async function writePaymentLog(
  slug: string,
  requirements: PaymentRequirements,
  result: SettleResponse,
): Promise<boolean> {
  if (!paymentLogConfigured()) {
    return false;
  }

  const txHash = result.transaction;
  const record: PaymentLogRecord = {
    slug,
    txHash,
    paidAt: new Date().toISOString(),
    amountUSD: atomicUsdcToUsd(requirements.amount),
    amountAtomic: requirements.amount,
    network: result.network,
    ...(result.payer ? { payer: result.payer } : {}),
  };

  const writeResult = await kv.set(`payment:${slug}:${txHash}`, record, {
    ex: PAYMENT_LOG_TTL_SECONDS,
    nx: true,
  });

  return writeResult === "OK";
}

export function getReportSlugFromRequirements(
  requirements: PaymentRequirements,
): string | null {
  const slug = requirements.extra?.reportSlug;
  return typeof slug === "string" ? slug : null;
}

function hashPaymentPayload(
  paymentPayload: PaymentPayload,
): string {
  return createHash("sha256")
    .update(JSON.stringify(paymentPayload))
    .digest("hex");
}

function atomicUsdcToUsd(amount: string): number {
  const atomic = Number(amount);
  if (!Number.isFinite(atomic)) {
    return 0;
  }

  return atomic / 1_000_000;
}
