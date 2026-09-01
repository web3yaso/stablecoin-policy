# Phase 6 Contract and Replay Readiness Gate — Implementation Plan

Status: implemented and verified on `codex/contract-replay-readiness-gate`;
production activation is explicitly out of scope.

## Goal

Turn the existing Citely consumer-fixture guarantees into a strict,
versioned, per-scope eval artifact and use that artifact as the only typed
source for the `CONTRACT_AND_REPLAY` readiness gate.

## Accepted boundary

- Reuse the two committed, sanitized Citely request/response pairs as the
  regression dataset.
- Regenerate both pairs from the deterministic runtime on every eval run.
- Require byte-for-byte request and response replay equality.
- Validate the committed request and response against their current v1 JSON
  Schemas.
- Verify package integrity and exact request/package/bundle relationships.
- Report separately for the EEA generic business-model scope and EEA USDC
  Pre-listing scope; one scope cannot borrow another scope's result.
- Emit hashes and aggregate outcomes only. Do not copy Business Profiles,
  package bodies, claims, citations, URLs, rules, prompts, customer data, or
  credentials into the eval report.
- A passing local fixture report does not replace signed production smoke and
  never activates self-service.

## Metrics and gate

Each scope must contain at least one case and achieve exactly `1.0` for:

- request contract pass rate;
- response contract pass rate;
- exact replay match rate;
- package integrity pass rate;
- referential integrity pass rate.

Malformed JSON, schema rejection, replay drift, changed package bytes, package
integrity failure, asset/playbook/jurisdiction mismatch, or package/bundle ID
mismatch fails the scope.

## Artifacts

- `lib/playbooks/contract-replay-eval.ts`: deterministic evaluator and strict
  hash-only report.
- `scripts/evals/run-phase5-contract-replay.ts`: fixture regeneration, schema
  validation, and CI runner.
- `contracts/v1/contract-replay-eval-report.schema.json`: strict report
  contract.
- `lib/playbooks/scope-readiness.ts`: exact-scope adapter to
  `CONTRACT_AND_REPLAY` evidence.
- `tests/contract-replay-eval.test.ts`: positive, failure-injection, privacy,
  determinism, and schema coverage.
- `.github/workflows/quality.yml`: mandatory PR/main eval execution.

The existing fixture builder is exported for the evaluator but retains the
same CLI behavior and checked-in fixture bytes.

Local verification passes 288/288 repository tests, both contract/replay
scope gates, the unchanged Citely fixture check, the Phase 6 monitoring eval,
lint, typecheck, production build, and repository data policy.

## Verification

```bash
npm run eval:phase5:contract-replay
npm run contracts:citely:fixtures
node --import tsx --test tests/contract-replay-eval.test.ts tests/scope-readiness.test.ts
npm test
npm run eval:phase6
npm run lint
npm run typecheck
npm run build
npm run data:check
```

## Remaining readiness work

Typed trusted artifacts are now available for `MONITORING` and
`CONTRACT_AND_REPLAY`. The following gates remain deliberately `MISSING` until
their own scope-bound artifacts and adapters exist:

- `SOURCE_AND_GROUNDING`;
- `RETRIEVAL_AND_RAG`;
- `DETERMINISTIC_RULE_AND_ACTION`;
- `PRIVACY`;
- `ASSURANCE_LABEL`;
- `RELEASE`.

Signed production package/watchlist/delta/rerun smoke remains an operational
release checkpoint rather than a synthetic fixture result.
