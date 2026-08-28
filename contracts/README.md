# API contracts

Versioned JSON Schemas live under `contracts/v{major}` and are the wire-contract source for REST, MCP adapters, and Citely consumer fixtures.

Citely package fixtures live under `contracts/fixtures/citely/v1/`. Each
scenario has a strict create request and the corresponding immutable
`PlaybookPackage` + `EvidenceBundle` response. The checked-in pair covers both
launch playbooks, successful retrieval, and typed retrieval degradation. Run
`npm run contracts:citely:fixtures` to verify that the files still match the
deterministic runtime; use `npm run contracts:citely:fixtures:write` only when
an intentional contract or fixture-version change has been approved.

`v1/citely-service-token-payload.schema.json` defines the strict, presentation-
independent server-to-server JWT claims shared with Citely. JWT headers are
restricted to `alg=EdDSA`, `typ=JWT`, and a configured rotation `kid`; token TTL
is additionally enforced by runtime code at five minutes. Initial execution
targets one `playbookId`; a superseding execution targets both that
`playbookId` and the exact immutable base `packageId`.

`v1/playbook-package-rerun-request.schema.json` defines the explicit
superseding-evaluation request: Citely resubmits the original Business Profile
and the complete current pending `deltaIds`. The response deliberately reuses
`playbook-package-response.schema.json` so the main-site renderer remains
domain-agnostic.

`v1/playbook-detail-response.schema.json` defines the public, presentation-safe
playbook detail returned by `GET /v1/playbooks/{id}`. It includes a directly
renderable JSON Schema 2020-12 intake contract while excluding raw rules,
dossier checks, generated actions, prompts, private graphs, and evidence
topics.

`v1/playbook-watchlist-response.schema.json` defines the authenticated,
presentation-safe result of creating one immutable `ACTIVE` watchlist from an
exact completed package. The payload contains no customer, subscription,
entitlement, profile, or delivery configuration.

`v1/self-service-scope-readiness-input.schema.json` and
`v1/self-service-scope-readiness-report.schema.json` define the internal Phase
6 composition artifact for one exact jurisdiction, asset, and playbook scope.
The report fails closed on missing, failed, duplicate, stale, future, or
cross-scope gate evidence and always returns `activationState=NOT_ACTIVATED`.
It is not a public API or an authorization to create a self-service registry
entry.

`v1/contract-replay-eval-report.schema.json` defines the hash-only Phase 5/6
report produced by regenerating the committed Citely consumer fixtures. Every
scope must pass request and response schemas, byte-exact replay, package
integrity, and request/package/bundle referential integrity. The report omits
the Business Profiles and package bodies and feeds only the
`CONTRACT_AND_REPLAY` readiness adapter.

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
