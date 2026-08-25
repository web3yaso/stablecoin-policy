# Phase 6 Monitoring Eval and Scope Gate — Implementation Plan

Status: implemented locally on `codex/phase6-monitoring-eval`; CI and PR
verification pending.

## Goal

Turn the formal Phase 6 monitoring thresholds into an executable, versioned
release gate. The gate measures known affected-package recall per supported
scope, rejects every missed critical change, and fails closed on package
matches outside the expected exact dependency set.

This closes a measurement gap. Package dependencies, watchlists,
Change-to-Action Deltas, webhook delivery, and superseding evaluations already
have state-machine, database, and contract coverage, but the repository did
not yet calculate the formal monitoring metrics from a committed regression
dataset.

## Accepted boundary

- The dataset is sanitized and contains no customer, entitlement, raw Business
  Profile, private rule, reviewer, payment, webhook destination, or artifact
  body.
- A package is affected only when the event is `PUBLISHED`, a package's exact
  immutable dependency claim has a `REVIEWED` impact, and its package-derived
  watchlist is still `ACTIVE`.
- Candidate events, pending or dismissed impacts, unrelated claims, and
  superseded watchlists cannot produce an affected package.
- Known affected-package recall must be at least `0.95` for every evaluated
  scope. A critical miss is never allowed.
- False-positive package matches are an exact-dependency safety failure and
  are never traded for recall.
- Passing this monitoring gate does not authorize broad self-service. Source,
  retrieval, deterministic-rule, privacy, assurance, contract, and release
  gates remain independent and mandatory.
- Reviewer Registry remains governed by GitHub Issue #35 and is not a
  bootstrap dependency for this machine-assured regression dataset.

## Artifacts

- `evals/monitoring-events.jsonl`: versioned regression cases for the two MVP
  scopes, including affected, unaffected, critical, candidate, pending,
  dismissed, unrelated, superseded, fan-out, and deduplication cases.
- `contracts/v1/monitoring-eval-case.schema.json`: strict case contract.
- `contracts/v1/monitoring-eval-report.schema.json`: strict report contract.
- `lib/monitoring/eval.ts`: strict parser, exact monitoring evaluator,
  deterministic dataset identity, per-scope metrics, and fail-closed outcome.
- `scripts/evals/run-phase6-monitoring.ts`: CI runner.
- `tests/monitoring-eval.test.ts`: positive, negative, schema, privacy, and
  parser regression coverage.

## Metrics and release decision

The report is deterministic for the same canonical dataset and contains:

- known affected and recalled package counts;
- monitoring recall;
- critical miss count;
- false-positive count;
- exact-case accuracy;
- the same metrics per jurisdiction, asset, and playbook scope;
- explicit limitations and a `PASSED` or `FAILED` outcome.

A scope passes this monitoring gate only when it contains at least one known
affected package, recall is at least `0.95`, critical misses equal zero, and
false positives equal zero. A scope with no known affected packages receives
recall `1` only for arithmetic safety and explicitly fails the scope gate.

## Verification

Run:

```bash
npm run eval:phase6
node --import tsx --test tests/monitoring-eval.test.ts
npm run lint
npm run typecheck
```

The repository quality workflow runs `eval:phase6` on every pull request and
push to `main`. Production-scale or hidden monitoring datasets may later live
in object storage with a pinned manifest, while small sanitized regressions
remain in Git.

## Follow-up

- Add production errors and material corrections as versioned regression
  cases without rewriting old dataset identities.
- Add newly supported jurisdiction/asset/playbook combinations as separate
  scopes and require every scope to pass.
- Compose this monitoring result with the other Section 13 gates before any
  explicit self-service scope registry is activated.
- Keep production rollout smoke, receiver configuration, and scheduler
  activation as operational checkpoints rather than synthetic eval cases.
