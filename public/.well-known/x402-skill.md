# Web3Law Paid Stablecoin Policy Reports

Purchase the latest stablecoin policy intelligence report through x402.

## Endpoint

`GET /api/reports/latest`

The first request returns `402 Payment Required` with a base64-encoded x402 v2 challenge in the `PAYMENT-REQUIRED` header. Pay the exact requested amount and retry the same URL with `PAYMENT-SIGNATURE`. Successful requests return the full report as `text/markdown`.

This ASP provides paid reports only. Report content is never returned by a free endpoint.
