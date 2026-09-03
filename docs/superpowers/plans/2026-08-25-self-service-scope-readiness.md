# Phase 6 Self-Service Scope Readiness — Implementation Plan

Status: implemented and verified on `codex/self-service-scope-readiness`;
production activation is explicitly out of scope.

## Goal

Compose the independent Section 13 quality gates into one deterministic,
versioned readiness report for an exact jurisdiction, asset, and playbook
scope. Missing, failed, duplicate, future, expired, or cross-scope evidence
must block readiness with stable machine-readable codes.

This slice measures readiness only. It does not create, activate, suspend, or
remove a production self-service scope.

## Current policy

Policy version `1.0.0` requires all eight grouped gates:

1. `SOURCE_AND_GROUNDING`;
2. `RETRIEVAL_AND_RAG`;
3. `DETERMINISTIC_RULE_AND_ACTION`;
4. `PRIVACY`;
5. `ASSURANCE_LABEL`;
6. `CONTRACT_AND_REPLAY`;
7. `RELEASE`;
8. `MONITORING`.

The grouping covers every Section 13 threshold without treating a passing
monitoring report as sufficient by itself. A policy change requires a new
`policyVersion`; it must never silently alter an old report.

## Evidence boundary

Each normalized gate record binds:

- the exact canonical scope ID;
- upstream report ID and schema version;
- immutable artifact SHA-256;
- `PASSED` or `FAILED` outcome;
- machine-assured or human-reviewed label;
- evaluation timestamp and finite validity boundary.

The readiness artifact contains no Business Profile, customer, entitlement,
payment, raw rule, prompt, source body, reviewer identity, webhook destination,
or package body. Strict parsing rejects unknown fields.

Typed adapters derive `MONITORING` evidence from the actual
`MonitoringEvalReport` and `CONTRACT_AND_REPLAY` evidence from the committed
Citely fixture replay report. `DETERMINISTIC_RULE_AND_ACTION` evidence comes
from the strict deterministic runtime eval report, and `RETRIEVAL_AND_RAG`
evidence comes from the scope-bound hybrid-search and safe-degradation eval.
Every adapter uses the exact per-scope metric. The remaining four gates need
equivalent typed adapters or trusted artifact verification before any future
registry may consume them. A caller-provided normalized record is not itself
a production authorization.

## Decision semantics

- Every required gate appears exactly once and in policy order in the output.
- An empty input fails with eight explicit `MISSING` blockers; there is no
  vacuous pass.
- Duplicates fail rather than selecting a newer or more favorable artifact.
- Scope mismatch fails rather than borrowing quality evidence from another
  market, asset, or playbook.
- Evidence evaluated after `asOf` is `NOT_YET_VALID`; evidence whose
  `validUntil` precedes `asOf` is `EXPIRED`.
- `READY` requires all eight exact, current, passing gates.
- Readiness is `HUMAN_REVIEWED` only when every gate has that assurance;
  otherwise a ready result is `MACHINE_ASSURED`.
- Every output has `activationState: NOT_ACTIVATED`.
- Report identity is a SHA-256 over canonical normalized input and policy
  version and is independent of gate input ordering.

## Artifacts

- `lib/playbooks/scope-readiness.ts`: strict parser, policy, deterministic
  composer, scope identity, and monitoring adapter.
- `contracts/v1/self-service-scope-readiness-input.schema.json`: strict input
  metadata contract.
- `contracts/v1/self-service-scope-readiness-report.schema.json`: strict
  readiness artifact contract.
- `tests/scope-readiness.test.ts`: positive, negative, freshness, scope,
  determinism, assurance, privacy, adapter, and schema coverage.

No route, migration, registry table, or activation RPC is part of this slice.
The implementation is a pure function and introduces no new state machine, so
no Quint model is added.

Local verification passes 283/283 repository tests (including eight new
readiness tests), the Phase 6 monitoring eval, lint, typecheck, production
build, and repository data policy.

## Verification

Run:

```bash
node --import tsx --test tests/scope-readiness.test.ts
npm test
npm run eval:phase6
npm run lint
npm run typecheck
npm run build
npm run data:check
```

## Follow-up before activation

1. Produce trusted, scope-bound artifacts and typed adapters for the remaining
   four grouped gates: source/grounding, privacy, assurance-label, and release.
2. Complete receiver configuration, scheduler activation, deployment, and
   signed package/watchlist/delta/rerun production smoke.
3. Add an explicit, versioned, reversible scope registry as a separately
   modeled state machine; use Quint before implementation.
4. Keep every unregistered or unsupported scope typed and blocked.
5. Keep Reviewer Registry governed by GitHub Issue #35; it is not a bootstrap
   dependency for machine-assured readiness.
