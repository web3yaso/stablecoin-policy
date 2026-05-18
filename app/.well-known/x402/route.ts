import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function networkLabel(): string {
  const network = process.env.X402_NETWORK?.trim() || "eip155:84532";
  if (network === "eip155:8453") return "Base mainnet";
  if (network === "eip155:84532") return "Base Sepolia testnet";
  return network;
}

export function GET(request: NextRequest) {
  const origin = new URL(request.url).origin;

  return NextResponse.json(
    {
      version: 1,
      description: `Web3Law stablecoin policy report API. List reports for free, then purchase full Markdown report content via x402 on ${networkLabel()}.`,
      instructions:
        "Call GET /api/reports first to choose a report slug. Then call GET /api/reports/{slug}; if it returns 402, create an x402 payment and retry with X-Payment or Payment-Signature.",
      resources: [
        `${origin}/api/reports`,
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
