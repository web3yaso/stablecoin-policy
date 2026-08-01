# Phase 2 legal corpus operations

## Current checkpoint

Migration `supabase/migrations/0003_phase2_legal_corpus_foundation.sql` was
applied to the linked Supabase project on 2026-07-31. It is never applied by
application startup and creates two ownership layers:

- `regulatory`: cross-domain official authorities, logical documents,
  immutable source versions, addressable provisions, and regulatory events;
- `policy`: Stablecoin-specific legal claims, citations, private review
  records, reproducible corpus releases, change impacts, and coverage scopes.

The initial coverage rows are EEA, Hong Kong, and Singapore. They intentionally
start as `IN_PROGRESS`, `0%`, and `UNKNOWN`; existing jurisdiction summaries do
not count as reviewed baseline claims.

## Publication sequence

1. Upload the raw official response or document as a new immutable Storage
   object and record its checksum.
2. Create or resolve the authority and logical document.
3. Insert a `SourceVersion` in `OBSERVED`, extract addressable provisions, then
   verify the source version.
4. Create a draft domain claim and its exact provision citations.
5. Record the human review result. Reviewer references and notes stay private.
6. Move the approved claim to `REVIEWED`.
7. Assemble a draft corpus release, compute its manifest checksum, and attach
   reviewed claims.
8. Publish the release. Database triggers reject missing approvals, missing or
   contradictory evidence, and permissions without direct verified official
   support.
9. Update coverage only after the agreed baseline checklist is complete and
   freshness has been verified.

Published corpus membership and reviewed claim content are immutable. A legal
or editorial correction creates a new source version or superseding claim and
a new corpus release so historical `as_of` results remain reproducible.

## Public API boundary

- `GET /v1/coverage` reports explicit readiness, completeness, freshness, and
  the pinned corpus release.
- `GET /v1/sources/{id}` returns only evidence present in the latest published
  corpus and exposes no reviewer data.
- `GET /v1/changes?after_cursor=` returns reviewed changes affecting published
  claims through an opaque cursor.

Before migration `0003` is available in an environment, these routes fail
closed with `503` rather than falling back to legacy editorial summaries. The
existing tracker and report endpoints are unaffected.

## Production migration record

- Supabase project ref: `dijbsnshvumfgyagpadh`.
- The pre-existing `0001` and `0002` schemas were verified against live Phase 1
  row counts and registered in migration history without rerunning them.
- Dry-run showed only `0003` pending before deployment.
- The managed project reported WAL backup support but no available PITR
  timestamp. A private Phase 1 metadata export was written outside the repo at
  `/private/tmp/stablecoin-policy-pre-phase2-metadata.json` with SHA-256
  `8c59bdee123b4b75c68cb8d104fe3abb910b24d7a1317bdc3b4f7cf371212017`.
- `0003` completed as one transaction; migration history now matches local
  versions `0001`, `0002`, and `0003`.
- Pre- and post-migration database lint reported no schema errors.
- `npm run smoke:phase2` verified the private `policy-sources` bucket, EEA/HK/SG
  launch coverage rows, empty reviewed-only source/change views, and no false
  claim of baseline completion.

## Required pre-production checks

- Take and verify a Supabase backup before applying the migration.
- When a managed backup or local Docker-backed `db dump` is unavailable, run
  `npm run storage:backup-metadata`; keep its private JSON output and SHA-256
  checksum outside the repository. This supplements, but does not replace,
  immutable Storage objects and their existing restore procedure.
- Confirm migration `0003` created the private `policy-sources` Storage bucket.
  If `SUPABASE_SOURCES_BUCKET` overrides that default, create the configured
  private bucket separately before ingestion.
- Apply `0003` in a preview or staging environment first and inspect all RLS
  and view behavior using the service role and an anonymous client.
- Confirm `regulatory` and `policy` are exposed only as required by the
  server-side API; do not grant direct public table access.
- Run `npm run typecheck`, `npm run lint`, `npm test`, all phase evals, and
  `npm run build`.
- Load only source fixtures first. Baseline claims require a named human legal
  reviewer and an approved review record before corpus publication.

## Rollback

Application rollback removes or disables the Phase 2 routes; it does not delete
evidence. Database rollback should prefer leaving append-only tables in place
and retracting an erroneous corpus release. Do not drop the shared schema or
delete source versions during an incident because that would break audit and
historical replay.
