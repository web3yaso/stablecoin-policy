import { OKXFacilitatorClient } from "@okxweb3/x402-core";
import { x402ResourceServer } from "@okxweb3/x402-core/server";
import type { Network } from "@okxweb3/x402-core/types";
import { ExactEvmScheme } from "@okxweb3/x402-evm/exact/server";
import {
  getReportSlugFromRequirements,
  reservePaymentPayload,
  writePaymentLog,
} from "./payment-logs";

export const X402_NETWORK = readX402Network();

const facilitatorClient = new OKXFacilitatorClient({
  apiKey: process.env.OKX_API_KEY?.trim() ?? "",
  secretKey: process.env.OKX_SECRET_KEY?.trim() ?? "",
  passphrase: process.env.OKX_PASSPHRASE?.trim() ?? "",
  baseUrl: process.env.OKX_X402_BASE_URL?.trim() || "https://web3.okx.com",
  syncSettle: true,
});

export const x402Server = new x402ResourceServer(facilitatorClient)
  .register(X402_NETWORK, new ExactEvmScheme());

x402Server.onBeforeSettle(async (context) => {
  const slug = getReportSlugFromRequirements(context.requirements);
  if (!slug) {
    return { abort: true, reason: "missing-report-slug" };
  }

  const reserved = await reservePaymentPayload(slug, context.paymentPayload);
  if (!reserved) {
    return {
      abort: true,
      reason: "payment-replay-or-log-unavailable",
      message: "Payment could not be accepted.",
    };
  }
});

x402Server.onAfterSettle(async (context) => {
  const slug = getReportSlugFromRequirements(context.requirements);
  if (!slug) {
    return;
  }

  try {
    await writePaymentLog(slug, context.requirements, context.result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.warn(`x402 payment log warning: ${message}`);
  }
});

let initialization: Promise<void> | undefined;

export function ensureX402FacilitatorReady(): Promise<void> {
  if (
    !process.env.OKX_API_KEY?.trim() ||
    !process.env.OKX_SECRET_KEY?.trim() ||
    !process.env.OKX_PASSPHRASE?.trim()
  ) {
    throw new Error("OKX x402 facilitator credentials are not configured");
  }

  initialization ??= x402Server.initialize();
  return initialization;
}

function readX402Network(): Network {
  const network = process.env.X402_NETWORK?.trim() || "eip155:1952";

  if (!network.includes(":")) {
    throw new Error(
      "X402_NETWORK must use CAIP-2 format, for example eip155:1952",
    );
  }

  return network as Network;
}
