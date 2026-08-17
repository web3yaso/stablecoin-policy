# Phase 6 Change-to-Action Webhook Operations

## Scope

This checkpoint delivers each immutable Change-to-Action Delta at least once
to one deployment-level Citely receiver. It does not register customer
destinations or send customer email. Citely remains responsible for account,
subscription, customer notification preferences, fan-out, and customer-facing
delivery history.

Migration `0034` creates a transactional outbox when migration `0033` inserts a
delta. A bounded dispatcher claims due rows with a lease, signs and sends the
presentation-safe delta, then atomically records an immutable attempt and moves
the row to `PENDING`, `DELIVERED`, or `DEAD_LETTER`. Expired leases are audited
as `LEASE_EXPIRED` and recovered on a later claim.

## Webhook contract

Payload schema:

- `contracts/v1/playbook-change-webhook.schema.json`;
- schema version `1.0.0`;
- event type `playbook.watchlist.change`;
- immutable event and deduplication ID equal to `deltaId`;
- `data` equal to the strict presentation-safe delta returned by the pull API.

Headers:

- `Webhook-Id`: immutable `deltaId`;
- `Webhook-Timestamp`: Unix seconds for this attempt;
- `Webhook-Signature`: `v1=` plus base64url HMAC-SHA256;
- `Content-Type: application/json`.

The signed input is the exact UTF-8 string:

```text
Webhook-Id + "." + Webhook-Timestamp + "." + exact request body
```

Citely must verify the signature over the exact body bytes before parsing,
reject timestamps outside its replay window, and durably deduplicate by
`Webhook-Id`. It should return 2xx only after idempotent durable processing. A
delivery retry or operator replay intentionally reuses the same event ID and
payload, while the attempt timestamp and signature change.

## Outcome and retry policy

- any 2xx: `SUCCEEDED` and `DELIVERED`;
- 408, 409, 425, 429, or 5xx: `RETRYABLE_FAILURE`;
- other non-2xx responses, including redirects: `PERMANENT_FAILURE`;
- timeout or network error: `RETRYABLE_FAILURE` with a sanitized error code;
- retry delays per cycle: 60 seconds, 300 seconds, then dead letter on the
  third failed claim;
- operator replay resets only the cycle counter. Total attempt and replay audit
  remain append-only and the delta identity never changes.

The dispatcher never reads or stores a receiver response body and never stores
raw network errors.

## Runtime configuration

Required production environment variables:

- `CRON_SECRET`: 32–256 characters; authenticates the scheduler request;
- `CITELY_WEBHOOK_URL`: HTTPS receiver without credentials, query, or fragment;
- `CITELY_WEBHOOK_SIGNING_SECRET`: 32–256 characters and shared out of band
  with the Citely receiver;
- existing `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

Optional bounded configuration:

- `POLICY_WEBHOOK_BATCH_SIZE`: default `10`, range `1..20`;
- `POLICY_WEBHOOK_LEASE_SECONDS`: default `60`, range `10..300`;
- `POLICY_WEBHOOK_TIMEOUT_MS`: default `10000`, range `100..30000` and less
  than the lease duration.

Secrets must not use `NEXT_PUBLIC_`, appear in logs, be committed to Git, or be
stored in PostgreSQL.

## Scheduler activation

The protected route is:

```text
GET /api/cron/change-delta-webhooks
Authorization: Bearer <CRON_SECRET>
```

It is uncached and returns only aggregate counts. Vercel Cron invokes scheduled
routes with GET and can automatically send `CRON_SECRET` as a Bearer token; see
the official [Cron Jobs](https://vercel.com/docs/cron-jobs) and
[Managing Cron Jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs)
documentation.

No `vercel.json` schedule is enabled in this checkpoint. Vercel Hobby permits
only daily cron execution, while Pro/Enterprise can run per minute. Production
rollout must first choose the acceptable monitoring latency and confirm the
project plan, then add the route schedule and redeploy. The route can be invoked
manually or by another authenticated scheduler before that activation.

## Audit and replay

The service-only RPCs are:

- `claim_playbook_webhook_deliveries(limit, lease_seconds)`;
- `complete_playbook_webhook_delivery(...)`;
- `get_playbook_webhook_delivery_audit(delta_id)`;
- `replay_playbook_webhook_delivery(delta_id)`.

There is deliberately no public or browser replay endpoint. A replay is an
operator action and creates an immutable replay-audit row before requeueing.
The audit response contains typed statuses and timestamps only; it contains no
receiver URL, signing secret, response body, customer identity, profile,
entitlement, raw rule, prompt, or package artifact.

## Rollout and rollback

Rollout order:

1. deploy and verify the Citely receiver with a test key;
2. apply migration `0034` after production migrations `0031`–`0033`;
3. configure the three required webhook/cron secrets;
4. deploy the route and invoke one authenticated dry batch;
5. verify signature, durable Citely deduplication, attempt audit, and zero
   sensitive log output;
6. add the selected production schedule and monitor dead-letter counts.

Rollback is non-destructive: remove/disable the schedule or unset the receiver
configuration. Pending and dead-letter rows plus immutable audit remain in
PostgreSQL, and Citely can continue using the existing cursor pull API. Do not
delete outbox or attempt rows.
