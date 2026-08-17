# Phase 6 Change-to-Action Delta Operations

## Scope

Migration `0033_change_to_action_deltas.sql` adds the first Citely-consumable
monitoring output. A newly published, human-reviewed regulatory event creates
one immutable `REVIEW_REQUIRED` delta for each active watchlist whose package
has an exact matching decision-evidence claim dependency.

This checkpoint does not send webhook/email notifications, rerun packages,
change old conclusions, persist customer/subscription data, or decide whether
counsel escalation is mandatory.

## Poll contract

`GET /v1/playbook-packages/{id}/watchlist/changes`:

- requires a five-minute Citely `playbook:read` entitlement targeting the exact
  package;
- accepts `after_cursor` and `limit=1..100` (default `50`);
- returns ordered immutable deltas, `nextCursor`, and `hasMore` under schema
  `1.0.0`;
- binds every cursor to the package and immutable watchlist;
- rejects malformed, cross-package, cross-watchlist, future, and nonexistent
  cursors;
- returns `Cache-Control: no-store`.

Citely should process a page durably, then persist `nextCursor`. If processing
fails, retry the old cursor; the same page is returned. Poll again immediately
while `hasMore=true`, then use the product-selected polling interval.

Every item is `REVIEW_REQUIRED` and asks Citely/user to:

1. review the named evidence changes;
2. acknowledge the event;
3. resubmit confirmed facts through the ordinary playbook endpoint to request
   a new immutable package.

The old package remains a historical artifact and must not be overwritten.

## Production rollout

Apply migrations in order: `0031`, `0032`, then `0033`.

1. Confirm the `0031` package-dependency backfill precondition and the `0032`
   watchlist rollout are satisfied.
2. Back up private `policy` and `regulatory` metadata.
3. Run the full local migration-from-zero and pgTAP suite.
4. Review the `0033` backfill query. It includes only published events at or
   after each watchlist's `created_at`.
5. Apply `0033` to production and run Supabase database lint.
6. Verify `anon`, `authenticated`, and `service_role` have no direct table
   access; only `service_role` may execute the paginated RPC.
7. Deploy the application. No Citely JWT scope change is required.
8. Create a fresh production-like package and watchlist through signed
   endpoints.
9. Publish a sanitized reviewed change through the existing controlled
   regulatory-event workflow. Do not directly update production event rows.
10. Poll without a cursor, verify one `REVIEW_REQUIRED` item, store
    `nextCursor`, retry the old cursor to verify replay, then poll the new
    cursor and verify the empty stable page.
11. Verify wrong-package entitlement returns `403`; malformed/foreign cursor
    returns `400`; the endpoint and all logs expose no customer profile, JWT,
    service key, raw rule, artifact body, or webhook destination.

Never print production credentials, complete private package artifacts, or
customer facts during rollout or smoke tests.

## Verification record

Local development checkpoint on 2026-08-16:

- Quint: 10 scenarios, 7 sampled invariants, and 9 witnesses passed;
- migration chain through `0033` and 36/36 delta pgTAP assertions passed;
- strict cursor/parser/schema, route, entitlement, and OpenAPI tests passed;
- full repository quality gate is recorded in the pull request;
- production migration and signed endpoint smoke were not performed by this
  development checkpoint.

## Rollback

Migrations are forward-only.

Before a production delta exists, the application route may be disabled while
the private tables and trigger remain unused. After any delta exists, never
drop, delete, resequence, or rewrite it. Disable polling in the application,
retain immutable records, and use a new forward migration for corrections.

If the trigger causes publication failures, stop regulatory-event publication,
disable the trigger only through an approved forward operational change, and
preserve the failed transaction evidence. Event publication and delta creation
are atomic, so a failed materialization must not leave a `PUBLISHED` event
without its eligible deltas.
