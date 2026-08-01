# Phase 2 legal corpus operations

## Current checkpoint

Migrations `0003` through `0005` are applied to the linked Supabase project.
They are never applied by application startup. Migration `0003` creates two
ownership layers:

- `regulatory`: cross-domain official authorities, logical documents,
  immutable source versions, addressable provisions, and regulatory events;
- `policy`: Stablecoin-specific legal claims, citations, private review
  records, reproducible corpus releases, change impacts, and coverage scopes.

The initial coverage rows are EEA, Hong Kong, and Singapore. They intentionally
start as `IN_PROGRESS`, `0%`, and `UNKNOWN`; existing jurisdiction summaries do
not count as reviewed baseline claims.

## Official-source ingestion

The checked-in registry is `data/legal-corpus/source-registry.json`. The first
adapter covers the English Official Journal version of MiCA through its exact
EUR-Lex/CELLAR XHTML manifestation. The manifestation is byte-stable across
repeated fetches, unlike the dynamically rendered `legal-content` page. Run
`npm run legal:sources:ingest` for a read-only fetch and parse: it prints the
source checksum, article count, and immutable object key without writing data.
Only an explicit `--publish` uploads the raw response and calls the service-role
only `policy.ingest_official_source` RPC introduced by migration `0004`.

The RPC registers the source version as `OBSERVED` and inserts provision
candidates with `UNKNOWN` excerpt permission. It cannot create claims,
citations, reviews, corpus releases, or playbook data. Verification and legal
interpretation remain separate human-review steps. A repeated identical body is
idempotent; changed bytes produce a new checksum-derived version and object key.
Because the shared `regulatory` schema is not exposed through PostgREST, the
service-role-only `policy.get_official_source_ingestion_status` RPC from `0005`
provides count and lifecycle health checks without returning provision text.

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
- `0004` and `0005` were applied on 2026-08-01 UTC after linked-project
  dry-runs. They add service-only ingestion and health-check RPCs.
- The MiCA CELLAR manifestation was ingested with SHA-256
  `c694819af2efbd715735cacf4bb65eade4685f88b30787197658122ff04c26fb`.
  Remote verification reports one `OBSERVED` version, no verification time,
  and 149 provisions with ordinals 0 through 148. A repeated publish was
  idempotent.
- Public source lookup still returns `404` for MiCA and EEA coverage remains
  `IN_PROGRESS`, `0%`, and `UNKNOWN`, as required before source and claim review.
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
