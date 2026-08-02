# Citely Policy Feed — Implementation Plan

Status: planned, not implemented  
Owner: Stablecoin Policy subsite  
Target consumer: Citely main site  
Last updated: 2026-08-01

## 1. Objective

Expose a small, stable, versioned policy-update feed that the Citely main site
can fetch and render without understanding the Stablecoin Policy subsite's
internal `news-summaries` shape.

The implementation is a thin projection of the existing active
`news-summaries` dataset. It must not create another ingestion pipeline,
duplicate production data, or move topic-to-playbook logic into Citely.

## 2. Accepted contract

The public endpoint is:

```text
GET /v1/policy-feed
```

The v1 response shape is:

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

Top-level requirements:

- `schemaVersion` is required and is exactly `1.0.0` for this contract.
- `generatedAt` is required and is an ISO 8601 timestamp.
- `items` is required and is an array.
- Unknown top-level fields are rejected by the v1 JSON Schema.

Item requirements:

- `date` is required and uses `YYYY-MM-DD`.
- `jurisdiction` is required and is a non-empty display name.
- `summary` is required, compact, and contains no line breaks.
- `sourceUrl` is required and uses HTTPS.
- `playbookId` is optional and is present only after an explicit subsite-owned
  mapping; it must never be inferred by the Citely main site.
- Unknown item fields are rejected by the v1 JSON Schema.

## 3. Existing data to reuse

Read the active release with:

```text
getDatasetService().getActiveDataset("news-summaries")
```

The existing dataset already provides:

- an immutable release and checksum;
- `generatedAt` and `publishedAt` release metadata;
- fresh-cache and stale-cache behavior;
- ETag-compatible integrity metadata;
- news grouped as `entities[jurisdiction].news[]`;
- item `date`, `summary`, `url`, source type, and official-source provenance.

The projection is:

| Policy feed field | Existing source |
|---|---|
| `generatedAt` | active release `generatedAt` |
| `date` | `news.date` |
| `jurisdiction` | parent `entities` key |
| `summary` | normalized `news.summary` |
| `sourceUrl` | `news.url` |
| `playbookId` | optional explicit mapping keyed by stable news item ID |

The request time must never be used as `generatedAt`. A stale dataset must
continue to expose its original generation time so a 43-day or similar outage
is immediately visible to Citely and its users.

## 4. Inclusion and ordering policy

Version 1 includes only items whose `sourceType` is `official-api` or
`official-feed`. Historical third-party news remains available through the
existing dataset for compatibility but does not enter the Citely policy feed.

All eligible items in the active release are returned. They are sorted by:

1. `date` descending;
2. `jurisdiction` ascending;
3. `sourceUrl` ascending.

No pagination or arbitrary truncation is introduced in v1. Monitor payload
growth; add a cursor or new major contract later if size becomes material.

For summaries containing more than one sentence, the projection selects the
first sentence deterministically and normalizes whitespace. It does not call an
LLM during a feed request.

## 5. Playbook mapping

Create `config/policy-feed-playbook-map.json` as an explicit, reviewable mapping
from stable news item ID to canonical playbook ID. It may be empty at launch.

Rules:

- an unmapped item omits `playbookId`;
- no keyword, topic, model, or main-site inference is allowed;
- an invalid mapped playbook ID fails feed construction rather than silently
  dropping the mapping;
- the mapping remains owned by the Stablecoin Policy subsite because Citely is
  a thin, domain-agnostic client.

## 6. Failure and cache behavior

The endpoint behaves atomically:

- unsupported source dataset schema: `503`;
- missing active dataset: `503`;
- malformed eligible item: `503`;
- invalid `generatedAt`, date, URL, summary, or playbook mapping: `503`;
- no partial item list is returned after a validation failure;
- error responses use `Cache-Control: no-store`.

Successful responses:

- return `Cache-Control: public, max-age=300, stale-while-revalidate=86400`;
- expose an ETag computed from the complete projected response;
- return `304` for a matching `If-None-Match`;
- expose `X-Policy-Feed-Schema-Version` and `X-Data-Generated-At`;
- preserve the dataset cache state in `X-Data-Cache-State`;
- set `Warning: 110` and `X-Data-Stale: true` when serving an allowed stale
  cache snapshot.

The Citely consumer must validate the entire response against the matching JSON
Schema. An unsupported or invalid schema rejects the whole response; Citely may
fall back to its last known-good snapshot but must show that snapshot's
`generatedAt`.

## 7. Planned files

Create:

- `contracts/v1/policy-feed.schema.json`
- `contracts/policy-feed.md`
- `config/policy-feed-playbook-map.json`
- `lib/policy-feed/contracts.ts`
- `lib/policy-feed/build.ts`
- `app/v1/policy-feed/route.ts`
- `tests/policy-feed.test.ts`

