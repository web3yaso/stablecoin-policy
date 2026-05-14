import "../env";

import { x402Client } from "@x402/core/client";
import { x402HTTPClient } from "@x402/core/http";
import type { Network, PaymentRequired } from "@x402/core/types";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { toClientEvmSigner } from "@x402/evm";
import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

type ReportListResponse = {
  reports: Array<{
    slug: string;
    title: string;
    priceUSD: number;
    fullContentUrl: string;
  }>;
  total: number;
};

const TESTNET_NETWORK = "eip155:84532";
const DEFAULT_BASE_URL = "http://localhost:3000";

async function main() {
  assertTestnet();

  const baseUrl = readBaseUrl();
  const privateKey = readPrivateKey();
  const client = createX402Client(privateKey);

  console.log(`Verifying x402 reports flow against ${baseUrl}`);

  const list = await fetchJson<ReportListResponse>(`${baseUrl}/api/reports`);
  if (!Array.isArray(list.reports) || list.reports.length === 0) {
    throw new Error("Expected /api/reports to return at least one report");
  }

  const report = list.reports[0];
  const paidUrl = new URL(report.fullContentUrl);
  const targetUrl =
    paidUrl.origin === "http://localhost:3000"
      ? `${baseUrl}/api/reports/${report.slug}`
      : report.fullContentUrl;

  console.log(`Selected report: ${report.slug} (${report.title})`);

  const unpaidResponse = await fetch(targetUrl);
  if (unpaidResponse.status !== 402) {
    throw new Error(`Expected unpaid request to return 402, got ${unpaidResponse.status}`);
  }

  const paymentRequired = await readPaymentRequired(client, unpaidResponse);
  assertPaymentRequirements(paymentRequired, report.priceUSD);

  const paymentPayload = await client.createPaymentPayload(paymentRequired);
  const paymentHeaders = client.encodePaymentSignatureHeader(paymentPayload);

  const paidResponse = await fetch(targetUrl, {
    headers: paymentHeaders,
  });

  if (paidResponse.status !== 200) {
    const body = await paidResponse.text();
    throw new Error(
      `Expected paid request to return 200, got ${paidResponse.status}: ${body.slice(0, 300)}`,
    );
  }

  const content = await paidResponse.text();
  if (content.length <= 1000) {
    throw new Error(`Expected report Markdown length > 1000, got ${content.length}`);
  }

  const settlement = client.getPaymentSettleResponse((name) =>
    paidResponse.headers.get(name),
  );
  console.log(`Paid request settled on ${settlement.network}: ${settlement.transaction}`);

  const replayResponse = await fetch(targetUrl, {
    headers: paymentHeaders,
  });

  if (replayResponse.status === 200) {
    throw new Error("Replay request unexpectedly returned 200");
  }

  if (![402, 403].includes(replayResponse.status)) {
    throw new Error(
      `Expected replay request to return 402 or 403, got ${replayResponse.status}`,
    );
  }

  console.log(`Replay rejected with ${replayResponse.status}`);
  console.log("x402 reports verification passed");
}

function createX402Client(privateKey: `0x${string}`): x402HTTPClient {
  const account = privateKeyToAccount(privateKey);
  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(process.env.BASE_SEPOLIA_RPC_URL),
  });
  const signer = toClientEvmSigner(account, publicClient);
  const coreClient = new x402Client();

  registerExactEvmScheme(coreClient, {
    signer,
    networks: [TESTNET_NETWORK as Network],
    schemeOptions: process.env.BASE_SEPOLIA_RPC_URL
      ? { 84532: { rpcUrl: process.env.BASE_SEPOLIA_RPC_URL } }
      : undefined,
  });

  return new x402HTTPClient(coreClient);
}

async function readPaymentRequired(
  client: x402HTTPClient,
  response: Response,
): Promise<PaymentRequired> {
  let body: unknown;
  try {
    body = await response.clone().json();
  } catch {
    body = undefined;
  }

  return client.getPaymentRequiredResponse((name) => response.headers.get(name), body);
}

function assertPaymentRequirements(
  paymentRequired: PaymentRequired,
  expectedPriceUSD: number,
) {
  const requirement = paymentRequired.accepts.find(
    (accepts) => accepts.network === TESTNET_NETWORK && accepts.scheme === "exact",
  );

  if (!requirement) {
    throw new Error("Payment requirements did not include exact scheme on Base Sepolia");
  }

  const expectedAtomicAmount = Math.round(expectedPriceUSD * 1_000_000).toString();
  if (requirement.amount !== expectedAtomicAmount) {
    throw new Error(
      `Expected amount ${expectedAtomicAmount}, got ${requirement.amount}`,
    );
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed: ${url} returned ${response.status}`);
  }

  return (await response.json()) as T;
}

function assertTestnet() {
  const network = process.env.X402_NETWORK || TESTNET_NETWORK;
  if (network !== TESTNET_NETWORK) {
    throw new Error(
      `Refusing to run: X402_NETWORK must be ${TESTNET_NETWORK}, got ${network}`,
    );
  }
}

function readBaseUrl(): string {
  const value = process.env.REPORTS_API_BASE_URL || DEFAULT_BASE_URL;
  return value.replace(/\/+$/, "");
}

function readPrivateKey(): `0x${string}` {
  const privateKey = process.env.TEST_BUYER_PRIVATE_KEY?.trim();
  if (!privateKey) {
    throw new Error("TEST_BUYER_PRIVATE_KEY is required");
  }

  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error("TEST_BUYER_PRIVATE_KEY must be a 32-byte hex private key");
  }

  return privateKey as `0x${string}`;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "unknown error";
  console.error(`x402 verification failed: ${message}`);
  process.exit(1);
});
