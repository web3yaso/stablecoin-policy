# Phase 1 External Storage Operations

This runbook covers the Issue #14 migration from Git-backed generated data to Supabase PostgreSQL and Storage. It does not authorize a production cutover by itself.

## Runtime modes

`STABLECOIN_POLICY_DATA_BACKEND` accepts:

- `file`: default compatibility mode; all reads remain local;
- `dual`: file is authoritative and returned to callers, while Supabase is read and compared;
- `supabase`: external metadata and objects are authoritative.

Dual-read observation logs an error and serves the file result. Set `POLICY_DUAL_READ_STRICT=1` only after backfill to make any external failure or mismatch block the read. Public and paid callers never receive storage keys, buckets, checksums, or service credentials.

## Cache and outage policy

The default fresh window is 300 seconds and the maximum stale window is 86,400 seconds. Both are configurable server-side. A previously checksum-verified snapshot may be served after a transient external error only while it remains inside the maximum stale window.

- Public datasets return `X-Data-Cache-State`, `X-Data-Generated-At`, `X-Dataset-Release`, and an ETag.
- A stale public response includes `Warning: 110 - "Response is stale"` and `X-Data-Stale: true`; the UI labels it as a cached snapshot.
- A cold instance with no acceptable cache returns `503` during an outage.
- Paid report metadata and encrypted artifacts use the same bounded server cache. Missing, expired, or checksum-invalid content fails closed with `503`; it is never regenerated from an LLM fallback.
- Complete daily report datasets remain private and are not in the public dataset allowlist.

In-memory cache improves warm-instance availability but is not a backup. Supabase point-in-time/database backups and immutable Storage objects remain the durable recovery mechanisms.

## Initial setup

1. Confirm Supabase region, data-residency requirements, backups, and recovery objectives.
2. Create private `policy-reports` and `policy-datasets` buckets.
3. Expose the `policy` schema to the Supabase service-role API.
4. Apply `0001_external_storage_foundation.sql` and `0002_phase1_external_storage.sql` in order, then run `notify pgrst, 'reload schema';` so the publication RPCs enter the API schema cache.
5. Configure `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` only on servers and GitHub Actions. Never use a `NEXT_PUBLIC_` prefix.
6. Run `npm run storage:publish -- --dry-run`, review counts and sizes, then run `npm run storage:publish`.

Publishing is idempotent. Object keys include the logical asset, timestamp, and SHA-256 checksum; an existing key with different bytes is rejected. PostgreSQL publication functions register metadata and move the active pointer atomically after the object upload succeeds.

## Verification and cutover

1. Deploy with `STABLECOIN_POLICY_DATA_BACKEND=dual` and `POLICY_DUAL_READ_STRICT=0`.
2. Exercise report listing, x402 delivery, Alipay delivery, public news summaries, entity news, and historical daily-report replay.
3. Resolve all parity or external-read warnings.
4. Enable strict dual-read and repeat tests through at least one scheduled ingestion.
5. Deploy `supabase` mode and test origin outage within and beyond the stale window.
6. Verify a previous release with `npm run storage:restore -- --kind dataset --id daily-report --release <id>`.
7. Repeat with `--apply`, verify the previous checksum and payload, then reactivate the latest verified release.
8. Set the GitHub variable `POLICY_STORAGE_PUBLISH_ENABLED=1`. The daily job will upload releases instead of committing generated files.
9. Set `POLICY_STORAGE_CUTOVER=1` in CI and stop tracking migrated generated files without rewriting history.

## Controlled outage rehearsal record

Completed on 2026-08-01 UTC without interrupting production:

- warmed a checksum-verified dataset snapshot, simulated origin failure, and confirmed `stale-cache` delivery inside the maximum stale window;
- advanced the controlled clock beyond maximum stale and confirmed the dataset read fails closed;
- warmed report metadata and encrypted-artifact caches, simulated origin failure, and confirmed the verified report still decrypts inside the stale window;
- confirmed paid report reads fail closed both on a cold cache and after cache expiry, before fulfillment reservation can occur;
- reran the full suite (15/15) and the Phase 1 storage eval (11/11).

The exercise uses injected origin failures and a controlled clock so it is deterministic and does not revoke credentials, alter immutable objects, or interrupt production. A real outage is handled by the same `ResilientCache`, `DatasetService`, cached report repositories, and API error mappings exercised here.

## Rollback

Application rollback changes `STABLECOIN_POLICY_DATA_BACKEND` from `supabase` to `dual` or `file`. Data rollback moves only the active release pointer; it never overwrites or deletes an immutable object. The restore command is a dry-run unless `--apply` is explicitly supplied.
