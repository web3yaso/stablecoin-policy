# Phase 6 Deterministic Rule and Action Readiness Gate — Implementation Plan

Status: implemented and locally verified on
`codex/deterministic-rule-action-gate`; production
activation is explicitly out of scope.

## Goal

Turn the existing deterministic playbook runtime and `playbookPackage.qnt`
decision contract into a strict, versioned, per-scope eval artifact. That
artifact is the only typed source for the
`DETERMINISTIC_RULE_AND_ACTION` readiness gate.

## Formal-spec impact

No Quint transition, invariant, or witness changes are required. The runtime
must continue to implement the existing decision ordering: missing input,
conflict, missing direct evidence, stale prohibition, fresh prohibition,
stale evidence, then fully supported permission. The eval adds executable
coverage around that model and the existing requirement that RAG cannot alter
deterministic decisions.

One runtime presentation defect is corrected without changing the modeled
decision: an `UNDETERMINED` result must emit a non-executable operational
safety action instead of a rule action that could appear authoritative without
direct evidence.

## Accepted boundary

- Cover both exact MVP scopes independently.
- Use a small reviewed JSONL dataset with strict schema validation.
- Cover supported, prohibited, missing-input, missing-evidence, stale,
  conflicting-evidence, and unverified-deployment behavior where applicable.
- Require exact conclusions and ordered reason codes.
- Require repeated pinned evaluation to be byte-for-byte deterministic.
- Exercise RAG disabled, success, and outage paths and require zero change to
  deterministic conclusion/reason projections.
- Require every material rule action to have claim evidence; degraded
  `UNDETERMINED` outputs may contain only the allowlisted operational safety
  action.
- Emit hashes, booleans, and aggregate metrics only. Do not copy Business
  Profiles, rules, actions, claims, dossiers, source text, URLs, customer data,
  or credentials into the report.
- A passing eval never activates self-service and does not replace production
  smoke.

## Metrics and gate

Each scope must meet the minimum case count and exactly `1.0` for:

- status and reason-code exact-match rate;
- repeated-run exact-match rate;
- RAG isolation rate;
- safe-degradation rate;
- material-action grounding rate.

Any malformed case, duplicate case ID, expectation drift, nondeterministic
result, RAG-dependent decision, unsafe degraded action, or ungrounded material
action fails the scope.

## Implementation sequence

1. Add strict case/report schemas and the versioned sanitized dataset.
2. Add a pure evaluator and fixture adapter for the current runtime.
3. Correct `UNDETERMINED` action degradation and add runtime regression tests.
4. Add the exact-scope readiness adapter, runner, package script, and CI gate.
5. Add positive, failure-injection, privacy, determinism, schema, and adapter
   tests.
6. Update canonical development documents and the local context index.
7. Run Quint after substantive implementation and then the full repository
   quality suite.

## Verification

```bash
npm run spec:playbook
npm run eval:phase5:deterministic
node --import tsx --test tests/deterministic-rule-action-eval.test.ts tests/playbook-runtime.test.ts tests/scope-readiness.test.ts
npm run lint
npm run typecheck
npm test
npm run build
npm run data:check
```

Local verification passes the unchanged 11-scenario Quint model and all five
invariants, the 11-case deterministic eval at `1.0` for every metric in both
scopes, 295 repository tests, the monitoring and contract/replay evals, Citely
fixture replay, lint, typecheck, production build, and repository data policy.
