/**
 * Offline verification of the Alipay AI-collection 402 construction — no
 * Alipay API calls, no merchant credentials. AI 收 has no sandbox, so this is
 * the canonical pre-deploy check.
 *
 * Generates a throwaway RSA keypair, drives buildPaymentNeeded(), then asserts:
 *   - the Payment-Needed header round-trips through Base64URL
 *   - protocol fields match config (amount/currency/resource_id/sign_type)
 *   - pay_before is ISO 8601 with timezone, ~30 min ahead
 *   - seller_signature verifies against the public key with the documented
 *     sorted `k=v&...` recipe
 *   - parsePaymentProof() extracts a crafted proof
 *
 * Exit 0 = pass, non-zero = fail.
 */
import "../env.js";
import { generateKeyPairSync, verify as cryptoVerify } from "node:crypto";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

async function main() {
  // Throwaway PKCS#1 keypair — never touches the real merchant key.
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
  });
  const privateKeyBody = privateKey
    .replace(/-----(BEGIN|END) RSA PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");

  process.env.ALIPAY_APP_ID = "2026000000000000";
  process.env.ALIPAY_PRIVATE_KEY = privateKeyBody;
  process.env.ALIPAY_KEY_TYPE = "PKCS1";
  process.env.ALIPAY_SELLER_ID = "2088000000000000";
  process.env.ALIPAY_SERVICE_ID = "service_stablecoin_report";
  process.env.ALIPAY_REPORT_PRICE_CNY = "0.10";

  const mod = await import("../../lib/alipay-server.js");
  const {
    getAlipayConfig,
    buildPaymentNeeded,
    base64UrlDecode,
    base64UrlEncode,
    parsePaymentProof,
    newOutTradeNo,
  } = mod;

  const config = getAlipayConfig();
  assert(config.priceCNY === "0.10", "price is 0.10 CNY (matches 服务单价)");
  assert(config.currency === "CNY", "currency CNY");

  const now = new Date("2026-06-16T12:00:00+08:00");
  const resourceId = "/api/alipay/reports/latest";
  const goodsName = "Daily Stablecoin Policy Brief";
  const outTradeNo = newOutTradeNo(now.getTime(), "global-stablecoin-policy-report");

  const { decoded, header, payBefore } = buildPaymentNeeded({
    config,
    resourceId,
    goodsName,
    outTradeNo,
    now,
  });

  // 1) header round-trips
  const reDecoded = JSON.parse(base64UrlDecode(header));
  assert(
    JSON.stringify(reDecoded) === JSON.stringify(decoded),
    "Payment-Needed header round-trips through Base64URL",
  );
  assert(!/[+/=]/.test(header), "header is Base64URL (no +, /, =)");

  // 2) protocol fields
  const p = decoded.protocol;
  assert(p.amount === "0.10", "protocol.amount === 0.10");
  assert(p.currency === "CNY", "protocol.currency === CNY");
  assert(p.resource_id === resourceId, "protocol.resource_id matches");
  assert(p.out_trade_no === outTradeNo, "protocol.out_trade_no matches");
  assert(p.seller_sign_type === "RSA2", "seller_sign_type === RSA2");
  assert(p.seller_unique_id === config.sellerId, "seller_unique_id === sellerId");
  assert(decoded.method.service_id === config.serviceId, "method.service_id matches");

  // 3) pay_before: ISO 8601 + tz, ~30 min ahead
  assert(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(payBefore),
    "pay_before is ISO 8601 with timezone",
  );
  const deltaMin = (new Date(payBefore).getTime() - now.getTime()) / 60000;
  assert(Math.abs(deltaMin - 30) < 0.1, `pay_before ~30 min ahead (got ${deltaMin})`);

  // 4) seller_signature verifies against the public key
  const signContent = Object.entries({
    amount: p.amount,
    currency: p.currency,
    goods_name: goodsName,
    out_trade_no: p.out_trade_no,
    pay_before: p.pay_before,
    resource_id: p.resource_id,
    seller_id: config.sellerId,
    service_id: config.serviceId,
  })
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const sigOk = cryptoVerify(
    "RSA-SHA256",
    Buffer.from(signContent, "utf8"),
    publicKey,
    Buffer.from(p.seller_signature, "base64"),
  );
  assert(sigOk, "seller_signature verifies with the documented sorted k=v recipe");

  // 5) parsePaymentProof extracts a crafted proof
  const craftedProof = base64UrlEncode(
    JSON.stringify({
      protocol: { payment_proof: "PROOF_ABC", trade_no: "20260616TRADE001" },
      method: { client_session: "sess_xyz" },
    }),
  );
  const proof = parsePaymentProof(craftedProof);
  assert(proof.paymentProof === "PROOF_ABC", "parsed payment_proof");
  assert(proof.tradeNo === "20260616TRADE001", "parsed trade_no");
  assert(proof.clientSession === "sess_xyz", "parsed client_session");

  console.log("alipay-402-dryrun: PASS");
  console.log(`  amount=${p.amount} ${p.currency}  resource_id=${p.resource_id}`);
  console.log(`  pay_before=${p.pay_before}`);
  console.log(`  header.len=${header.length}  signature.len=${p.seller_signature.length}`);
}

main().catch((err) => {
  console.error("alipay-402-dryrun: FAIL");
  console.error(err);
  process.exit(2);
});
