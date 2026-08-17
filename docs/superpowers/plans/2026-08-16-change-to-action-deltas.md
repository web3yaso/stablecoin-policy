# Phase 6 Change-to-Action Deltas — Implementation Plan

Status: implementation complete and under full verification on
`codex/change-to-action-deltas`.

## Change

Turn a newly `PUBLISHED` regulatory event with a `REVIEWED` impact on an exact
immutable package claim dependency into one immutable, cursor-ordered,
evidence-backed Change-to-Action Delta for that package's active watchlist.
Expose the deltas to Citely through the existing exact-package entitlement.

## Accepted boundary

The approved first slice has these observable states:

- upstream event: `CANDIDATE | REVIEWED | PUBLISHED`;
- upstream impact: reviewed or not eligible for materialization;
- delta: absent or immutable `REVIEW_REQUIRED`;
- cursor: an opaque package/watchlist-bound checkpoint over a monotonic
  database sequence.

The domain service coordinates through shared PostgreSQL state, so the model
uses plain Quint rather than Choreo. Publication and materialization are one
database transaction. Two representative events model ordering and replay;
relational multiplicity and bounded pagination are covered by pgTAP.

Required properties:

- only a newly `PUBLISHED` event with a `REVIEWED` exact decision-evidence
  impact and an `ACTIVE` watchlist can create a delta;
- one `(watchlist_id, event_id)` creates at most one delta;
- the event, package assurance, and affected claim impacts are frozen in the
  delta snapshot;
- cursor sequences are unique and monotonic, and reusing the same cursor
  returns the same page until new publications occur after it;
- a cursor is invalid if it targets another package/watchlist or names a
  sequence that does not exist for that watchlist;
- the historical package, conclusions, rules, profile, and artifact remain
  unchanged;
- every first-slice delta is visibly `REVIEW_REQUIRED` and returns only the
  fixed operational actions `REVIEW_EVIDENCE_CHANGE` and
  `REQUEST_PLAYBOOK_RERUN`, with required response
  `ACKNOWLEDGE_AND_RERUN`.

The fixed actions request review and a new deterministic evaluation; they do
not assert that the old conclusion changed and do not infer a legal outcome.

Customer identity, subscriptions, entitlement storage, profiles, webhook or
email delivery, automatic reruns, superseding evaluations, notification
throttling, and product thresholds for mandatory counsel escalation remain out
of scope.

## API contract

`GET /v1/playbook-packages/{id}/watchlist/changes`:

- requires the existing short-lived `playbook:read` entitlement for the exact
  package;
- accepts optional `after_cursor` and `limit` (`1..100`, default `50`);
- returns strict schema `1.0.0`, ordered `items`, a non-null `nextCursor`, and
  `hasMore`;
- returns a cursor even for an empty first page, so Citely can store one stable
  checkpoint;
- returns `400` for malformed, foreign, future, or nonexistent cursors;
- returns `404` when the exact package has no watchlist;
- is `no-store` and reveals no profile, raw rule, prompt, artifact body,
  customer, entitlement, or delivery destination.

Citely advances its stored cursor only after durably processing the returned
page. Reusing the prior cursor intentionally replays the page, giving the pull
API at-least-once processing semantics without requiring webhook delivery.

## Storage and transition

Migration `0033` adds:

- `policy.playbook_watchlist_change_deltas` for immutable event/package/action
  snapshots and global cursor order;
- `policy.playbook_watchlist_delta_claim_impacts` for canonical immutable
  reviewed impact snapshots;
- an `AFTER UPDATE OF event_state` trigger that materializes eligible deltas
  atomically when an event first becomes `PUBLISHED`;
- a service-only paginated RPC that validates package/watchlist-bound cursors.

The migration backfills only events whose `published_at` is at or after the
watchlist's `created_at`. This preserves the subscription start boundary.
Small queryable metadata belongs in PostgreSQL; no Object Storage object is
created for a delta.

## Verification and stop conditions

The implementation must stop and return to the contract if it:

- emits a delta for candidate, unreviewed, dismissed, or unrelated evidence;
- mutates a historical package or invents a new legal conclusion;
- creates duplicate `(watchlist,event)` rows or permits a cursor to cross a
  package/watchlist boundary;
- makes delta tables public or grants the service role direct table access;
- stores customer, profile, entitlement, delivery, raw rule, prompt, or
  artifact-body data;
- changes the initial fixed action set without a new product decision and
  schema/model update.

## Spec-to-code coverage map

| Quint state/action | Implementation owner | Verification gate |
|---|---|---|
| completed immutable package and active watchlist | migrations `0030`–`0032` | existing package/watchlist Quint and pgTAP suites |
| `reviewEvent` upstream precondition | migration `0019` controlled review workflow | existing regulatory-change publication suite |
| `publishEvent` plus atomic delta creation | migration `0033` trigger `materialize_playbook_watchlist_change_deltas` | `materializedDeltaRequiresReviewedExactImpact`; pgTAP publication assertions |
| immutable event/package/impact snapshot | `playbook_watchlist_change_deltas` and `playbook_watchlist_delta_claim_impacts` | `historicalPackageIsNeverMutated`; immutable-row pgTAP assertions |
| idempotent materialization replay | unique `(watchlist_id,event_id)` plus `ON CONFLICT DO NOTHING` | `materializationReplayIsIdempotent` and replay pgTAP assertion |
| ordered poll and next cursor | RPC `get_playbook_watchlist_change_deltas` | `deltaCursorsAreUniqueAndMonotonic`, `acceptedPollReturnsNextStableCursor`, parser/route tests |
| cursor binding rejection | TypeScript cursor codec plus RPC watchlist/sequence validation | `cursorNeverMovesBackward`, cross-target unit and pgTAP cases |
| fixed review/rerun response | migration constraints, strict parser, JSON Schema | `materializedDeltaHasFixedOperationalResponse`, contract tests |

HTTP serialization, JWT cryptography, CORS, database transport failures, page
sizes above the two-event model, and production scheduling are intentionally
outside Quint. They are covered by existing auth tests, strict route/parser
tests, pgTAP, build verification, and rollout operations.

## Implementation status

- accepted type sketch and scope: complete;
- Quint model, 10 scenarios, 7 invariants, and 9 witnesses: complete;
- migration `0033`, atomic trigger, immutable snapshots, controlled RPC, and
  36 pgTAP assertions: complete;
- strict TypeScript parser/cursor codec, authenticated route, JSON Schema,
  OpenAPI, unit/route/entitlement tests: complete;
- canonical and operations documentation: complete;
- full repository quality gate and pull request: pending;
- production migration, deployment, and signed Citely smoke: not started.

## Final implementation status

- spec-to-code gap analysis: no uncovered in-scope transition;
- implementation steps through documentation and CI registration: done;
- blocking invariant or witness failure: none;
- rollback boundary: disable the route/poller and preserve all immutable rows;
- next gate: pull-request checks, then explicit production rollout of
  migrations `0031`–`0033`.
