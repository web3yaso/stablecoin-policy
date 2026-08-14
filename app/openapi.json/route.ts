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
      title: "Citely Stablecoin Policy Domain API",
      version: "1.0.0",
      description: `Reviewed stablecoin regulatory intelligence, public policy datasets, and analysis reports. Report metadata is free; full Markdown reports are payable via x402 on ${label}.`,
      "x-guidance": `Call GET /api/reports/latest to purchase the newest report, or use a slug selected from GET /api/reports. If the response is 402 Payment Required, read PAYMENT-REQUIRED, submit the exact payment requested on ${label}, then retry the same URL with PAYMENT-SIGNATURE. Report content is never returned without payment.`,
    },
    servers: [{ url: origin }],
    tags: [
      {
        name: "legal-corpus",
        description:
          "Reviewed official-source coverage, citations, and regulatory changes. News and research remain discovery/context only.",
      },
      {
        name: "datasets",
        description: "Public versioned policy datasets.",
      },
      {
        name: "reports",
        description: "Stablecoin policy reports and paid Markdown content.",
      },
      {
        name: "playbooks",
        description:
          "Deterministic capability-level playbook evaluations over provisional machine-assured evidence. Visibly provisional; never legal advice.",
      },
      {
        name: "evidence",
        description:
          "Authenticated, version-pinned retrieval of exact regulatory evidence. Retrieval never changes deterministic decisions.",
      },
    ],
    paths: {
      "/v1/coverage": {
        get: {
          operationId: "getLegalCorpusCoverage",
          tags: ["legal-corpus"],
          summary: "Inspect reviewed legal-corpus coverage",
          description:
            "Returns explicit completeness and freshness for launch markets. IN_PROGRESS is not a legal permission or a paid-check result.",
          responses: {
            "200": {
              description: "Coverage by market",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/CoverageResponse" },
                },
              },
            },
            "503": {
              description: "Legal corpus unavailable",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
          },
        },
      },
      "/v1/sources/{id}": {
        get: {
          operationId: "getReviewedLegalSource",
          tags: ["legal-corpus"],
          summary: "Get a source from the latest published corpus",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string", pattern: "^[a-z0-9][a-z0-9._:-]{2,160}$" },
            },
          ],
          responses: {
            "200": {
              description: "Reviewed document, provision locators, and claims",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/PublicSourceResponse" },
                },
              },
            },
            "304": { description: "Not Modified" },
            "404": {
              description: "Source is absent from the published corpus",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
            "503": {
              description: "Legal corpus unavailable",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
          },
        },
      },
      "/v1/changes": {
        get: {
          operationId: "listReviewedRegulatoryChanges",
          tags: ["legal-corpus"],
          summary: "Read reviewed changes using an opaque cursor",
          parameters: [
            {
              name: "after_cursor",
              in: "query",
              required: false,
              schema: { type: "string", maxLength: 512 },
            },
          ],
          responses: {
            "200": {
              description: "Reviewed changes affecting published claims",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ChangesResponse" },
                },
              },
            },
            "400": {
              description: "Invalid cursor",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
            "503": {
              description: "Legal corpus unavailable",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
          },
        },
      },
      "/v1/playbooks": {
        get: {
          operationId: "listPlaybooks",
          tags: ["playbooks"],
          summary: "List available playbooks",
          description:
            "Presentation-safe catalog of the launch playbooks: names, versions, descriptions, and capability titles. Raw decision rules are never exposed. Evaluations run on provisional machine-assured evidence and are research, not legal advice.",
          responses: {
            "200": {
              description: "Playbook catalog",
              content: { "application/json": { schema: { type: "object" } } },
            },
          },
        },
      },
      "/v1/playbooks/{id}": {
        get: {
          operationId: "getPlaybook",
          tags: ["playbooks"],
          summary: "Get presentation-safe playbook details",
          description:
            "Returns public catalog metadata plus a strict JSON Schema 2020-12 intake contract that a domain-agnostic client can render and validate. The response never exposes raw decision rules, dossier checks, actions, prompts, private graphs, or evidence topics.",
          parameters: [{
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string", pattern: "^[a-z0-9-]+$" },
          }],
          responses: {
            "200": {
              description:
                "Presentation-safe playbook detail (contracts/v1/playbook-detail-response.schema.json)",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/PlaybookDetailResponse" },
                },
              },
            },
            "404": {
              description: "Unknown or malformed playbook ID",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
          },
        },
      },
      "/v1/evidence/search": {
        post: {
          operationId: "searchRegulatoryEvidence",
          tags: ["evidence"],
          summary: "Search pinned regulatory evidence",
          description:
            "Hybrid lexical/vector retrieval over an immutable corpus and index release. Requires a short-lived Citely service JWT with an evidence:search entitlement. Returns exact citations and explicit insufficient, conflicting, unauthorized, stale, or unavailable states. Version 1 returns no generated narrative and cannot assign or change a deterministic decision status.",
          security: [{ playbookServiceKey: [] }],
          requestBody: {
            required: true,
            description:
              "Strict wire contract: contracts/v1/playbook-package-create-request.schema.json. Unknown properties are rejected.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  description:
                    "Strict contract: contracts/v1/evidence-search-request.schema.json",
                },
              },
            },
          },
          responses: {
            "200": {
              description:
                "Typed retrieval result: contracts/v1/evidence-search-response.schema.json",
              content: { "application/json": { schema: { type: "object" } } },
            },
            "400": { description: "Invalid request" },
            "401": { description: "Missing or invalid service token" },
            "403": { description: "Valid token without evidence:search entitlement" },
            "503": { description: "Retrieval unconfigured or unavailable" },
          },
        },
      },
      "/v1/playbook-packages": {
        post: {
          operationId: "createPlaybookPackage",
          tags: ["playbooks"],
          summary: "Create a PlaybookPackage and EvidenceBundle",
          description:
            "Requires a short-lived Citely service JWT with a playbook:execute entitlement targeting the requested playbook. It then claims a hashed idempotency key, evaluates deterministic rules, optionally retrieves presentation-safe evidence, and persists the complete response as an immutable private artifact before returning it. The database stores queryable metadata and fingerprints, never the raw customer profile, entitlement token, or raw idempotency key. Retrieval can enrich only the EvidenceBundle and retrieval version pins; failure cannot change conclusions. The response is visibly provisional and is never legal advice.",
          security: [{ playbookServiceKey: [] }],
          parameters: [{
            name: "Idempotency-Key",
            in: "header",
            required: true,
            description:
              "Opaque 8-128 character retry key. The raw value is hashed before persistence; reuse with a different request returns 409.",
            schema: {
              type: "string",
              minLength: 8,
              maxLength: 128,
              pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$",
            },
          }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["playbookId", "profile"],
                  additionalProperties: false,
                  properties: {
                    playbookId: {
                      enum: [
                        "stablecoin-pre-listing",
                        "business-model-regulatory-boundary",
                      ],
                    },
                    profile: {
                      type: "object",
                      required: [
                        "operatorJurisdiction", "targetJurisdiction", "activities",
                      ],
                      additionalProperties: false,
                      properties: {
                        operatorJurisdiction: { type: "string", minLength: 1 },
                        targetJurisdiction: { const: "EEA" },
                        activities: {
                          type: "array",
                          minItems: 1,
                          uniqueItems: true,
                          items: { type: "string", minLength: 1 },
                        },
                        asset: {
                          type: ["object", "null"],
                          required: ["symbol", "networks"],
                          additionalProperties: false,
                          properties: {
                            symbol: { type: "string", minLength: 1 },
                            networks: {
                              type: "array",
                              uniqueItems: true,
                              items: { type: "string", minLength: 1 },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description:
                "Exact immutable artifact replay for a completed Idempotency-Key",
              headers: {
                "Idempotency-Replayed": {
                  schema: { type: "string", const: "true" },
                },
              },
              content: { "application/json": { schema: { type: "object" } } },
            },
            "201": {
              description:
                "Package and evidence bundle schema 1.1.0 (contracts/v1/playbook-package-response.schema.json)",
              content: { "application/json": { schema: { type: "object" } } },
            },
            "400": { description: "Invalid profile or JSON" },
            "401": { description: "Missing or invalid service token" },
            "403": { description: "Valid token without entitlement for this playbook" },
            "404": { description: "Unknown playbook" },
            "409": {
              description:
                "Idempotency-Key conflict or an identical request is still in progress",
            },
            "503": {
              description:
                "Core runtime, claim evidence, or immutable artifact persistence unavailable",
            },
          },
        },
      },
      "/v1/playbook-packages/{id}": {
        get: {
          operationId: "getPlaybookPackage",
          tags: ["playbooks"],
          summary: "Replay an immutable PlaybookPackage artifact",
          description:
            "Requires a short-lived Citely service JWT with a playbook:read entitlement targeting this exact package ID. Returns the exact checksum-verified PlaybookPackage + EvidenceBundle artifact stored by package creation and is never publicly cached.",
          security: [{ playbookServiceKey: [] }],
          parameters: [{
            name: "id",
            in: "path",
            required: true,
            schema: {
              type: "string",
              pattern: "^package:[a-z0-9-]+:[0-9a-f]{16}$",
            },
          }],
          responses: {
            "200": {
              description:
                "Checksum-verified package schema 1.1.0 (contracts/v1/playbook-package-response.schema.json)",
              content: { "application/json": { schema: { type: "object" } } },
            },
            "401": { description: "Missing or invalid service token" },
            "403": { description: "Valid token without entitlement for this package" },
            "404": { description: "Unknown package" },
            "503": { description: "Artifact metadata or Storage unavailable" },
          },
        },
      },
      "/v1/claims/{id}": {
        get: {
          operationId: "getProvisionalClaim",
          tags: ["legal-corpus"],
          summary: "Get a provisionally published machine-assured claim",
          description:
            "Returns a claim published through the provisional machine-assurance lane. Every response carries assuranceLevel, reviewStatus, confidence, asOf, exact source version and citations, limitations, and counsel triggers. reviewStatus is HUMAN_REVIEWED only when a named-human review record exists; machine output is never presented as reviewed legal advice.",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string", pattern: "^[a-z0-9][a-z0-9._:-]{2,160}$" },
            },
          ],
          responses: {
            "200": {
              description: "Provisional claim with the mandatory assurance envelope",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ProvisionalClaimResponse" },
                },
              },
            },
            "404": {
              description: "Claim is not provisionally published",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
            "503": {
              description: "Provisional corpus unavailable",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
          },
        },
      },
      "/v1/provisional/coverage": {
        get: {
          operationId: "getProvisionalCoverage",
          tags: ["legal-corpus"],
          summary: "Inspect provisional machine-assured coverage",
          description:
            "Latest provisional release per jurisdiction. Deliberately has no completenessPercent: machine publication can never claim reviewed completeness, which remains owned by the named-human coverage workflow at /v1/coverage.",
          responses: {
            "200": {
              description: "Provisional coverage by market",
              content: {
                "application/json": {
                  schema: {
                    $ref: "#/components/schemas/ProvisionalCoverageResponse",
                  },
                },
              },
            },
            "503": {
              description: "Provisional corpus unavailable",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
          },
        },
      },
      "/v1/policy-feed": {
        get: {
          operationId: "getPolicyFeed",
          tags: ["datasets"],
          summary: "Get the flat policy-update feed",
          description:
            "Thin versioned projection of the active news-summaries release for the Citely main site. Items come only from official first-party sources; generatedAt is the immutable release's generation time, never the request time. Consumers must validate the whole response against the v1 schema and reject it atomically on mismatch.",
          responses: {
            "200": {
              description: "Flat policy feed",
              headers: {
                ETag: { schema: { type: "string" } },
                "X-Policy-Feed-Schema-Version": {
                  schema: { type: "string", const: "1.0.0" },
                },
                "X-Data-Generated-At": {
                  schema: { type: "string", format: "date-time" },
                },
                "X-Data-Cache-State": {
                  schema: {
                    type: "string",
                    enum: ["origin", "fresh-cache", "stale-cache"],
                  },
                },
                "X-Data-Stale": {
                  description: "Present and true when serving an allowed stale snapshot",
                  schema: { type: "string", enum: ["true"] },
                },
              },
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/PolicyFeedResponse" },
                },
              },
            },
            "304": { description: "Not Modified" },
            "503": {
              description:
                "Source dataset missing, unsupported, expired, or the projection failed; no partial feed is ever returned",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
          },
        },
      },
      "/api/public/datasets/{datasetId}": {
        get: {
          operationId: "getPublicPolicyDataset",
          tags: ["datasets"],
          summary: "Get an active public dataset release",
          description:
            "Returns the active checksum-verified dataset. Responses identify the immutable release and explicitly mark a stale-cache fallback.",
          parameters: [
            {
              name: "datasetId",
              in: "path",
              required: true,
              schema: {
                type: "string",
                enum: ["news-summaries", "news-source-health"],
              },
            },
          ],
          responses: {
            "200": {
              description: "Active public dataset",
              headers: {
                ETag: { schema: { type: "string" } },
                "X-Dataset-Release": { schema: { type: "string" } },
                "X-Data-Generated-At": {
                  schema: { type: "string", format: "date-time" },
                },
                "X-Data-Cache-State": {
                  schema: {
                    type: "string",
                    enum: ["origin", "fresh-cache", "stale-cache"],
                  },
                },
              },
              content: {
                "application/json": { schema: { type: "object" } },
              },
            },
            "304": { description: "Not Modified" },
            "404": {
              description: "Dataset not found",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
            "503": {
              description: "Dataset origin and acceptable stale cache unavailable",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ErrorResponse" },
                },
              },
            },
          },
        },
      },
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
      securitySchemes: {
        playbookServiceKey: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description:
            "Ed25519-signed Citely server-to-server JWT (maximum 5-minute TTL). The entitlement claim must carry the exact operation scope and playbook/package target. Legacy shared keys exist only during explicit cutover.",
        },
      },
      schemas: {
        PlaybookDetailResponse: {
          type: "object",
          required: ["schemaVersion", "playbook"],
          additionalProperties: false,
          properties: {
            schemaVersion: { type: "string", const: "1.0.0" },
            playbook: {
              type: "object",
              required: [
                "playbookId", "name", "version", "templateVersion",
                "description", "capabilities", "intakeSchema", "assuranceNote",
              ],
              additionalProperties: false,
              properties: {
                playbookId: {
                  type: "string",
                  pattern: "^[a-z0-9-]+$",
                },
                name: { type: "string", minLength: 1 },
                version: { type: "string", minLength: 1 },
                templateVersion: { type: "string", minLength: 1 },
                description: { type: "string", minLength: 1 },
                capabilities: {
                  type: "array",
                  minItems: 1,
                  items: {
                    type: "object",
                    required: ["capabilityId", "title"],
                    additionalProperties: false,
                    properties: {
                      capabilityId: {
                        type: "string",
                        pattern: "^[a-z0-9-]+$",
                      },
                      title: { type: "string", minLength: 1 },
                    },
                  },
                },
                intakeSchema: {
                  type: "object",
                  description:
                    "Executable JSON Schema 2020-12 for the selected playbook profile. The exact strict wire contract is contracts/v1/playbook-detail-response.schema.json.",
                },
                assuranceNote: {
                  type: "string",
                  const:
                    "Evaluations run on provisional machine-assured evidence and are research, not legal advice.",
                },
              },
            },
          },
        },
        CoverageResponse: {
          type: "object",
          required: ["schemaVersion", "dataAsOf", "markets"],
          additionalProperties: false,
          properties: {
            schemaVersion: { type: "string", const: "1.0.0" },
            dataAsOf: { type: ["string", "null"], format: "date-time" },
            markets: {
              type: "array",
              items: {
                type: "object",
                required: [
                  "jurisdictionCode", "displayName", "coverageState",
                  "completenessPercent", "freshnessState", "reviewedAt",
                  "publicNote", "corpusReleaseId", "asOf", "knowledgeCutoff",
                  "reviewedClaimCount", "sourceDocumentCount", "lastVerifiedAt",
                ],
                additionalProperties: false,
                properties: {
                  jurisdictionCode: { type: "string" },
                  displayName: { type: "string" },
                  coverageState: { enum: ["UNSUPPORTED", "IN_PROGRESS", "REVIEWED"] },
                  completenessPercent: { type: "integer", minimum: 0, maximum: 100 },
                  freshnessState: { enum: ["CURRENT", "STALE", "UNKNOWN"] },
                  reviewedAt: { type: ["string", "null"], format: "date-time" },
                  publicNote: { type: ["string", "null"] },
                  corpusReleaseId: { type: ["string", "null"] },
                  asOf: { type: ["string", "null"], format: "date-time" },
                  knowledgeCutoff: { type: ["string", "null"], format: "date-time" },
                  reviewedClaimCount: { type: "integer", minimum: 0 },
                  sourceDocumentCount: { type: "integer", minimum: 0 },
                  lastVerifiedAt: { type: ["string", "null"], format: "date-time" },
                },
              },
            },
          },
        },
        ProvisionalClaimResponse: {
          type: "object",
          required: [
            "schemaVersion", "claim", "releaseId", "assuranceLevel",
            "reviewStatus", "confidence", "asOf", "knowledgeCutoff",
            "sourceVersion", "citations", "limitations", "counselTriggers",
          ],
          additionalProperties: false,
          properties: {
            schemaVersion: { type: "string", const: "1.0.0" },
            claim: {
              type: "object",
              required: [
                "claimId", "jurisdictionCode", "topic", "proposition",
                "legalStatus", "effectiveFrom", "effectiveTo",
              ],
              additionalProperties: false,
              properties: {
                claimId: { type: "string" },
                jurisdictionCode: { type: "string" },
                topic: { type: "string" },
                proposition: { type: "string" },
                legalStatus: {
                  enum: [
                    "REQUIREMENT", "PERMISSION", "PROHIBITION",
                    "EXEMPTION", "GUIDANCE", "UNDETERMINED",
                  ],
                },
                effectiveFrom: { type: "string", format: "date-time" },
                effectiveTo: { type: ["string", "null"], format: "date-time" },
              },
            },
            releaseId: { type: "string" },
            assuranceLevel: { type: "string", const: "PROVISIONAL_PUBLISHED" },
            reviewStatus: { enum: ["PROVISIONAL", "HUMAN_REVIEWED"] },
            confidence: { type: ["number", "null"], minimum: 0, maximum: 1 },
            asOf: { type: "string", format: "date-time" },
            knowledgeCutoff: { type: "string", format: "date-time" },
            sourceVersion: {
              type: "object",
              required: ["id", "checksumSha256", "retrievedAt", "officialUrl"],
              additionalProperties: false,
              properties: {
                id: { type: "string" },
                checksumSha256: { type: "string" },
                retrievedAt: { type: "string", format: "date-time" },
                officialUrl: { type: "string" },
              },
            },
            citations: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                required: ["provisionId", "locator"],
                additionalProperties: false,
                properties: {
                  provisionId: { type: "string" },
                  locator: { type: "string" },
                },
              },
            },
            limitations: { type: "array", items: { type: "string" } },
            counselTriggers: { type: "array", items: { type: "string" } },
          },
        },
        ProvisionalCoverageResponse: {
          type: "object",
          required: ["schemaVersion", "markets"],
          additionalProperties: false,
          properties: {
            schemaVersion: { type: "string", const: "1.0.0" },
            markets: {
              type: "array",
              items: {
                type: "object",
                required: [
                  "jurisdictionCode", "reviewStatus", "provisionalClaimCount",
                  "latestReleaseId", "asOf", "knowledgeCutoff", "publishedAt",
                ],
                additionalProperties: false,
                properties: {
                  jurisdictionCode: { type: "string" },
                  reviewStatus: { type: "string", const: "PROVISIONAL" },
                  provisionalClaimCount: { type: "integer", minimum: 0 },
                  latestReleaseId: { type: "string" },
                  asOf: { type: "string", format: "date-time" },
                  knowledgeCutoff: { type: "string", format: "date-time" },
                  publishedAt: { type: "string", format: "date-time" },
                },
              },
            },
          },
        },
        PolicyFeedResponse: {
          type: "object",
          required: ["schemaVersion", "generatedAt", "items"],
          additionalProperties: false,
          properties: {
            schemaVersion: { type: "string", const: "1.0.0" },
            generatedAt: { type: "string", format: "date-time" },
            items: {
              type: "array",
              items: {
                type: "object",
                required: ["date", "jurisdiction", "summary", "sourceUrl"],
                additionalProperties: false,
                properties: {
                  date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
                  jurisdiction: { type: "string", minLength: 1 },
                  summary: { type: "string", minLength: 1 },
                  sourceUrl: { type: "string", pattern: "^https://" },
                  playbookId: {
                    enum: [
                      "business-model-regulatory-boundary",
                      "first-jurisdiction-selection",
                      "entity-licence-landing-path",
                      "stablecoin-pre-listing",
                      "issue-vs-white-label-vs-integrate",
                      "funding-due-diligence-room",
                      "multi-jurisdiction-expansion",
                      "listing-lifecycle-monitor",
                    ],
                  },
                },
              },
            },
          },
        },
        PublicSourceResponse: {
          type: "object",
          required: ["schemaVersion", "corpusReleaseId", "authority", "document", "evidence"],
          additionalProperties: false,
          properties: {
            schemaVersion: { type: "string", const: "1.0.0" },
            corpusReleaseId: { type: "string" },
            authority: { type: "object" },
            document: { type: "object" },
            evidence: { type: "array", items: { type: "object" } },
          },
        },
        ChangesResponse: {
          type: "object",
          required: ["schemaVersion", "changes", "nextCursor"],
          additionalProperties: false,
          properties: {
            schemaVersion: { type: "string", const: "1.0.0" },
            changes: { type: "array", items: { type: "object" } },
            nextCursor: { type: ["string", "null"] },
          },
        },
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
