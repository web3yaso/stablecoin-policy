# Phase 6 Package Watchlists — Implementation Plan

Status: implementation complete and under verification on
`codex/package-watchlists`.

## Change

Create one immutable, presentation-safe watchlist from one completed immutable
`PlaybookPackage`, then resolve reviewed published claim impacts to affected
watchlists without storing customer or delivery data.

## Accepted boundary

The first slice has four state families:

- package: `MISSING | COMPLETED`;
- watchlist: `NONE | ACTIVE`;
- event: `CANDIDATE | REVIEWED | PUBLISHED`;
- impact: `PENDING | REVIEWED | DISMISSED`.

The model uses shared PostgreSQL state and no actor-to-actor message protocol,
so plain Quint is the appropriate shape. One representative package/claim pair
captures the atomic transition; relational multiplicity is covered in pgTAP.

Required properties:

- an active watchlist requires a completed package and a non-empty immutable
  decision-evidence dependency set;
- one package creates at most one watchlist and an exact retry returns the same
  identity;
- a watchlist match requires an active watchlist, a `PUBLISHED` event, a
  `REVIEWED` impact, and an exact dependency match;
- candidate events and pending/dismissed or unrelated impacts cannot expose a
  watchlist;
- monitoring never mutates the package, dependency set, or watchlist binding.

Customer identity, Citely subscription state, entitlement records, profile
facts, webhook destinations and secrets, delivery attempts, actions,
superseding evaluations, and watchlist pause/close/reactivate transitions are
out of scope.

## API contract

`POST /v1/playbook-packages/{id}/watchlist` requires the existing short-lived
Citely `playbook:read` entitlement for that exact package. It returns `201` on
first creation and `200` plus `Idempotency-Replayed: true` on retry. It accepts
no request body. Citely owns the account/subscription relationship and stores
the returned opaque watchlist ID.

## Implementation steps

1. Add `specs/packageWatchlist.qnt` and its separate test module; run typecheck,
   scenario tests, sampled invariants, and witnesses before database code.
2. Add forward-only migration `0032` with the private immutable watchlist table,
   idempotent service-only creation RPC, and reviewed/published affected-
   watchlist lookup.
3. Add strict TypeScript response parsing and the authenticated dynamic Route
   Handler; keep responses `no-store` and preserve the current Citely auth
   contract.
4. Add JSON Schema, OpenAPI discovery, unit/route tests, pgTAP permission and
   state-boundary assertions, CI registration, and operations documentation.
5. Run the complete repository quality gate. Applying migrations `0031` and
   `0032` to production remains a separate ordered rollout.

## Stop conditions

Stop and return to the contract if any implementation permits an empty-
dependency watchlist, creates two watchlists for one package, exposes a
watchlist for an unpublished/unreviewed/unrelated impact, stores Citely
commercial identity, or permits public/browser database access.

## Implementation status

- accepted formal contract: complete;
- Quint typecheck, 9 scenarios, 5 invariants, and 9 witnesses: complete;
- migration `0032`, private table, controlled RPCs, and 29 pgTAP assertions:
  complete;
- TypeScript store, strict response parsing, authenticated bodyless route,
  JSON Schema, OpenAPI, and route/entitlement tests: complete;
- operations and rollout documentation: complete;
- full repository quality gate and PR: pending;
- production migrations `0031`/`0032` and signed smoke: not started.
