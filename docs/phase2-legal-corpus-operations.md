# Phase 2 legal corpus operations

## Current checkpoint

Migrations `0003` through `0007` are applied to the linked Supabase project.
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

The Hong Kong adapter reads the Department of Justice weekly HKeL archive and
pins both the container checksum and the exact XML archive entry. Migration
`0006` records this retrieval provenance without exposing it publicly. HKeL
states that HTML and structured reference copies are informational; verified
PDF copies are required for legal-status verification. Consequently HKeL XML
provisions remain `LINK_ONLY` candidates and source versions remain `OBSERVED`.

Cap. 656 is explicitly blocked in the registry because the official archive
entry named for Cap. 656 currently embeds `/hk/cap155!en` and `docNumber 155`.
The adapter fails closed on this identity mismatch. Cap. 656A has internally
consistent identifiers and may be ingested independently, but it does not make
the Hong Kong baseline complete.

The Singapore adapter pins an explicit SSO `ValidDate`, obtains the supported
complete HTML print export for structure, and stores the separately downloaded,
byte-stable official PDF as the immutable source artifact. The registry pins
that PDF's expected SHA-256 and any byte change fails closed for manual review.
It records a deterministic checksum over the extracted provision set instead of
treating the print page's changing CSRF token, timestamp, or CSP nonce as a legal
change. Registry entries also declare the official provision kind so Acts use
`Section` locators while subsidiary legislation can use `Regulation` or
`Paragraph` locators. Subsidiary-legislation entries fail closed when that kind
is missing. The adapter fails closed on title, document-number, valid-date, host,
content-type, PDF-signature, duplicate-provision, and provision-count mismatches.

The registered Singapore source set currently contains the Payment Services Act
2019 and the Payment Services Regulations 2019. The Regulations are pinned to
the 2025 Revised Edition dated 17 December 2025. A read-only dry-run verified the
PDF SHA-256
`1757d0a6755d05714007c8a709b7d51a32227ce201edfe9122839c514e671951`
across two downloads and extracted 47 regulations, including regulations 18A
through 18J. This does not make their contents reviewed or publishable.

SSO is maintained by Singapore's Attorney-General's Chambers, but its Terms of
Use describe the consolidated legislation as an unofficial version that is not
the authoritative text. Clause 13 permits reproduction of Singapore legislation
subject to conditions. Registry entries therefore record the permission and the
source-version provenance records `OFFICIAL_UNOFFICIAL_CONSOLIDATION`; ingestion
still stops at `OBSERVED`. Any later public full-text rendering must display the
Singapore Government copyright/AGC permission notice, link users to SSO for the
latest version, and pass an accuracy review before publication.

## Commercial storage-rights gate

Commercial internal storage and public redistribution are separate rights.
`redistributionRights` controls later excerpt and public rendering behavior;
`storageRights` controls whether the source bytes may enter Citely's private
commercial object storage at all. `REVIEW_REQUIRED` and `PROHIBITED` block
publication before any Storage request. `ALLOWED` also requires a dated review
and a recorded licence, permission, or other reviewed basis. Migration `0007`
repeats this validation in the service-only ingestion RPC and records the review
on the immutable source version.

The Payment Services Act and Payment Services Regulations SSO entries are
`ALLOWED` under the recorded clause 13 conditions. The EUR-Lex MiCA artifact is
`ALLOWED` under the EUR-Lex Legal Notice and Commission Decision 2011/833/EU,
which permit legal-document reuse for commercial and non-commercial purposes
subject to the recorded conditions. HKeL dataset artifacts are `ALLOWED` under
DATA.GOV.HK Terms and Conditions v1.2, which permit commercial download and
reproduction with source and ownership attribution. HKeL provision excerpts
remain `LINK_ONLY` because storage permission does not change the structured
copy's reference-only legal status.

MAS's 15 August 2023 response on the finalised stablecoin framework is an
important official policy source, but the current MAS Terms of Use allow one
personal non-commercial download and otherwise require prior written permission
for reproduction or distribution. The response is therefore not mirrored,
parsed into stored provisions, or added to the registry as ingestible evidence.
Obtain and record permission, or use a separately licensed official channel,
before implementing a MAS PDF adapter.

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
- `0006` was applied on 2026-08-01 UTC after a linked-project dry-run. Cap.
  656A was ingested as `OBSERVED` with extracted XML SHA-256
  `35f7df127b58c173f678f4052d627a1dc088cf65feb64ac5a6ff136a89b6d952`
  and four provisions at ordinals 0 through 3. Idempotent replay passed.
- Cap. 656 remains blocked and absent from the corpus due to the embedded
  identity mismatch. Public lookup for Cap. 656A returns `404`, and Hong Kong
  coverage remains `IN_PROGRESS`, `0%`, and `UNKNOWN`.
- The SSO Payment Services Act 2019 PDF pinned to `ValidDate=20250309` was
  ingested as `OBSERVED` with SHA-256
  `6644db515eb0e28046f9726b6244907e8817e6eb05592ada2d12249326c2d9b7`
  and 148 provisions at ordinals 0 through 147. Idempotent replay returned the
  same version ID. The status RPC reports no verification time; Singapore
  coverage remains `IN_PROGRESS` with zero reviewed claims, and no published
  changes or source evidence were exposed.
- The SSO Payment Services Regulations 2019 PDF pinned to
  `ValidDate=20251217` was ingested as `OBSERVED` with SHA-256
  `1757d0a6755d05714007c8a709b7d51a32227ce201edfe9122839c514e671951`
  and 47 regulations at ordinals 0 through 46. Idempotent replay returned the
  same version ID. The status RPC reports no verification time, the actual
  document ID is absent from reviewed-only public source lookup, and Singapore
  coverage and published-change results remain unchanged.
- Before migration `0007`, a full regulatory `db dump` was attempted but was
  unavailable because the local Supabase CLI requires Docker. The documented
  metadata fallback was written outside the repository to
  `/private/tmp/stablecoin-policy-pre0007-metadata.json` with mode `0600` and
  SHA-256
  `5c70ed95357b6e82fd3caa618690ce4671cee2c40a64d1ec8947ce8222196b05`.
  It contains the Phase 1 metadata tables plus status snapshots for all four
  ingested official source versions; it is not represented as a full backup.
- Migration `0007` was applied on 2026-08-01 UTC after a linked-project dry-run.
  Production database lint reports no schema errors. EUR-Lex MiCA and HKeL Cap.
  656A now report `storageRights=REVIEW_REQUIRED` and reject publish commands
  before retrieval or Storage access. The two SSO versions report
  `storageRights=ALLOWED`, the recorded 2026-08-01 review time, and retained
  their existing version IDs and provision counts after v3 idempotent replay.
  The post-migration metadata snapshot has SHA-256
  `2811af69b0b185b36cdde06f55d5bf5bf821521a0084ffb62644c64a16737ea0`.
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
