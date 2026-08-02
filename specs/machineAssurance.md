# machineAssurance.qnt — Phase 2B machine-assurance lane model

Executable model of the machine-assurance ladder accepted 2026-08-01 (formal
spec §8.4). Gated in `npm run spec:phase2`.

## What it covers

One evidence unit's machine lifecycle:

```text
SOURCE_OBSERVED → SOURCE_VALIDATED → AI_EXTRACTED → AI_CROSS_CHECKED
  → PROVISIONAL_PUBLISHED
```

`HUMAN_REVIEWED` is modeled as a separate upgrade path, not a machine state:
`applyHumanReview` is the only operation that sets the human flags, it requires
a named human, and it never moves the machine ladder. The dedicated
`humanReviewActionTaken` variable lets an invariant prove no machine transition
granted human review.

Deterministic check outcomes (identity/checksum, storage rights, citation
locator, freshness, no-contradiction, cross-check agreement) are booleans the
environment can degrade at any step. Publication guards re-derive everything
from current state; `publishedChecksOk` snapshots the checks at publication so
the safety invariant survives later degradation (which, in the real system,
produces a change event — never a silent unpublish).

| Requirement (spec §8.4) | Invariant / test |
|---|---|
| machine data never labeled human-reviewed | `machineCannotClaimHumanReview`, `automatedReviewerRejectedTest` |
| publication requires every check + audit record | `provisionalRequiresFullChecks`, `publishRequires*Test` |
| blocked/degraded evidence cannot publish | `publishGuardIsCurrent`, `publishBlockedBy*Test` (stale / contradiction / rights) |
| every machine transition writes an assurance record | `ladderWritesAssuranceRecords` |
| human review is an independent upgrade | `humanUpgradeFromProvisionalTest`, `humanReviewOnObservedSourceTest` |

13 scenario tests; 4 invariants; 5 witnesses all reachable (the full published
path is rare under uniform random walk — ~0.1% with five competing degradation
actions — and is pinned deterministically by `happyPathToProvisionalPublishedTest`).

## What it does NOT cover

- The `MachineAssuranceRecord` payload (fingerprints, model/prompt versions,
  confidence, checksums) — migration `0020` and pgTAP own that shape.
- Batch/multi-claim release membership — the provisional-release table
  (migration `0021`) and its pgTAP suite own set-level rules.
- Interaction with the existing human-reviewed release/coverage state machines
  — `legalCorpusPublication.qnt` remains their model; the database write path
  must keep the two lanes physically separate.
- Real legal claims, decision rules, or playbook actions (sanitized).

## When to update

Update and re-run this model **before** implementing or changing any
machine-lane RPC, state column, or publication gate (migrations `0020+`). The
implementation must preserve these transition guards exactly; if code and model
disagree, the model is ground truth unless the product requirement itself
changed.
