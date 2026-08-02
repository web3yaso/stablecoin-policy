# Policy Feed v1 contract

Endpoint: `GET /v1/policy-feed`
Schema: [`v1/policy-feed.schema.json`](./v1/policy-feed.schema.json)
Model: [`specs/policyFeed.qnt`](../specs/policyFeed.qnt) (atomic build semantics)
Plan of record: `docs/superpowers/plans/2026-08-01-citely-policy-feed.md`

A thin, versioned projection of the active `news-summaries` dataset release for
the Citely main site. It introduces no new ingestion pipeline and no database
state.

## Response

```json
{
  "schemaVersion": "1.0.0",
  "generatedAt": "2026-08-01T12:00:00.000Z",
  "items": [
    {
      "date": "2026-07-31",
      "jurisdiction": "United States",
      "summary": "The OCC proposed regulations implementing the GENIUS Act.",
      "sourceUrl": "https://www.federalregister.gov/example",
      "playbookId": "stablecoin-pre-listing"
    }
  ]
}
```

- `schemaVersion` is exactly `1.0.0` for this contract.
- `generatedAt` is the immutable source release's generation time, never the
  request time; a stale snapshot keeps its original timestamp so outages stay
  visible.
- Items come only from `official-api` / `official-feed` sources, sorted by
  `date` desc, `jurisdiction` asc, `sourceUrl` asc. Summaries are a
  deterministic first sentence with normalized whitespace; no LLM runs during a
  request.
- `playbookId` appears only via the explicit subsite-owned mapping in
  `config/policy-feed-playbook-map.json`; consumers must never infer it.
- Unknown fields anywhere are schema violations.

## Failure behavior (atomic)

Missing active dataset, unsupported source schema, invalid release timestamp,
one malformed eligible item, or an invalid playbook mapping each fail the whole
response with `503` and `Cache-Control: no-store`. No partial item list is ever
returned.

## Headers

Success: `Cache-Control: public, max-age=300, stale-while-revalidate=86400`,
`ETag` (sha256 of the complete projected response, `304` on matching
`If-None-Match`), `X-Policy-Feed-Schema-Version`, `X-Data-Generated-At`,
`X-Data-Cache-State`; stale snapshots add `Warning: 110` and
`X-Data-Stale: true`.

## Consumer obligations

Validate the entire response against the v1 schema; reject an unsupported or
invalid response as a whole. A consumer may fall back to its last known-good
snapshot but must display that snapshot's `generatedAt`.