Update:

- `contracts/README.md`
- `app/openapi.json/route.ts`
- `docs/citely-product-family-boundary.md`
- `docs/superpowers/specs/2026-07-31-stablecoin-policy-domain-api-development-spec.md`
- `docs/PROJECT_CONTEXT.md` locally as the project index; it remains ignored
  and must not be committed.

No Supabase migration, new bucket, new dataset, or workflow is required.

## 8. Implementation sequence

- [x] Read `docs/PROJECT_CONTEXT.md`, the Citely product-family boundary, the
  formal Domain API spec, and the relevant Next.js 16 Route Handler guide under
  `node_modules/next/dist/docs/` before editing code.
- [x] Add the strict JSON Schema 2020-12 contract and human-readable contract
  documentation.
- [x] Add TypeScript response types and the `1.0.0` schema-version constant.
- [x] Implement a pure deterministic builder that validates the source release,
  filters official items, flattens jurisdictions, normalizes summaries, applies
  explicit playbook mappings, and sorts the result.
- [x] Implement the public Next.js route with atomic error handling, CORS,
  caching, stale headers, ETag, and conditional requests.
- [x] Add the endpoint and complete response schema to the generated OpenAPI
  document.
- [x] Add unit and contract tests before touching production deployment.
- [x] Update canonical product/API documentation and the local context index.
- [x] Run the full repository quality gate and inspect the resulting diff.
- [ ] Create a Git checkpoint and PR only after all checks pass.
- [ ] After deployment, smoke-test the production endpoint and verify that its
  `generatedAt` equals the active dataset release rather than deployment or
  request time.

## 9. Test cases

Unit and contract tests must cover:

- exact `schemaVersion: "1.0.0"`;
- `generatedAt` copied from release metadata;
- deterministic flattening from `entities[jurisdiction].news[]`;
- exclusion of non-official source items;
- `url` to `sourceUrl` mapping;
- optional mapped `playbookId` and omission when unmapped;
- stable descending-date ordering;
- deterministic first-sentence summary normalization, including abbreviations
  such as `U.S.`;
- rejection of unsupported source schema versions;
- rejection of missing or invalid release timestamps;
- rejection of malformed dates, empty jurisdiction/summary, non-HTTPS URLs,
  and invalid playbook IDs;
- whole-response JSON Schema validation;
- proof that an unsupported policy-feed schema version is rejected;
- stale snapshot headers;
- ETag and `304` behavior;
- no partial success when one eligible item is invalid;
- no private reviewer, customer, `DecisionRule`, or `PlaybookAction` data in the
  response.

## 10. Quality gate

Run from the repository root:

```text
npm test
npm run lint
npm run typecheck
npm run build
npm run data:check
```

Quint is not required for this change because the endpoint is a stateless,
read-only projection and does not add a workflow transition or publication
state machine. If implementation expands into mutable publication or cursor
state, model that state before coding.

## 11. Rollout and rollback

Rollout:

1. merge the independently tested endpoint;
2. deploy the subsite;
3. request `/v1/policy-feed` from the production Vercel domain;
4. validate the production response against the committed schema;
5. compare `generatedAt` with the active `news-summaries` release;
6. give Citely the endpoint URL and v1 schema;
7. keep the main site's last-known-good fallback enabled.

Rollback is code-only: remove or disable the new route and let Citely continue
using its last known-good snapshot. Existing `news-summaries`, report APIs,
legal-corpus APIs, storage objects, and database state remain unchanged.

## 12. Definition of done

- `GET /v1/policy-feed` returns the exact v1 structure.
- Every response includes the immutable source release's ISO `generatedAt`.
- Every item includes `date`, `jurisdiction`, `summary`, and `sourceUrl`.
- `playbookId` is emitted only from an explicit subsite mapping.
- The complete response validates against the committed schema.
- Invalid or unsupported input cannot produce a partial feed.
- OpenAPI and product documentation describe the endpoint.
- All repository quality commands pass.
- Production smoke and stale-time visibility checks pass.

## 13. Agent handoff

An agent resuming this work should:

1. confirm the worktree is clean and start a `codex/` feature branch;
2. read this plan and every document named in Section 8;
3. inspect the current `news-summaries` release and public dataset route rather
   than assuming their structure;
4. implement in the sequence above without changing ingestion or storage;
5. report any required contract change before deviating from v1;
6. leave `docs/PROJECT_CONTEXT.md` uncommitted because it is intentionally
   local-only;
7. publish a PR only after the complete quality gate succeeds.
