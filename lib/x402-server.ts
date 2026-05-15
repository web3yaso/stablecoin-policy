import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import type { Network } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { createFacilitatorConfig } from "@coinbase/x402";
import { bazaarResourceServerExtension } from "@x402/extensions/bazaar";
import {
  getReportSlugFromRequirements,
  reservePaymentPayload,
  writePaymentLog,
} from "./payment-logs";

export const X402_NETWORK = readX402Network();

const facilitatorUrl = process.env.X402_FACILITATOR_URL?.trim();

const facilitatorClient = new HTTPFacilitatorClient(
  facilitatorUrl
    ? { url: facilitatorUrl }
    : createFacilitatorConfig(
        process.env.CDP_API_KEY_ID,
        process.env.CDP_API_KEY_SECRET,
      ),
);

export const x402Server = new x402ResourceServer(facilitatorClient)
  .register(X402_NETWORK, new ExactEvmScheme())
  .registerExtension(bazaarResourceServerExtension);

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

export const x402FacilitatorReady = x402Server
  .initialize()
  .then(() => {
    console.info("x402 facilitator initialized");
  })
  .catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : "unknown initialization error";
    console.warn(`x402 facilitator initialization warning: ${message}`);
  });

function readX402Network(): Network {
  const network = process.env.X402_NETWORK?.trim() || "eip155:84532";

  if (!network.includes(":")) {
    throw new Error(
      "X402_NETWORK must use CAIP-2 format, for example eip155:84532",
    );
  }

  return network as Network;
}
