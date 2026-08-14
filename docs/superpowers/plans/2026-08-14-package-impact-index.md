# Phase 6 Package Impact Index — Implementation Plan

Status: implementation in progress on `codex/package-impact-index`.

## Change

Index the exact deterministic evidence-claim dependencies of every immutable
`PlaybookPackage`, then resolve a published, human-dispositioned regulatory
event to affected packages without reading private Storage artifacts or raw
customer profiles.

## Formal boundary

Ground truth: `specs/packageImpact.qnt` and `specs/packageImpact_test.qnt`.

The model uses shared atomic state and one representative package/claim pair.
It requires:

- package metadata and decision-evidence dependencies are registered atomically;
- candidate or merely reviewed events cannot affect a package;
- dismissed or pending claim impacts cannot affect a package;
- only an exact immutable claim dependency can produce a package match;
- a completed package is never mutated by monitoring.

Multiple packages and claims are a relational set expansion of the same pair
transition and are covered by pgTAP joins. Notification transport, watchlists,
reruns, dossier/rule dependencies, and customer profiles are out of scope.

## Implementation steps

1. `supabase/migrations/0031_playbook_package_impact_index.sql`
   - add immutable, service-readable package→decision-evidence claim edges;
   - wrap package registration so metadata, idempotency completion, and claim
     dependencies commit in one database transaction;
   - add a service-only lookup requiring `PUBLISHED` event state and `REVIEWED`
     exact claim impacts.
   - Quint gates: `completedPackageHasAtomicDependencyIndex`,
     `affectedPackageRequiresPublishedReviewedImpact`.
2. `lib/playbooks/artifacts.ts` and `lib/monitoring/package-impact.ts`
   - derive dependencies only from the checksum-verified EvidenceBundle;
   - reject a bundle that differs from conclusion claim references;
   - strictly parse the service-only impact response.
   - Quint gate: `affectedPackageRequiresExactImmutableDependency`.
3. Tests and CI
   - add pgTAP permission, atomicity, membership, idempotency, candidate-event,
     dismissed-impact, and exact-match cases;
   - add TypeScript artifact and response-parser tests;
   - run `spec:package-impact` in CI.
   - Quint gate: all four invariants and seven witnesses.
4. Documentation
   - record Phase 6 foundation status in the master plan and local context;
   - keep delivery channel, watchlist API, and re-evaluation semantics explicitly
     pending their own product/contract decisions.

## Rollback criteria

Stop and return to planning if any Quint invariant fails, an unreviewed event
can return a package, package registration can complete without its exact
dependency set, or any public/anonymous role can read the private index.

## Status

- Quint type sketch and scope: approved.
- Quint scenarios/invariants/witnesses: complete.
- Migration and atomic package registration: complete.
- TypeScript dependency extraction and response parsing: complete.
- pgTAP and roadmap documentation: complete.
- Full repository verification: complete.
- PR: pending.
