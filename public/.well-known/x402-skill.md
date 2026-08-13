# Stablecoin Policy paid content — Agent purchase guide

This service sells full stablecoin policy reports to agents through x402. The
catalog and report metadata are free. Full report Markdown is returned only
after the server verifies and settles a valid payment.

Canonical base URL: `https://policy.citely.info`

## Discovery

- Service discovery: `GET https://policy.citely.info/.well-known/x402`
- Free report catalog: `GET https://policy.citely.info/api/reports`
- OpenAPI: `GET https://policy.citely.info/openapi.json`
- Stable latest report: `GET https://policy.citely.info/api/reports/latest`

The catalog returns each report's `slug`, metadata, indicative `priceUSD`, and
canonical `fullContentUrl`. Use `fullContentUrl` rather than constructing a
URL from a title. The 402 challenge is authoritative for payment terms.

## Purchase protocol

1. `GET https://policy.citely.info/api/reports` and select a report.
2. Send `GET` to its HTTPS `fullContentUrl` without a payment header.
3. Expect HTTP 402 and read the `PAYMENT-REQUIRED` response header. It is a
   base64-encoded x402 v2 JSON challenge.
4. Decode and validate the challenge. Confirm that `resource.url` is the exact
   URL requested and select one supported offer from `accepts`.
5. Use an x402-compatible wallet/payment client to create the exact payment
   required by that offer.
6. Retry the same method and URL with the resulting proof in the
   `PAYMENT-SIGNATURE` request header.
7. Expect HTTP 200 with `Content-Type: text/markdown`. Store the response as
   the purchased report. Do not treat a 402 or JSON error body as content.

Do not hardcode the network, asset, amount, or recipient. Read `network`,
`asset`, `amount`, `payTo`, and timeout from the current payment
challenge on every purchase. Never pay a recipient or resource URL that does
not exactly match the challenge and the report URL selected from this origin.

## Minimal HTTP sequence

```http
GET https://policy.citely.info/api/reports
Accept: application/json

GET https://policy.citely.info/api/reports/latest
Accept: text/markdown

HTTP 402 Payment Required
PAYMENT-REQUIRED: <base64 x402 v2 challenge>

GET https://policy.citely.info/api/reports/latest
Accept: text/markdown
PAYMENT-SIGNATURE: <x402 payment proof>

HTTP 200 OK
Content-Type: text/markdown; charset=utf-8
```

## Failure handling

- `404`: unknown report; refresh the free catalog.
- `429`: rate limited; honor `Retry-After` and do not create another payment.
- `402`: no valid payment was supplied; inspect the current challenge.
- `503`: catalog, report storage, decryption, or facilitator unavailable; do
  not assume payment succeeded and retry later.

An agent without an x402-compatible wallet cannot purchase through this
endpoint. Report content is never available from the free catalog or discovery
documents.
