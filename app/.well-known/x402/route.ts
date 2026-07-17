import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function networkLabel(): string {
  const network = process.env.X402_NETWORK?.trim() || "eip155:1952";
  if (network === "eip155:8453") return "Base mainnet";
  if (network === "eip155:84532") return "Base Sepolia testnet";
  if (network === "eip155:196") return "X Layer mainnet";
  if (network === "eip155:1952") return "X Layer testnet";
  return network;
}

export function GET(request: NextRequest) {
  const origin = new URL(request.url).origin;

  return NextResponse.json(
    {
      version: 1,
      name: "Web3Law Paid Stablecoin Policy Reports",
      serviceType: "A2MCP",
      pricing: "paid-only",
      description: `Paid stablecoin policy reports via x402 on ${networkLabel()}.`,
      instructions:
        "Call GET /api/reports/latest. When it returns 402, read PAYMENT-REQUIRED, create the x402 payment, and retry with PAYMENT-SIGNATURE. The endpoint never returns report content without payment.",
      resources: [
        `${origin}/api/reports/latest`,
        `${origin}/api/reports/{slug}`,
      ],
    },
    {
      headers: {
        "Cache-Control": "public, max-age=300",
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
}
