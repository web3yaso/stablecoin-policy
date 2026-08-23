# Phase 6 Superseding Playbook Evaluation Operations

## Scope

Migration `0035_superseding_playbook_evaluations.sql` and
`POST /v1/playbook-packages/{id}/rerun` implement an explicit
Change-to-Action rerun. Citely resubmits the original confirmed Business
Profile and the complete current pending delta set. Stablecoin Policy stores
the profile fingerprint only, evaluates a new package, and atomically records
the successor and monitoring handoff.

This feature does not automatically run from webhook delivery. It stores no
customer, account, payment, subscription, raw Business Profile, delivery
destination, raw rule, prompt, or package artifact body in PostgreSQL.

## Contract

The endpoint requires a five-minute signed Citely `playbook:execute`
entitlement containing both the exact `playbookId` and exact base `packageId`.
Unlike older cutover endpoints, the rerun endpoint does not accept the legacy
unscoped service key.

The strict body is defined by
`contracts/v1/playbook-package-rerun-request.schema.json`:

- `profile`: the original confirmed Business Profile;
- `deltaIds`: every currently pending immutable delta for the base watchlist,
  with no duplicates or foreign IDs.

`Idempotency-Key` is mandatory. An exact completed retry returns `200`, the
same immutable successor artifact, and `Idempotency-Replayed: true`. First
completion returns `201`. The response remains
`contracts/v1/playbook-package-response.schema.json`.

Typed `409` outcomes include profile mismatch, incomplete/current-snapshot
mismatch, a delta arriving during evaluation, an inactive/already superseded
base package, and changed request reuse of an idempotency key. A stale attempt
creates no package metadata, lineage, coverage, or watchlist transition.

## Atomic database boundary

The claim RPC locks the base package, active watchlist, and current delta
snapshot. The completion RPC rechecks that exact snapshot and, in one
transaction:

1. registers immutable successor package metadata and decision-evidence
   dependencies;
2. completes the shared hashed idempotency record;
3. records one immutable base-to-successor lineage edge;
4. covers every claimed pending delta with that successor;
5. changes the base watchlist from `ACTIVE` to `SUPERSEDED`;
6. creates the successor package's deterministic `ACTIVE` watchlist.

Delta materialization locks the same watchlist row. A concurrent new event
therefore either commits before completion and makes the claim stale, or sees
the old watchlist already superseded and targets only the active successor.

## Production rollout

The required migration order is `0031`, `0032`, `0033`, `0034`, then `0035`.
The database chain was applied under explicit operator direction on
2026-08-20 before receiver activation because production contained no package,
idempotency, regulatory-event, or impact rows. This advanced the empty schema
only; it did not activate delivery or reruns. Until the receiver secrets,
scheduler, application deployment, and signed smoke are complete, do not
publish a production change event.

1. Configure and smoke the Citely webhook receiver, signing secret, cron
   secret, and selected scheduler.
2. Back up private `policy`, `regulatory`, and retrieval metadata.
3. Run a linked migration dry-run through `0035`, database lint, and the full
   pgTAP suite.
4. Confirm migration history through `0035` and deploy the application.
5. Create a fresh signed package and watchlist; publish a sanitized reviewed
   matching change through the operator smoke path.
6. Mint an exact package+playbook execute token and call rerun with the original
   profile and full pending delta set. Require `201`.
7. Retry the exact request/key and require `200`, identical artifact bytes, and
   the replay header.
8. Require `403` for wrong package/playbook and for the legacy key; require
   `409` for changed profile, partial delta set, and changed key reuse.
9. Verify one lineage edge, complete delta coverage, old `SUPERSEDED`
   watchlist, new `ACTIVE` watchlist, and unchanged historical artifact.

Never print or persist the JWT, service role key, raw idempotency key, Business
Profile, package artifact body, or webhook secrets during smoke.

## Verification record

Local checkpoint on 2026-08-20:

- migrations `0001` through `0035` applied from zero;
- Quint: 14 scenarios, 11 invariants, 7 witnesses, and 5,000 sampled traces;
- new pgTAP: 34/34 assertions; full repository pgTAP: 409/409 assertions;
- strict request/token schemas, artifact-store, route, entitlement, privacy,
  replay, stale-snapshot, OpenAPI, lint, typecheck, and build gates are part of
  the branch verification;
- production migrations `0031`–`0035` were applied in order on 2026-08-20
  after a linked dry-run and two private pre-cutover backups. The data-only
  dump SHA-256 was
  `2fa519a931b10d12ea47b0a3267789750d8b1173c8ef73a0b958d6eae46e58aa`;
  the metadata backup SHA-256 was
  `e027e4b9cf16ebac328c8be02242e888e32cee39b4631a2e2387981a60862553`;
- remote history matches local `0001`–`0035`. Linked database lint passes with
  only the pre-existing informational `record_machine_assurance.v_version`
  warning. The normalized post-cutover metadata snapshot is identical to the
  pre-cutover snapshot and every new monitoring collection is empty;
- receiver configuration, scheduler activation, application deployment, and
  signed package/watchlist/delta/rerun smoke remain incomplete. Database
  migration completion must not be described as a complete Phase 6 cutover.

## Rollback

Migrations are forward-only. Before any production rerun, the route may be
disabled while leaving unused tables and RPCs in place. After a successor
exists, never reactivate or rewrite the base watchlist, lineage, delta coverage,
package metadata, or artifact. Disable new reruns, retain all audit state, and
ship a forward migration for corrections.
