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
