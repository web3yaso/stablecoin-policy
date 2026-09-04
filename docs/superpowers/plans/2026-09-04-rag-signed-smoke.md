# Signed Evidence RAG smoke runner

Status: implemented and locally verified, stacked on PR #74. No live execution.

## Spec impact and gap

The approved `evidenceRag.qnt` models authorized, version-pinned retrieval,
typed stale/outage responses, and deterministic-decision isolation.
`evidenceRagSuspension.qnt` adds denial of fresh suspended-index acquisition.
The HTTP route implements these boundaries, but the existing Citely smoke
runner tests packages only. Add an operator-run evidence HTTP verifier; do not
change either state machine, production routes, schemas, or activation gates.
JWT cryptography, HTTP, redirects, and transport are outside Quint and need
concrete application tests. A smoke pass is not independent corpus evaluation.

## Implementation steps

1. `lib/retrieval/citely-smoke.ts`: validate an operator-prepared case against
   the existing request/response contracts; sign five-minute evidence tokens
   in the Citely secret boundary. Check unsigned, wrong-scope, expired, and
   wrong-audience rejection before authenticated default/pinned searches.
   ACTIVE mode verifies exact index metadata, expected citation membership,
   required provisions, filter isolation, repeatable results, and stale denial.
   UNAVAILABLE mode requires structured 503, no index/hits/narrative for both
   default and explicit target. Never change lifecycle state.
   Gate: `successfulRetrievalPinsAuthorizedEvidence`,
   `humanReviewedQueryCannotUseProvisionalIndex`, `unsafeOutcomesProduceNoNarrative`,
   `suspendedNeverReadable`; run both existing Quint suites.
2. `scripts/smoke/citely-evidence.ts` and tests: default dry-run with no key or
   network access, explicit execution, private external case file, sanitized
   summary/errors, redirect refusal, bounded timeout, no secret copying or
   production fault injection. Verify against real auth/retrieval code using
   ephemeral test keys and deterministic embeddings; inject bad responses.
   Gate: rerun both unchanged Quint suites and application/contract tests.
3. Update operations/master plan/context with commands, limitations and actual
   verification. No automatic PR merge, migration, activation, or model call.

If an invariant fails, stop and fix the implementation, never weaken the model.
Live execution requires separate authorization: successful searches may call
OpenAI and all authorized searches can append private retrieval audit rows.

## Status after implementation

Steps 1–2 implemented: stateless runner, private case-file reader and CLI,
real authentication/retrieval-backed tests plus mutated-response tests.
The first typecheck caught an Ajv asynchronous-validator union; using the
synchronous schema compiler restored the type guard without changing runtime
contracts. Typecheck/lint and both unchanged Quint suites pass: 19 + 11
scenarios, all 11 + 5 invariants and 13 + 11 witnesses in 5,000-sample runs.
The suites do not prove JWT/HTTP behavior; the application tests check it.

PR #74's GitHub verify/database jobs and Vercel Preview passed. This branch
does not modify #74 or merge it. Production stays on migration `0035` with no
active RAG index.

Final verification: 40 new smoke tests / 368 total application tests passed,
along with typecheck, lint, build, Phase 3 sanitized eval, Phase 5 retrieval/RAG
eval, and both Citely consumer fixture replays. Both unchanged Quint suites
passed after the implementation. No new SQL or domain state transition is
introduced, so the database gate belongs to prerequisite PR #74 (passed in
GitHub). Operations and context now document the execution/cost boundary.

Remaining external gates: independent real EEA evaluation artifacts, approved
production application of `0036`, Citely signing/public-key readiness, and
explicitly authorized live smoke/activation. This tool does not satisfy these
gates by its existence or by passing local fixtures.
