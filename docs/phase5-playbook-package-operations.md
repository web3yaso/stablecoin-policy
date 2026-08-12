# Phase 5 PlaybookPackage persistence operations

## Current checkpoint

PR #52 (`2cc9ce5`) integrated Evidence RAG after deterministic evaluation.
Branch `codex/phase5-playbook-package-persistence` adds the next Phase 5
boundary: a package is returned only after the complete presentation-safe
response is stored as a checksum-pinned private artifact and its queryable
metadata is committed atomically.

Migration `0030` is development-only until its PR is merged and the linked
Supabase rollout is explicitly performed. Merging code does not apply the
migration or deploy Vercel.

## Storage boundary

- private Supabase Storage bucket: `policy-playbooks`;
- object key: `packages/{playbookId}/{integritySha256}.json`;
- object body: canonical JSON `{ package, evidenceBundle }` only;
- PostgreSQL: package ID, playbook ID, profile fingerprint, version pins,
  assurance, evaluated time, object reference, byte size, and checksums;
- never stored in package metadata: raw Business Profile, raw Idempotency-Key,
  raw decision rules, prompts, chain of thought, search text, or embeddings.

The bucket name is intentionally fixed in both migration and runtime so the
registration RPC can reject cross-bucket metadata. No new Vercel environment
variable is required.

## Idempotent creation

`POST /v1/playbook-packages` requires `Idempotency-Key`:

1. the runtime hashes the normalized request separately from the raw key;
2. a service-only RPC atomically claims a two-minute execution lease;
3. an active identical lease returns `409` plus `Retry-After`, so no second
   decision or retrieval run starts;
4. a completed identical key returns the original artifact with `200` and
   `Idempotency-Replayed: true`;
5. the same key with a different request fingerprint returns `409`;
6. first completion uploads the immutable object, then one RPC records object
   metadata, package metadata, and idempotency completion.

The registration RPC independently binds the Supabase provider, private
bucket, canonical object key, `packageId`, and integrity hash. A modified
caller therefore cannot register arbitrary object metadata or detach a package
identity from its sealed bytes.

An expired lease may be reclaimed after a crashed invocation. A Storage or
metadata failure returns `503`; the API never returns an unpersisted package.

## Replay

Authenticated `GET /v1/playbook-packages/{id}` resolves private metadata,
downloads the object, verifies checksum, byte size, content type, package ID,
profile fingerprint, and package integrity, then returns the exact artifact.
Unknown IDs return `404`; missing, changed, or malformed artifacts fail closed
as `503`. All paid responses use `Cache-Control: no-store`.

## Rollout

1. Merge only after unit, contract, Quint, build, and isolated pgTAP pass. The
   development checkpoint passes 192 Node tests, all 238 repository pgTAP
   assertions (including 27 package-persistence assertions), and all 11
   Playbook Quint scenarios plus five invariants.
2. Take a private metadata backup and record its checksum.
3. Dry-run migration `0030`, then apply it to the linked project.
4. Confirm `policy-playbooks` exists and is private; confirm service role has
   SELECT/EXECUTE only and cannot directly INSERT/UPDATE package tables.
5. Deploy Vercel. No new environment variable is required with the default
   bucket.
6. Smoke one authenticated POST with a fresh key (`201`), exact retry (`200`),
   changed-request conflict (`409`), and authenticated GET (`200`). Confirm the
   POST and GET bodies are byte-equivalent after canonical JSON serialization.
7. Confirm no raw profile or raw idempotency key appears in PostgreSQL metadata,
   logs, or the object path.

## Rollback

Before production package rows exist, migration rollback may remove the new
tables/functions/bucket through the normal reviewed migration procedure. After
the first package exists, do not delete artifacts to roll back application
code. Restore the prior deployment, retain immutable objects and metadata, and
disable package creation until the reader/writer contract is restored.
