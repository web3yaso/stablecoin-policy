# Web3Law Stablecoin Policy Reports x402 Skill

## Purpose

Use this skill to discover and purchase machine-readable stablecoin policy reports from Web3Law.

The report list is free. Full report content is returned as Markdown after a successful x402 payment on Base Sepolia testnet.

Pricing is $0.01 USDC per report for testnet validation only. Production pricing is TBD.

## Endpoints

### List Reports

```http
GET https://stablecoin-policy.vercel.app/api/reports
```

Returns public metadata, summaries, prices, and paid content URLs.

Example:

```bash
curl https://stablecoin-policy.vercel.app/api/reports
```

Response shape:

```json
{
  "reports": [
    {
      "slug": "web3-1-bm6nnqo",
      "title": "Report title",
      "summary": "Free summary",
      "category": "enforcement",
      "jurisdiction": ["US"],
      "publishedAt": "2026-04-23T00:00:00.000Z",
      "wordCount": 1456,
      "priceUSD": 0.01,
      "fullContentUrl": "https://stablecoin-policy.vercel.app/api/reports/web3-1-bm6nnqo"
    }
  ],
  "total": 3,
  "lastUpdated": "2026-04-27T00:00:00.000Z"
}
```

### Get Full Report

```http
GET https://stablecoin-policy.vercel.app/api/reports/[slug]
```

Without payment, this endpoint returns `402 Payment Required` and x402 payment requirements.

Example:

```bash
curl -i https://stablecoin-policy.vercel.app/api/reports/web3-1-bm6nnqo
```

After payment, send the x402 payment header returned by your x402 client:

```bash
curl \
  -H "X-Payment: <base64-encoded-x402-payment-payload>" \
  https://stablecoin-policy.vercel.app/api/reports/web3-1-bm6nnqo
```

Successful responses return:

- HTTP status: `200`
- Content-Type: `text/markdown; charset=utf-8`
- `X-Report-Slug`: report slug
- `X-Word-Count`: report word count
- Body: full report Markdown

## Payment Requirements

- Protocol: x402
- Scheme: exact
- Network: Base Sepolia (`eip155:84532`)
- Currency: USDC
- Price: server-defined per report, currently `$0.01`
- Payment header: `X-Payment` or `Payment-Signature`

Clients should first call the paid URL without a payment header, read the x402 payment requirements from the `Payment-Required` response header/body, sign a compatible payment payload, and retry the same URL with the payment header.

## Error Semantics

- `402 Payment Required`: payment is missing, invalid, expired, or not accepted.
- `403 Forbidden`: payment replay or settlement rejection may be surfaced as forbidden by clients or facilitator behavior.
- `404 Not Found`: the requested report slug does not exist. No payment is required for missing reports.
- `429 Too Many Requests`: the free list endpoint rate limit was exceeded.
- `503 Service Unavailable`: x402, KV logging, or encrypted report content is not configured.

## Security Notes

- Report full text is not stored in public plaintext files.
- Report prices are selected server-side from the report index, not from client input.
- Missing slugs return `404` before payment.
- Reusing the same payment payload is rejected by facilitator nonce checks and server-side replay logging.
