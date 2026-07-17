async function main() {
  const baseUrl = (process.env.REPORTS_API_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const endpoint = `${baseUrl}/api/reports/latest`;

  const response = await fetch(endpoint, {
    headers: { Accept: "text/markdown" },
    redirect: "manual",
  });

  if (response.status !== 402) {
    throw new Error(`ASP check failed: expected 402 from ${endpoint}, received ${response.status}`);
  }

  const paymentRequired = response.headers.get("payment-required");
  if (!paymentRequired) {
    throw new Error("ASP check failed: 402 response is missing PAYMENT-REQUIRED");
  }

  let challenge: unknown;
  try {
    challenge = JSON.parse(Buffer.from(paymentRequired, "base64").toString("utf8"));
  } catch {
    throw new Error("ASP check failed: PAYMENT-REQUIRED is not base64-encoded JSON");
  }

  if (
    typeof challenge !== "object" ||
    challenge === null ||
    !("x402Version" in challenge) ||
    challenge.x402Version !== 2
  ) {
    throw new Error("ASP check failed: expected an x402 v2 payment challenge");
  }

  console.log(`PASS ${endpoint} returns a valid x402 v2 payment challenge.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
