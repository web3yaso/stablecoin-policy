import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import type { Network } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { createFacilitatorConfig } from "@coinbase/x402";

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

export const x402Server = new x402ResourceServer(facilitatorClient).register(
  X402_NETWORK,
  new ExactEvmScheme(),
);

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
