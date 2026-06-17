/**
 * Offline check of the REAL Alipay AI-collection config in .env.local — no
 * network, no secrets printed. Complements alipay-402-dryrun.ts (which uses a
 * throwaway key) by exercising the actual merchant private key.
 *
 * It derives the public key FROM your private key and verifies the
 * seller_signature with it — exactly what Alipay does server-side. So:
 *   - a malformed key or wrong ALIPAY_KEY_TYPE makes key loading / verify FAIL
 *   - a clean PASS means your key + key-type + signing recipe are correct
 *
 * Prints only non-sensitive identifiers (private key and signature are never
 * logged; seller-id is masked). Exit 0 = pass, non-zero = fail.
 */
import "../env.js";
import { createPublicKey, verify as cryptoVerify } from "node:crypto";

function mask(v: string): string {
  if (v.length <= 8) return "****";
  return `${v.slice(0, 4)}…${v.slice(-4)}`;
}

async function main() {
  const { getAlipayConfig, buildPaymentNeeded, newOutTradeNo } = await import(
    "../../lib/alipay-server.js"
  );

  // Throws AlipayConfigMissingError if any required env var is absent.
  const config = getAlipayConfig();

  // Deriving the public key validates the private key body + ALIPAY_KEY_TYPE.
  // Wrong key type / malformed key throws here with a clear crypto error.
  let derivedPublicKey;
  try {
    derivedPublicKey = createPublicKey(config.privateKeyPem);
  } catch (err) {
    throw new Error(
      `private key failed to parse — check ALIPAY_KEY_TYPE (currently ${config.keyType}). ` +
        `Underlying: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const now = new Date();
  const resourceId = "/api/alipay/reports/latest";
  const goodsName = "Daily Stablecoin Policy Brief";
  const outTradeNo = newOutTradeNo(now.getTime(), "global-stablecoin-policy-report");

  const { decoded } = buildPaymentNeeded({
    config,
    resourceId,
    goodsName,
    outTradeNo,
    now,
  });
  const p = decoded.protocol;

  // Reconstruct the signed content and verify with the derived public key —
  // mirrors Alipay's server-side seller_signature check.
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
    derivedPublicKey,
    Buffer.from(p.seller_signature, "base64"),
  );

  if (!sigOk) {
    throw new Error(
      "seller_signature did NOT verify against the key — likely wrong ALIPAY_KEY_TYPE.",
    );
  }

  console.log("alipay-config-check: PASS");
  console.log(`  app_id        = ${config.appId}`);
  console.log(`  seller_id     = ${mask(config.sellerId)} (masked)`);
  console.log(`  service_id    = ${config.serviceId}`);
  console.log(`  seller_name   = ${config.sellerName}`);
  console.log(`  key_type      = ${config.keyType}`);
  console.log(`  alipay_pubkey = ${config.alipayPublicKey ? "set" : "MISSING"}`);
  console.log(`  gateway       = ${config.gateway}`);
  console.log(`  amount        = ${config.priceCNY} ${config.currency}`);
  console.log("  seller_signature verifies with the key ✓");
}

main().catch((err) => {
  console.error("alipay-config-check: FAIL");
  console.error(err instanceof Error ? err.message : err);
  process.exit(2);
});
