import { NextResponse, type NextRequest } from "next/server";
import { withX402, type RouteConfig } from "@x402/next";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import {
  getReportBySlug,
  getReportMetaBySlug,
  ReportContentKeyMissingError,
} from "@/lib/reports";
import { X402_NETWORK, x402Server } from "@/lib/x402-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReportRouteContext = {
  params: Promise<{
    slug: string;
  }>;
};

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers":
        "Accept, Content-Type, Payment-Signature, X-Payment",
    },
  });
}

export async function GET(request: NextRequest, context: ReportRouteContext) {
  const { slug } = await context.params;
  const meta = await getReportMetaBySlug(slug);

  if (!meta) {
    await getReportMetaBySlug("missing-report-dummy");
    return NextResponse.json({ error: "report-not-found" }, { status: 404 });
  }

  const payTo = readPayToAddress();
  if (!payTo) {
    return NextResponse.json(
      { error: "x402-not-configured" },
      { status: 503 },
    );
  }

  const paidHandler = withX402(
    async () => {
      const report = await getReportBySlug(slug);

      if (!report) {
        return NextResponse.json(
          { error: "report-not-found" },
          { status: 404 },
        );
      }

      return new NextResponse(report.content, {
        status: 200,
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Cache-Control": "private, no-store",
          "X-Report-Slug": report.meta.slug,
          "X-Word-Count": String(report.meta.wordCount),
        },
      });
    },
    createRouteConfig(meta, payTo, request.url),
    x402Server,
  );

  try {
    return await paidHandler(request);
  } catch (error: unknown) {
    if (error instanceof ReportContentKeyMissingError) {
      return NextResponse.json(
        { error: "report-content-unavailable" },
        { status: 503 },
      );
    }

    throw error;
  }
}

function createRouteConfig(
  meta: NonNullable<Awaited<ReturnType<typeof getReportMetaBySlug>>>,
  payTo: string,
  requestUrl: string,
): RouteConfig {
  return {
    accepts: {
      scheme: "exact",
      price: `$${meta.priceUSD.toFixed(2)}`,
      network: X402_NETWORK,
      payTo,
      extra: {
        reportSlug: meta.slug,
      },
    },
    resource: requestUrl,
    description: meta.title,
    mimeType: "text/markdown",
    extensions: {
      ...declareDiscoveryExtension({
        input: {
          slug: meta.slug,
        },
        inputSchema: {
          type: "object",
          properties: {
            slug: {
              type: "string",
              description:
                "Report slug selected from GET /api/reports. Use this value in the /api/reports/{slug} path.",
              pattern: "^[a-z0-9][a-z0-9-]{5,80}$",
            },
          },
          required: ["slug"],
          additionalProperties: false,
        },
        output: {
          example: `# ${meta.title}\n\nFull report Markdown content is returned after payment.`,
          schema: {
            type: "string",
            description: "Full report content in Markdown.",
          },
        },
      }),
    },
    unpaidResponseBody: () => ({
      contentType: "application/json",
      body: {},
    }),
  };
}

function readPayToAddress(): string | null {
  const payTo = process.env.X402_PAY_TO?.trim();
  return payTo || null;
}
