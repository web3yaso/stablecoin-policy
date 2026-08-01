import { NextResponse, type NextRequest } from "next/server";
import {
  x402HTTPResourceServer,
  type HTTPAdapter,
  type HTTPResponseInstructions,
  type RouteConfig,
} from "@okxweb3/x402-core/http";
import {
  getReportBySlug,
  getReportMetaBySlug,
  ReportArtifactMissingError,
  ReportContentKeyMissingError,
} from "@/lib/reports";
import {
  DataIntegrityError,
  ExternalStorageError,
} from "@/lib/data/external-storage-errors";
import {
  ensureX402FacilitatorReady,
  X402_NETWORK,
  x402Server,
} from "@/lib/x402-server";

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
  let meta;
  try {
    meta = await getReportMetaBySlug(slug);
    if (!meta) await getReportMetaBySlug("missing-report-dummy");
  } catch (error: unknown) {
    if (
      error instanceof DataIntegrityError ||
      error instanceof ExternalStorageError
    ) {
      return NextResponse.json(
        { error: "report-catalog-unavailable" },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    throw error;
  }

  if (!meta) {
    return NextResponse.json({ error: "report-not-found" }, { status: 404 });
  }

  const payTo = readPayToAddress();
  if (!payTo) {
    return NextResponse.json(
      { error: "x402-not-configured" },
      { status: 503 },
    );
  }

  const httpServer = new x402HTTPResourceServer(x402Server, {
    "GET /api/reports/:slug": createRouteConfig(meta, payTo, request.url),
  });

  try {
    await ensureX402FacilitatorReady();
    const payment = await httpServer.processHTTPRequest({
      adapter: createNextAdapter(request),
      path: new URL(request.url).pathname,
      method: request.method,
      paymentHeader:
        request.headers.get("payment-signature") ??
        request.headers.get("x-payment") ??
        undefined,
    });

    if (payment.type === "payment-error") {
      return responseFromInstructions(payment.response);
    }

    if (payment.type !== "payment-verified") {
      return NextResponse.json({ error: "payment-required" }, { status: 402 });
    }

    const report = await getReportBySlug(slug);
    if (!report) {
      return NextResponse.json({ error: "report-not-found" }, { status: 404 });
    }

    const responseHeaders = {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Report-Slug": report.meta.slug,
      "X-Word-Count": String(report.meta.wordCount),
    };
    const settlement = await httpServer.processSettlement(
      payment.paymentPayload,
      payment.paymentRequirements,
      payment.declaredExtensions,
      {
        request: {
          adapter: createNextAdapter(request),
          path: new URL(request.url).pathname,
          method: request.method,
          paymentHeader: request.headers.get("payment-signature") ?? undefined,
        },
        responseBody: Buffer.from(report.content, "utf8"),
        responseHeaders,
      },
    );

    if (!settlement.success) {
      return responseFromInstructions(settlement.response);
    }

    return new NextResponse(report.content, {
      status: 200,
      headers: { ...responseHeaders, ...settlement.headers },
    });
  } catch (error: unknown) {
    if (
      error instanceof ReportContentKeyMissingError ||
      error instanceof ReportArtifactMissingError ||
      error instanceof DataIntegrityError ||
      error instanceof ExternalStorageError
    ) {
      return NextResponse.json(
        { error: "report-content-unavailable" },
        { status: 503 },
      );
    }

    const message = error instanceof Error ? error.message : "unknown error";
    if (message.includes("facilitator") || message.includes("OKX")) {
      console.warn(`x402 unavailable: ${message}`);
      return NextResponse.json(
        { error: "x402-facilitator-unavailable" },
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
    unpaidResponseBody: () => ({
      contentType: "application/json",
      body: {},
    }),
  };
}

function createNextAdapter(request: NextRequest): HTTPAdapter {
  const url = new URL(request.url);
  return {
    getHeader: (name) => request.headers.get(name) ?? undefined,
    getMethod: () => request.method,
    getPath: () => url.pathname,
    getUrl: () => request.url,
    getAcceptHeader: () => request.headers.get("accept") ?? "",
    getUserAgent: () => request.headers.get("user-agent") ?? "",
  };
}

function responseFromInstructions(instructions: HTTPResponseInstructions) {
  const body =
    instructions.body === undefined
      ? null
      : typeof instructions.body === "string"
        ? instructions.body
        : JSON.stringify(instructions.body);
  return new NextResponse(body, {
    status: instructions.status,
    headers: instructions.headers,
  });
}

function readPayToAddress(): string | null {
  const payTo = process.env.X402_PAY_TO?.trim();
  return payTo || null;
}
