# Phase 6 Change-to-Action Webhook Delivery — Implementation Plan

Status: local implementation and full repository verification complete on
`codex/change-delta-webhooks`.

## Change

Deliver each immutable Change-to-Action Delta at least once from the Stablecoin
Policy domain service to one internal Citely webhook receiver. Preserve the
existing pull API as replay and recovery support.

## Accepted boundary

- Stablecoin Policy owns domain delta identity, payload assembly, HMAC signing,
  an outbox, bounded retries, leases, dead-letter state, replay, and domain-side
  delivery audit.
- Citely owns accounts, subscriptions, customer notification preferences,
  customer-facing destinations, and customer delivery history.
- The first slice has one deployment-level Citely receiver. Its URL and HMAC
  secret live only in server environment variables and are never stored in
  PostgreSQL.
- Webhook payloads contain the presentation-safe immutable delta snapshot,
  package/watchlist identity, assurance state, fixed actions, and required
  customer response. They contain no customer profile, entitlement, raw rule,
  prompt, package artifact body, or secret.
- Delivery is at least once. `deltaId` is the immutable webhook event and
  deduplication identity across retries and operator replay.
- Email, customer-configurable webhook registration, automatic playbook reruns,
  superseding evaluations, and customer notification fan-out are out of scope.

## System model and Quint type sketch

The actors are one Stablecoin Policy dispatcher and one Citely receiver. They
communicate over HTTP, but the verification target is the small shared outbox
protocol rather than network ordering or multi-party consensus. The approved
model therefore uses plain Quint instead of Choreo; transport serialization and
cryptographic primitives are verified in TypeScript tests.

Observable delivery states are `ABSENT`, `PENDING`, `LEASED`, `DELIVERED`, and
`DEAD_LETTER`. Abstract integer rounds represent retry and lease time. Major
actions are atomic delta/outbox creation, claim, success, retryable failure,
permanent failure, lease expiry, round advance, and authorized replay.

Required properties:

- an outbox row cannot exist without an immutable delta;
- one delta has one stable webhook event identity and payload version;
- only a due pending row can be leased, and one row has at most one active
  lease;
- failure never marks delivery successful;
- `DELIVERED` requires an immutable successful attempt audit;
- retryable failure schedules a future round and reaches `DEAD_LETTER` at the
  bounded attempt limit;
- permanent failure may dead-letter immediately;
- an expired lease becomes an audited retry or dead letter;
- authorized replay preserves event/payload identity and may produce a
  duplicate delivery that Citely deduplicates by `deltaId`;
- webhook work never mutates the historical PlaybookPackage.

## Planned implementation

1. Add `specs/changeDeltaWebhook.qnt` and scenario tests; register a CI command.
2. Add migration `0034` with a one-row-per-delta outbox, immutable attempt
   audit, controlled claim/complete/replay RPCs, leases, bounded exponential
   backoff, and service-role-only access.
3. Add a strict TypeScript store/parser plus canonical payload and HMAC-SHA256
   signing helpers.
4. Add a protected uncached Node.js cron route that claims a bounded batch,
   sends it to the deployment-level Citely endpoint, and records typed outcomes
   without logging payloads or secrets.
5. Add pgTAP, unit, route, privacy, contract, and configuration tests;
   update canonical documentation and operations instructions.

## Spec-to-code coverage map

| Quint state/action | Implementation owner | Verification gate |
|---|---|---|
| atomic `materializeDelta` and pending outbox | migration `0034` enqueue trigger and backfill | `outboxRequiresImmutableDelta`; pgTAP atomic creation |
| `claimDelivery` | `claim_playbook_webhook_deliveries` lease RPC | `activeOrFinishedDeliveryHasSignedAttempt`; overlapping-claim pgTAP |
| success/failure completion | completion RPC and TypeScript HTTP classifier | `deliveredRequiresSuccessfulAudit`, `failureNeverMarksDelivered`; route/unit/pgTAP |
| bounded retry | database backoff and cycle counter | `retriesAreBoundedAndScheduled`; three-attempt pgTAP |
| lease expiry | claim-time expired-lease reconciliation | `attemptAuditIsCompleteAndAppendOnly`; crash-recovery pgTAP |
| authorized replay | service-only replay RPC and immutable replay audit | `replayPreservesIdentityAndDeduplicates`; replay pgTAP |
| Citely accepts event once | immutable `deltaId`, signed envelope, receiver contract | `citelyAcceptsEventAtMostOnce`; HMAC/schema tests |
| old package remains unchanged | delta-only payload and outbox foreign key | `historicalPackageIsNeverMutated`; privacy tests |

## Implementation status

- accepted boundary and plain-Quint decision: complete;
- Quint: 13 scenarios, 9 invariants, and 9 witnesses: complete;
- migration `0034` and 44 pgTAP assertions: complete;
- strict claim parser, HMAC signer, dispatcher, result classification, and
  protected cron route: complete;
- strict JSON Schema, unit/route/privacy tests, CI command, and operations
  documentation: complete;
- full repository verification: complete (258 unit/route tests, 13 Quint
  scenarios, 375 pgTAP assertions across the repository, lint, typecheck,
  data checks, and production build);
- pull request: pending;
- production migration, Citely receiver, secrets, scheduler plan, deployment,
  and signed smoke: not started.

## Stop conditions

Stop and return to this contract if an implementation stores customer identity
or webhook secrets, creates a webhook without an eligible delta, changes the
delta payload across retry, loses attempt audit, permits overlapping leases,
marks a failed request delivered, retries forever, or mutates an old package.
