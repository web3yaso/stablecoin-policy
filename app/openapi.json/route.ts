import { NextResponse, type NextRequest } from "next/server";
import { getReportMetaBySlug, listReports } from "@/lib/reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PriceInfo =
  | { mode: "fixed"; currency: "USD"; amount: string }
  | { mode: "dynamic"; currency: "USD"; min: string; max: string };

export async function GET(request: NextRequest) {
  const origin = new URL(request.url).origin;

  return NextResponse.json(
    createOpenApiDocument(
      origin,
      readOwnershipProofs(),
      readX402Network(),
      await readPriceInfo(),
      await readLatestPriceInfo(),
    ),
    {
      headers: {
        "Cache-Control": "public, max-age=300",
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
}

// Reflect the real catalog: a single price → fixed, varying prices →
// dynamic range. The per-report price is what the runtime 402 charges,
// so this never advertises a price the endpoint won't honor.
async function readPriceInfo(): Promise<PriceInfo> {
  try {
    const prices = (await listReports()).map((r) => r.priceUSD);
    if (prices.length === 0) {
      return { mode: "fixed", currency: "USD", amount: "0.01" };
    }
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    return min === max
      ? { mode: "fixed", currency: "USD", amount: min.toFixed(2) }
      : {
          mode: "dynamic",
          currency: "USD",
          min: min.toFixed(2),
          max: max.toFixed(2),
        };
  } catch {
    return { mode: "fixed", currency: "USD", amount: "0.01" };
  }
}

async function readLatestPriceInfo(): Promise<PriceInfo> {
  try {
    const report = await getReportMetaBySlug("latest");
    return {
      mode: "fixed",
      currency: "USD",
      amount: (report?.priceUSD ?? 0.1).toFixed(2),
    };
  } catch {
    return { mode: "fixed", currency: "USD", amount: "0.10" };
  }
}

function readOwnershipProofs(): string[] {
  return (process.env.X402_OWNERSHIP_PROOFS ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
}

// Mirror lib/x402-server.ts's network resolution so the advertised
// network in this static doc never diverges from the runtime 402
// challenge. Imported indirectly (not from x402-server) to avoid
// pulling facilitator init into the openapi route.
function readX402Network(): string {
  return process.env.X402_NETWORK?.trim() || "eip155:1952";
}

function networkLabel(network: string): string {
  if (network === "eip155:8453") return "Base mainnet";
  if (network === "eip155:84532") return "Base Sepolia testnet";
  if (network === "eip155:196") return "X Layer mainnet";
  if (network === "eip155:1952") return "X Layer testnet";
  return network;
}

function createOpenApiDocument(
  origin: string,
  ownershipProofs: string[],
  network: string,
  price: PriceInfo,
  latestPrice: PriceInfo,
) {
  const label = networkLabel(network);
  return {
    openapi: "3.1.0",
    info: {
      title: "Web3Law Stablecoin Policy Reports API",
      version: "1.0.0",
      description: `Machine-readable stablecoin regulatory analysis reports. Report metadata is free; full Markdown reports are payable via x402 on ${label}.`,
      "x-guidance": `Call GET /api/reports/latest to purchase the newest report, or use a slug selected from GET /api/reports. If the response is 402 Payment Required, read PAYMENT-REQUIRED, submit the exact payment requested on ${label}, then retry the same URL with PAYMENT-SIGNATURE. Report content is never returned without payment.`,
    },
    servers: [{ url: origin }],
    tags: [
      {
        name: "reports",
        description: "Stablecoin policy reports and paid Markdown content.",
      },
    ],
    paths: {
      "/api/reports/latest": {
        get: {
          operationId: "getLatestPaidStablecoinPolicyReport",
          tags: ["reports"],
          summary: "Purchase the latest stablecoin policy report",
          description:
            "Stable ASP endpoint for OKX.AI. Returns the latest full Markdown report after x402 payment. The URL remains unchanged when a new report is published.",
          "x-payment-info": {
            protocols: [
              {
                x402: {
                  scheme: "exact",
                  network,
                  currency: "USD₮0",
                  paymentHeaders: ["PAYMENT-SIGNATURE", "Payment-Signature", "X-Payment"],
                },
              },
            ],
            price: latestPrice,
          },
          responses: {
            "200": {
              description: "Latest full report in Markdown",
              content: {
                "text/markdown": { schema: { type: "string" } },
              },
            },
            "402": { description: "Payment Required; inspect PAYMENT-REQUIRED response header" },
            "503": {
              description: "Service unavailable",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
          },
        },
      },
      "/api/reports": {
        get: {
          operationId: "listReports",
          tags: ["reports"],
          summary: "List available stablecoin policy reports",
          description:
            "Returns public metadata, summaries, prices, and paid content URLs for available reports. This endpoint is free.",
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  properties: {},
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Report list",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ReportListResponse" },
                },
              },
            },
            "429": {
              description: "Too Many Requests",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
          },
        },
      },
      "/api/reports/{slug}": {
        get: {
          operationId: "getPaidReportMarkdown",
          tags: ["reports"],
          summary: "Get full report Markdown",
          description:
            "Returns the full Markdown content for a report after x402 payment. Without a valid payment header, this endpoint returns 402 Payment Required.",
          parameters: [
            {
              name: "slug",
              in: "path",
              required: true,
              description:
                "Report slug returned by GET /api/reports. Do not guess slugs.",
              schema: {
                type: "string",
                pattern: "^[a-z0-9][a-z0-9-]{5,80}$",
                examples: ["web3-1-bm6nnqo"],
              },
            },
          ],
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    slug: {
                      type: "string",
                      description:
                        "Optional mirror of the path slug for agent invocation planners.",
                      pattern: "^[a-z0-9][a-z0-9-]{5,80}$",
                    },
                  },
                },
              },
            },
          },
          "x-payment-info": {
            protocols: [
              {
                x402: {
                  scheme: "exact",
                  network,
                  currency: "USD₮0",
                  paymentHeaders: ["X-Payment", "Payment-Signature"],
                },
              },
            ],
            price,
          },
          ...(ownershipProofs.length > 0
            ? { "x-discovery": { ownershipProofs } }
            : {}),
          responses: {
            "200": {
              description: "Full report Markdown",
              headers: {
                "X-Report-Slug": {
                  description: "Report slug",
                  schema: { type: "string" },
                },
                "X-Word-Count": {
                  description: "Approximate report word count",
                  schema: { type: "string" },
                },
              },
              content: {
                "text/markdown": {
                  schema: {
                    type: "string",
                    description: "Full report content in Markdown.",
                  },
                },
              },
            },
            "402": {
              description: "Payment Required",
            },
            "404": {
              description: "Report not found",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
            "503": {
              description: "Service unavailable",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        ReportListResponse: {
          type: "object",
          required: ["schemaVersion", "reports", "total", "lastUpdated"],
          additionalProperties: false,
          properties: {
            schemaVersion: { type: "string", const: "1.0.0" },
            reports: {
              type: "array",
              items: { $ref: "#/components/schemas/ReportMeta" },
            },
            total: { type: "integer", minimum: 0 },
            lastUpdated: {
              type: "string",
              format: "date-time",
            },
          },
        },
        ReportMeta: {
          type: "object",
          required: [
            "slug",
            "title",
            "summary",
            "category",
            "jurisdiction",
            "publishedAt",
            "wordCount",
            "priceUSD",
            "fullContentUrl",
          ],
          additionalProperties: false,
          properties: {
            slug: {
              type: "string",
              pattern: "^[a-z0-9][a-z0-9-]{5,80}$",
            },
            title: { type: "string" },
            title_en: { type: "string" },
            summary: { type: "string" },
            category: {
              type: "string",
              enum: [
                "enforcement",
                "policy",
                "licensing",
                "sanctions",
                "analysis",
              ],
            },
            jurisdiction: {
              type: "array",
              items: { type: "string" },
            },
            publishedAt: { type: "string", format: "date-time" },
            wordCount: { type: "integer", minimum: 0 },
            priceUSD: { type: "number", minimum: 0 },
            fullContentUrl: { type: "string", format: "uri" },
          },
        },
        ErrorResponse: {
          type: "object",
          required: ["error"],
          additionalProperties: false,
          properties: {
            error: { type: "string" },
          },
        },
      },
    },
  };
}
