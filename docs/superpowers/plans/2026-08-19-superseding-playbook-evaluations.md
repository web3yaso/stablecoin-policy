# Phase 6 Superseding Playbook Evaluations — Implementation Plan

Status: executable specification, migration `0035`, API, contracts, and local
verification complete on `codex/superseding-playbook-evaluations`; production
rollout remains blocked behind the ordered Phase 6 receiver cutover.

## Goal

Let Citely explicitly rerun one immutable paid `PlaybookPackage` after it has
received one or more `ACKNOWLEDGE_AND_RERUN` Change-to-Action Deltas. A
successful rerun creates one immutable successor package and atomically moves
monitoring from the old package to the successor without rewriting history.

## Accepted boundary

- Citely owns purchase, account, subscription, entitlement, raw Business
  Profile, and customer-facing workflow state.
- Stablecoin Policy owns deterministic evaluation, evidence assembly, package
  persistence, package lineage, exact delta coverage, and watchlist handoff.
- The subsite stores only the Business Profile fingerprint already present in
  package metadata. Citely must resubmit the original profile; its canonical
  fingerprint must equal the base package fingerprint. A changed profile is a
  normal new package request, not a superseding rerun.
- A rerun is always explicit. A webhook or pending delta can never create a
  successor automatically.
- The request must cover the complete current pending-delta snapshot for the
  base watchlist. If another delta appears while evaluation is running, stale
  completion fails; a new request fingerprint must claim the refreshed full
  snapshot.
- The base package and its artifact remain immutable. Completion atomically
  registers the successor, records lineage and delta coverage, changes the old
  watchlist from `ACTIVE` to `SUPERSEDED`, and creates or activates the
  successor package's `ACTIVE` watchlist.
- An exact `Idempotency-Key` replay returns the same successor. Reusing the key
  with a different profile, delta set, or request fails with conflict.
- The response reuses the current `PlaybookPackageArtifact` schema so Citely's
  generic renderer does not need a supersession-specific rendering model.

## Executable model

`specs/supersedingPlaybookEvaluation.qnt` models one sealed base package, one
active package-derived watchlist, up to two immutable deltas, an explicitly
authorized rerun claim, one successor, and exact replay. Plain Quint is used
because the verification target is atomic state in one PostgreSQL authority,
not a distributed network protocol.

The model checks historical immutability, exact authorization and profile
binding, no automatic successor, stale-snapshot rejection, refreshed snapshot
completeness, atomic lineage/watchlist handoff, exact delta coverage,
successor profile equality, closure of a superseded watchlist, and replay
identity. Fourteen scenario tests cover successful and rejected paths.

Run:

```bash
npm run spec:superseding-evaluation
```

## Spec-to-code gap analysis

The current runtime can create and replay an initial package, migration `0031`
can atomically persist its metadata and decision-evidence dependencies,
migration `0032` only permits immutable `ACTIVE` watchlists, and migration
`0033` exposes immutable pending deltas. There is no package-lineage model,
delta-coverage state, controlled watchlist transition, rerun claim, or endpoint
that binds execution authority to an exact base package.

The existing `playbook:execute` entitlement is playbook-scoped and rejects a
`packageId`; `playbook:read` is exact-package but cannot authorize execution.
Package metadata retains the profile fingerprint but not the raw profile, so
the API must compare the resubmitted profile's canonical fingerprint with the
base package before evaluation.

## Planned implementation

1. Add migration `0035_superseding_playbook_evaluations.sql` with immutable
   rerun claims, package lineage, and exact delta-coverage records. Replace the
   blanket watchlist update guard with a controlled service-only completion RPC
   that locks the base package/watchlist/delta snapshot and performs successor
   registration, lineage, coverage, old-watchlist supersession, and successor
   watchlist creation in one transaction.
2. Extend Citely service-token validation so `playbook:execute` may target both
   the permitted `playbookId` and the exact base `packageId` for this endpoint.
   Initial package creation continues to reject `packageId`; read operations
   keep their existing exact-package contract.
3. Add strict request parsing and
   `POST /v1/playbook-packages/{id}/rerun`. The body contains the resubmitted
   profile plus the exact pending `deltaIds`; `Idempotency-Key` remains
   mandatory. Claim the snapshot before evaluation, reuse the deterministic
   runtime and artifact store, then complete through the atomic RPC.
4. Keep the response schema unchanged and add only the rerun request contract,
   OpenAPI operation, typed conflict responses, and consumer examples needed
   to call the endpoint.
5. Add pgTAP coverage for locks, stale snapshots, exact delta sets, direct-write
   denial, atomic rollback, one successor, and exact replay; add a true
   two-session PostgreSQL claim race plus auth, parser, route, artifact,
   privacy, OpenAPI, and regression tests.
6. Update operations and canonical status documents. Production rollout stays
   ordered behind the Citely receiver and migrations `0031`–`0034`; apply
   `0035`, deploy, and run signed create/delta/rerun/replay smokes only after
   those prerequisites are green.

## Verification gates

| Requirement | Primary implementation | Required proof |
|---|---|---|
| explicit exact-package rerun | Citely entitlement + rerun route | auth/route denial tests |
| matching Business Profile | canonical fingerprint comparison | mismatch and privacy tests |
| complete current delta snapshot | claim/completion RPC locks | stale pgTAP and two-session concurrency test |
| immutable history | append-only package/artifact/lineage rows | trigger and artifact replay tests |
| atomic successor handoff | one security-definer completion RPC | transaction rollback pgTAP |
| one successor | unique base-package lineage and rerun key | two-session claim race and pgTAP cardinality checks |
| exact replay | request fingerprint + idempotency binding | route, store, and artifact equality tests |
| unchanged Citely renderer | existing response schema | contract fixture validation |

## Implementation record

- `0035_superseding_playbook_evaluations.sql` implements controlled rerun
  claims, immutable lineage and coverage, stale-snapshot rejection, and atomic
  watchlist handoff.
- `POST /v1/playbook-packages/{id}/rerun` requires a signed exact
  playbook+package execution entitlement and never accepts the legacy unscoped
  service key.
- The existing artifact store and deterministic runtime are reused; raw
  profiles are fingerprinted in memory and are not persisted.
- Local migrations `0001`–`0035` apply from zero. The superseding-evaluation
  pgTAP file passes 48/48 assertions, including late-failure transaction
  rollback and zero-partial-write checks for stale snapshots. The separate
  two-session PostgreSQL test produces exactly one `CLAIMED`, one `PENDING`,
  and one durable rerun row; the complete database suite remains a CI gate.
- Quint passes 14 scenarios, 11 invariants, 7 witnesses, and 5,000 sampled
  traces. TypeScript, contract, route, auth, privacy, stale, and replay tests
  are registered in the repository quality gates.

## Out of scope

- Automatic reruns from webhook delivery;
- changed-profile migration or profile editing;
- counsel approval thresholds or Reviewer Registry activation;
- customer identity, payment, notification preferences, or customer webhook
  destinations in the subsite database;
- production application of migrations `0031`–`0035` before the existing
  receiver/secrets/scheduler rollout blockers are cleared.

## Stop conditions

Stop if implementation mutates a historical package, stores a raw Business
Profile, permits playbook-only authority to rerun an arbitrary package, covers
only part of the current delta snapshot, activates two watchlists for one
lineage position, completes against a stale snapshot, or returns a different
successor for an exact replay.
