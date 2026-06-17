import { NextResponse, type NextRequest } from "next/server";
import {
  getReportBySlug,
  getReportMetaBySlug,
  LATEST_REPORT_SLUG,
  ReportContentKeyMissingError,
} from "@/lib/reports";
import {
  alipayConfigured,
  buildPaymentNeeded,
  buildPaymentValidation,
  getAlipayConfig,
  getAlipaySdk,
  newOutTradeNo,
  parsePaymentProof,
  reserveFulfillment,
  sendFulfillmentConfirm,
  verifyPaymentProof,
  type AlipayConfig,
} from "@/lib/alipay-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Stable resource id the seller_signature commits to. Must match the
 *  registered 服务地址 path so verify-time resource checks line up. */
const RESOURCE_ID = "/api/alipay/reports/latest";

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Accept, Content-Type, Payment-Proof",
    "Access-Control-Expose-Headers": "Payment-Needed, Payment-Validation",
  };
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET(request: NextRequest) {
  if (!alipayConfigured()) {
    return NextResponse.json(
      { error: "alipay-not-configured" },
      { status: 503, headers: corsHeaders() },
    );
  }

  const config = getAlipayConfig();
  const proof = request.headers.get("payment-proof");

  try {
    if (!proof || proof.trim() === "") {
      return await paymentRequired(config);
    }
    return await verifyAndDeliver(config, proof);
  } catch (error: unknown) {
    if (error instanceof ReportContentKeyMissingError) {
      return NextResponse.json(
        { error: "report-content-unavailable" },
        { status: 503, headers: corsHeaders() },
      );
    }
    throw error;
  }
}

/** Scenario 1: no proof → 402 + Payment-Needed. */
async function paymentRequired(config: AlipayConfig) {
  const meta = await getReportMetaBySlug(LATEST_REPORT_SLUG);
  const goodsName = meta?.title ?? "Stablecoin Policy Brief";
  const now = new Date();
  const outTradeNo = newOutTradeNo(now.getTime(), LATEST_REPORT_SLUG);

  const { header } = buildPaymentNeeded({
    config,
    resourceId: RESOURCE_ID,
    goodsName,
    outTradeNo,
    now,
  });

  return NextResponse.json(
    {
      code: "Payment-Needed",
      message: "需要支付",
      out_trade_no: outTradeNo,
      amount: config.priceCNY,
      currency: config.currency,
      goods_name: goodsName,
    },
    {
      status: 402,
      headers: { ...corsHeaders(), "Payment-Needed": header },
    },
  );
}

/** Scenario 2: proof present → verify, fulfil, confirm, deliver. */
async function verifyAndDeliver(config: AlipayConfig, proofHeader: string) {
  let parsed;
  try {
    parsed = parsePaymentProof(proofHeader);
  } catch (error: unknown) {
    return NextResponse.json(
      {
        code: "INVALID_PAYMENT_PROOF_FORMAT",
        message: error instanceof Error ? error.message : "invalid Payment-Proof",
      },
      { status: 400, headers: corsHeaders() },
    );
  }

  const sdk = getAlipaySdk(config);
  const verify = await verifyPaymentProof(sdk, parsed);

  if (verify.code !== "10000") {
    return NextResponse.json(
      { code: verify.subCode ?? verify.code, message: verify.subMsg ?? "verify failed" },
      { status: 400, headers: corsHeaders() },
    );
  }
  if (!verify.active) {
    return NextResponse.json(
      { code: "INVALID_PAYMENT_PROOF", message: "支付凭证无效或已过期" },
      { status: 400, headers: corsHeaders() },
    );
  }
  // Resource-tamper guard: the paid resource must be the one we quoted.
  if (verify.resourceId && verify.resourceId !== RESOURCE_ID) {
    return NextResponse.json(
      { code: "RESOURCE_ID_MISMATCH", message: "资源 ID 不匹配" },
      { status: 403, headers: corsHeaders() },
    );
  }

  const tradeNo = verify.tradeNo ?? parsed.tradeNo;
  const outTradeNo = verify.outTradeNo ?? "";

  // Replay guard: a given trade_no fulfils at most once.
  const fresh = await reserveFulfillment(tradeNo);
  if (!fresh) {
    return NextResponse.json(
      {
        code: "ALREADY_FULFILLED",
        message: "订单已履约，不重复提供",
        already_fulfilled: true,
        trade_no: tradeNo,
        out_trade_no: outTradeNo,
      },
      { status: 200, headers: corsHeaders() },
    );
  }

  const report = await getReportBySlug(LATEST_REPORT_SLUG);
  if (!report) {
    return NextResponse.json(
      { code: "RESOURCE_NOT_FOUND", message: "report not found" },
      { status: 404, headers: corsHeaders() },
    );
  }

  // Confirm fulfilment to Alipay so settlement completes.
  await sendFulfillmentConfirm(sdk, tradeNo);

  const validation = buildPaymentValidation({
    tradeNo,
    outTradeNo,
    resourceId: RESOURCE_ID,
  });

  return NextResponse.json(
    {
      resource_id: RESOURCE_ID,
      slug: report.meta.slug,
      title: report.meta.title,
      word_count: report.meta.wordCount,
      content: report.content,
      trade_no: tradeNo,
      out_trade_no: outTradeNo,
      already_fulfilled: false,
    },
    {
      status: 200,
      headers: {
        ...corsHeaders(),
        "Payment-Validation": validation,
        "Cache-Control": "private, no-store",
      },
    },
  );
}
