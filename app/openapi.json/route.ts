import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const origin = new URL(request.url).origin;

  return NextResponse.json(createOpenApiDocument(origin), {
    headers: {
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function createOpenApiDocument(origin: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "Web3Law Stablecoin Policy Reports API",
      version: "1.0.0",
      description:
        "Machine-readable stablecoin regulatory analysis reports. Report metadata is free; full Markdown reports are payable via x402 on Base Sepolia testnet.",
      "x-guidance":
        "Start by calling GET /api/reports to retrieve available reports, summaries, slugs, and prices. Pick a relevant report slug from that response. To retrieve full content, call GET /api/reports/{slug}. If the response is 402 Payment Required, use the x402 payment requirements to create and submit a Base Sepolia USDC payment, then retry the same URL with the X-Payment or Payment-Signature header. Missing slugs return 404 before payment. Do not invent slugs or prices; prices are selected by the server.",
    },
    servers: [{ url: origin }],
    tags: [
      {
        name: "reports",
        description: "Stablecoin policy reports and paid Markdown content.",
      },
    ],
    paths: {
      "/": {
        get: {
          operationId: "getDiscoveryLanding",
          tags: ["reports"],
          summary: "Discovery landing",
          description:
            "Human homepage and discovery landing for this server. Agents should use /api/reports for report metadata and /api/reports/{slug} for paid report content.",
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
          "x-payment-info": {
            authMode: "unprotected",
            protocols: [
              {
                x402: {
                  scheme: "exact",
                  network: "eip155:84532",
                  currency: "USDC",
                  note: "Discovery marker only. The homepage is free and does not require payment.",
                },
              },
            ],
            price: {
              mode: "fixed",
              currency: "USD",
              amount: "0",
            },
          },
          responses: {
            "200": {
              description: "Human-readable homepage",
              content: {
                "text/html": {
                  schema: {
                    type: "string",
                  },
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
          "x-payment-info": {
            authMode: "unprotected",
            protocols: [
              {
                x402: {
                  scheme: "exact",
                  network: "eip155:84532",
                  currency: "USDC",
                  note: "Discovery marker only. This list endpoint is free and does not require payment at runtime.",
                },
              },
            ],
            price: {
              mode: "fixed",
              currency: "USD",
              amount: "0",
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
                  network: "eip155:84532",
                  currency: "USDC",
                  paymentHeaders: ["X-Payment", "Payment-Signature"],
                },
              },
            ],
            price: {
              mode: "fixed",
              currency: "USD",
              amount: "0.01",
            },
          },
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
          required: ["reports", "total", "lastUpdated"],
          additionalProperties: false,
          properties: {
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
