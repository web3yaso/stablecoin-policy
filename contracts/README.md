# API contracts

Versioned JSON Schemas live under `contracts/v{major}` and are the wire-contract source for REST, MCP adapters, and Citely consumer fixtures.

Phase 0 starts with the existing report compatibility surface. New domain schemas must use JSON Schema 2020-12, reject unknown properties by default, define explicit null behavior, and remain immutable after publication. Breaking changes require a new major directory.

Phase 2 adds reviewed legal-claim contracts. Discovery records from news or
research are deliberately not valid legal-claim evidence; public claim payloads
must identify an immutable official source version and exact provision locator.

Phase 2C adds the `policy-feed.schema.json` contract for `GET /v1/policy-feed`,
a thin projection of the active `news-summaries` release consumed by the Citely
main site; see [`policy-feed.md`](./policy-feed.md). Consumers validate the
whole response and reject unsupported or invalid payloads atomically.

Phase 2B adds provisional machine-assurance contracts:
`provisional-claim.schema.json` and `provisional-coverage-response.schema.json`
for `GET /v1/claims/{id}` and `GET /v1/provisional/coverage`. Every provisional
payload carries the mandatory assurance envelope (assuranceLevel, reviewStatus,
confidence, asOf, source version + citations, limitations, counselTriggers);
`reviewStatus` upgrades to `HUMAN_REVIEWED` only through a named-human review
record, and provisional coverage deliberately has no completeness percentage.
The reviewed-only coverage/source/change contracts remain unchanged.

Phase 3 adds `evidence-search-response.schema.json` for authenticated
`POST /v1/evidence/search`. The response pins the corpus and retrieval-index
release, returns ranked exact citations and assurance metadata, and uses typed
insufficient/conflicting/unauthorized/stale/unavailable outcomes. Version 1
does not include generated explanation text; `explanation` is intentionally
`null` until sentence-level faithfulness and prompt-injection evals pass.
