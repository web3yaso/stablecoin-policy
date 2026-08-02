# playbookPackage.qnt — Phase 5 MVP package lifecycle model

Executable model of the PlaybookPackage lifecycle for the two MVP playbooks
(Stablecoin Pre-listing & Product Launch; Business Model Regulatory
Boundary). Run: `npm run spec:playbook`.

## What it covers

One package request: `Requested → InputsConfirmed → Evaluated →
EvidenceAssembled → Sealed`. One representative capability stands in for the
capability matrix (per-capability rules are identical and independent).
`decide` is the single deterministic conclusion source:

| Situation | Conclusion |
|---|---|
| required input missing | `UNDETERMINED` |
| conflicting evidence | `COUNSEL_REVIEW` |
| no direct evidence | `UNDETERMINED` |
| evidence stale | `CONDITIONAL` |
| inputs + direct fresh uncontradicted evidence | `PERMITTED` |

Normative rules the runtime must preserve:

- `permittedRequiresFullSupport` — certainty demands everything; missing or
  degraded evidence can never produce `PERMITTED`;
- evidence assembly refuses a `PERMITTED` conclusion the current evidence no
  longer justifies (`degradedEvidenceBlocksAssemblyTest`);
- `sealedPackagePinsVersions` — sealing captures corpus/dossier/rules/template
  versions and a real conclusion;
- sealed packages are immutable under later degradation; monitoring
  supersedes with a new package (`sealedPackageImmutableUnderDegradationTest`);
- `provisionalNeverHidden` — provisional evidence makes the whole package
  visibly provisional; the flag is propagated, never invented, and a future
  human-reviewed corpus seals non-provisional packages with no model change.

9 scenario tests, 4 invariants, 4 witnesses (all reachable under random
simulation).

## What it does NOT cover

- The concrete capability matrix, DecisionRule content, and reason codes —
  runtime data, exercised by unit tests and evals.
- Evidence lookup mechanics (provisional corpus + dossier queries) — no RAG
  exists in the MVP and none is modeled.
- Payment/entitlement (Citely-side) and Phase 6 monitoring semantics beyond
  the supersede action.
- Multi-package concurrency; idempotency keys are an implementation concern.

## When to update

Update and re-run before changing the runtime's evaluation order, sealing
gates, or assurance propagation. The model is ground truth for lifecycle
behavior.
