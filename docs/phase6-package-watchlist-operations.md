# Phase 6 Package Watchlist Operations

## Scope

Migration `0032_playbook_package_watchlists.sql` adds the first package-derived
watchlist slice. It creates one immutable `ACTIVE` watchlist for one completed
immutable `PlaybookPackage` with a non-empty exact decision-evidence claim
dependency set.

This checkpoint does not implement customer subscription state, delivery
destinations, webhook secrets, pause/close/reactivate transitions,
change-to-action deltas, package reruns, or superseding evaluations. Citely
continues to own accounts, subscriptions, entitlements, and delivery state.

## Contract

`POST /v1/playbook-packages/{id}/watchlist`:

- requires the existing five-minute Citely `playbook:read` entitlement for the
  exact package ID;
- accepts no request body;
- returns `201` and schema `1.0.0` on first creation;
- returns `200`, the exact same watchlist identity, and
  `Idempotency-Replayed: true` on retry;
- returns `404` for an unknown package and `409` for a package with no
  decision-evidence dependencies;
- is `no-store` and does not return raw rules, profiles, customer data,
  subscription data, or delivery configuration.

The internal service-only `get_affected_playbook_watchlists` RPC returns an
active watchlist only when all of these are true:

1. the regulatory event is `PUBLISHED`;
2. the claim impact is `REVIEWED`;
3. the impact claim exactly matches an immutable package dependency;
4. that package has an immutable `ACTIVE` watchlist.

Candidate events, pending or dismissed impacts, and unrelated claims fail
closed.

## Production rollout

Do not apply `0032` before `0031`.

1. Confirm package tables are empty or complete the explicit `0031` dependency
   backfill required by that migration.
2. Back up private `policy` and `regulatory` metadata using the existing
   metadata backup procedure.
3. Run the linked migration dry-run and verify both `0031` and `0032` are in
   order.
4. Apply migrations `0031` then `0032`.
5. Run database lint and the full Supabase pgTAP suite.
6. Deploy the application with the existing Citely public-key configuration;
   no JWT scope change is required.
7. Create a fresh production-like package through the signed package smoke.
8. Mint a short-lived `playbook:read` token for that exact package and call the
   watchlist endpoint twice. Require `201` then `200`, the same body, and the
   replay header on the second response.
9. Verify wrong-package entitlement returns `403`, a body returns `400`, and
   no customer or delivery data exists in `policy.playbook_package_watchlists`.

Never log a JWT, service key, package artifact, customer profile, or complete
watchlist response during the smoke.

## Verification record

Local checkpoint on 2026-08-14:

- migration chain `0001` through `0032` applied from zero;
- Quint: 9 scenarios, 5 invariants, and 9 witnesses passed;
- pgTAP: 29/29 watchlist assertions passed;
- strict TypeScript parser, JSON Schema, route, entitlement, and OpenAPI tests
  passed;
- production migration and signed endpoint smoke were not performed by this
  development checkpoint.

## Rollback

Before any production watchlist exists, application rollback may remove the
route while leaving the new private table and functions unused. PostgreSQL
migrations remain forward-only.

After a watchlist exists, do not drop or mutate it. Disable the application
route and affected-watchlist consumer, retain the immutable audit record, and
ship a forward migration for any schema correction. Historical package and
watchlist identities must never be silently rewritten.
