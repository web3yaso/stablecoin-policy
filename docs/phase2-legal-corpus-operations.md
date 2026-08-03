# Phase 2 legal corpus operations

## Current checkpoint

Migrations `0003` through `0019` are applied to the linked Supabase project.
They are never applied by application startup. Migration `0003` creates two
ownership layers:

- `regulatory`: cross-domain official authorities, logical documents,
  immutable source versions, addressable provisions, and regulatory events;
- `policy`: Stablecoin-specific legal claims, citations, private review
  records, reproducible corpus releases, change impacts, and coverage scopes.

The executable workflow models live in `specs/legalCorpusPublication.qnt` and
`specs/regulatoryChangePublication.qnt`, with scenario tests and requirement
maps alongside them. Run `npm run spec:phase2` before changing migrations
`0010` through `0019` or any
successor that changes review states, fingerprints, freshness gates, atomicity,
or service-role grants. The command typechecks both models and tests, runs 20
scenarios, and samples nine invariants plus six lifecycle witnesses. It does
not use `quint verify`; a clean simulation reports that no counterexample was
found in the sampled traces, not that the database is formally proven correct.

The database counterparts are the files in `supabase/tests`. They start from
all local migrations, use sanitized rows inside transactions, and execute the
complete source-verification, draft-import, claim-review,
release-review/publication, coverage-review, and readiness-query RPC chains.
Their 152 pgTAP assertions also cover stale manifests,
automated-reviewer rejection, zero partial audit writes, service-role table
grants, reviewed-only public views, and the migration `0020` machine-assurance
lane (direct-write denial, stale-fingerprint fail-closed, ladder ordering,
BLOCKED records never advancing, and machine records never touching
`lifecycle_state`, `verified_at`, or claim review fields), plus the migration
`0021` provisional-release path (membership gates, jurisdiction and
AI_CROSS_CHECKED enforcement, deterministic manifests, PROVISIONAL_PUBLISHED
audit records, and proof that provisional publication leaves claim
review_state and reviewed corpus releases untouched). Run it with:

```bash
npm run db:phase2:start
npm run test:db:phase2
npm run db:phase2:stop
```

The GitHub quality workflow runs this in an isolated database job. The fixture
does not authorize a real source, claim, corpus release, or coverage scope.

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

Rights review never rewrites extraction-time provision rows. Migration `0009`
adds an immutable `regulatory.provision_rights_reviews` overlay for provisions
that were originally stored with `UNKNOWN` excerpt permission. The service-only
v5 ingestion RPC accepts only an `ALLOWED` or `LINK_ONLY` promotion backed by the
same dated review and rights basis; conflicts fail the complete transaction.
Status checks report the effective permission from the overlay while preserving
the original provision and its audit history. Storage permission, effective
excerpt permission, source authority, lifecycle verification, and public
publication remain independent gates.

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

## Source verification workflow

Source verification is a distinct named-human review after ingestion and rights
review. Migration `0010` adds private immutable
`regulatory.source_verification_records`, a deterministic service-only manifest,
and an atomic review RPC. The manifest fingerprints the immutable object and
version metadata plus every provision ID, locator, text checksum, ordinal, and
effective excerpt permission; it never returns provision text or reviewer data.

An approval fails closed unless the source is still `OBSERVED`, the freshly
computed manifest SHA-256 matches the reviewer's submitted SHA-256, commercial
storage rights are reviewed and `ALLOWED`, at least one provision exists, every
effective excerpt permission is known, and the review time follows retrieval.
The approval record and `OBSERVED` to `VERIFIED` transition occur in one database
transaction. Rejections create an immutable record but leave the version
`OBSERVED`. The review table is read-only to the service role; its only write
path is the fixed-search-path `SECURITY DEFINER` RPC.

Generate a read-only review manifest with:

```bash
npm run legal:sources:verify -- --source-version <version-id>
```

Add `--summary` for an operational status/fingerprint check that omits the full
provision metadata array.

After independently checking the official artifact and locators, submit the
exact displayed manifest fingerprint with `--submit`, `--confirm-human-review`,
an explicit outcome, verification method, reviewer role/reference, and review
time. `OFFICIAL_BYTE_AND_LOCATOR_REVIEW` is for an authoritative official copy;
`REFERENCE_COPY_CROSS_CHECK` requires comparison against the authoritative copy.
An AI agent, LLM, system, automation identity, or unknown reviewer cannot approve
a source. Running or deploying this workflow never verifies a source by itself.

## Legal claim review workflow

Migration `0011` separates drafting, review submission, and named-human legal
claim approval. A deterministic service-only manifest binds the proposition,
legal status, effective interval, knowledge cutoff, actor/activity scopes, and
every citation to its provision locator, text checksum, source-version checksum,
authority, support relation, excerpt, and effective excerpt permission.

Claims and citations are editable only in `DRAFT`. Submission requires at least
one citation and moves the claim to `IN_REVIEW`, freezing its reviewed content.
Approval then requires the freshly recomputed manifest SHA-256, an identified
human reviewer, no contradictory evidence, no unknown/unauthorized excerpt use,
and at least one direct official citation whose source version is `VERIFIED` by
an approved source-verification record. The review record and transition to
`REVIEWED` occur atomically. `CHANGES_REQUESTED` returns the claim to `DRAFT`;
`REJECTED` moves it to immutable `RETRACTED`.

The service role can read but cannot directly insert, update, or delete review
records; the fixed-search-path `SECURITY DEFINER` RPC is the only write path.
The corpus publication trigger independently recomputes the approved manifest
fingerprint and applies the same verified-evidence gates to every legal status,
not only permissions. No claim is created or approved by deploying the workflow.

The CLI defaults to a read-only manifest:

```bash
npm run legal:claims:review -- --claim <claim-id>
```

Use `--submit-for-review` only after draft citations are complete. Final review
submission additionally requires `--submit`, `--confirm-human-review`, the exact
manifest SHA-256, outcome, reviewer role/reference, and review time.

## Corpus release workflow

Migration `0012` makes corpus assembly and publication a separate reviewed
state machine: `DRAFT` membership is editable, `IN_REVIEW` freezes membership,
`REVIEWED` records a named-human approval, and only the exact approved manifest
may become `PUBLISHED`. Release rows are created and transitioned only through
fixed-search-path service RPCs; the service role cannot insert, update, or delete
them directly.

The deterministic release manifest binds `as_of`, `knowledge_cutoff`, sorted
claim membership, and each complete claim-review manifest and SHA-256. Approval
fails on empty membership, unreviewed claims, missing/stale claim approvals,
claims outside the release's half-open effective interval, or claim knowledge
newer than the release cutoff. Publication recomputes the release manifest,
requires an immutable matching release-review record, and reruns both release
and claim evidence gates. Deployment never creates or publishes a release.

The CLI is read-only by default:

```bash
npm run legal:corpus:release -- --release <release-id>
```

Creation, review submission, named-human review, and publication require
separate explicit flags. Coverage does not advance automatically when a release
is published; baseline completeness and freshness remain a separate reviewed
checkpoint.

## Coverage review workflow

Migration `0013` makes a versioned jurisdiction checklist, complete claim
support, source freshness, a published corpus release, and a named-human review
mandatory before coverage can become `REVIEWED`, `100%`, and `CURRENT`. A
checklist item names its supporting claim IDs; every supporting claim must be a
reviewed member of the selected published release for the same jurisdiction.
The reviewer supplies an explicit freshness cutoff, and every cited source
version for that jurisdiction must have been retrieved on or after it.

The deterministic manifest binds the checklist contents and checksum, public
coverage note, freshness cutoff, complete corpus-release manifest, and release
checksum. Review submits that exact fingerprint and records reviewer identity
and private notes separately. Migrations `0013` and `0014` make the service role
read-only on coverage rows: it cannot insert, update, or delete them or write
review records directly. Deploying the migration, publishing a corpus, or
creating a checklist never changes coverage by itself.

Create a versioned checklist only after its legal scope has been agreed and its
claim IDs are reviewed. The checklist JSON file must be an array of objects with
unique `itemId`, `title`, and non-empty `supportingClaimIds` fields:

```bash
npm run legal:coverage:review -- --create-checklist \
  --jurisdiction <code> --checklist <checklist-id> \
  --version-label <version> --items-file <absolute-json-path>
```

The normal command is read-only and reports all readiness failures:

```bash
npm run legal:coverage:review -- --jurisdiction <code> \
  --checklist <checklist-id> --release <release-id> \
  --freshness-cutoff <timestamp> --public-note <note>
```

Submitting review additionally requires `--submit`,
`--confirm-human-review`, the exact manifest SHA-256, a review ID, named
reviewer role/reference, and review time. The review time cannot precede the
freshness cutoff. No launch-jurisdiction checklist has yet been approved or
created, so EEA, Hong Kong, and Singapore remain `IN_PROGRESS`, `0%`, and
`UNKNOWN`.

## Publication sequence

1. Upload the raw official response or document as a new immutable Storage
   object and record its checksum.
2. Create or resolve the authority and logical document.
3. Insert a `SourceVersion` in `OBSERVED`, extract addressable provisions, then
   generate its deterministic verification manifest and complete a named-human
   source review before moving it to `VERIFIED`.
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
- Migration `0008` added document-rights reconciliation for `OBSERVED` versions.
  Its first MiCA replay attempted to change extraction-time provision permission
  from `UNKNOWN` to `ALLOWED`; the existing immutable-row trigger rejected the
  write and PostgreSQL rolled back the whole RPC transaction. That protection
  was retained rather than bypassed. The HKeL replay was idempotent because its
  four provisions were already `LINK_ONLY`.
- Before migration `0009`, a private metadata snapshot was written outside the
  repository to `/private/tmp/stablecoin-policy-pre0009-metadata.json`, mode
  `0600`, with SHA-256
  `a092da7aa453939391cb08715d1dc8f8ac5e770d49224fc3c6ca3438ca87796e`.
- Migration `0009` was applied on 2026-08-01 UTC after a linked-project dry-run.
  It adds the immutable provision-rights review overlay and switches ingestion
  to v5. MiCA replay retained the same `OBSERVED` version and now reports
  `storageRights=ALLOWED`, `redistributionRights=FULL_TEXT`, 149 effective
  `ALLOWED` provisions, zero unknown permissions, and `verifiedAt=null`. HKeL
  Cap. 656A retained the same `OBSERVED` version and reports
  `storageRights=ALLOWED`, `redistributionRights=LINK_ONLY`, four effective
  `LINK_ONLY` provisions, zero unknown permissions, and `verifiedAt=null`.
  Both Singapore versions remain `OBSERVED` with 148 and 47 effective
  `ALLOWED` provisions respectively. No claims or coverage were created.
  The post-`0009` metadata snapshot has SHA-256
  `5b317c570791ca89f84c908e827eddb8a80b621e72e295e37a0dd0a9a6ec3f6d`.
- Before migration `0010`, a private metadata snapshot was written outside the
  repository to `/private/tmp/stablecoin-policy-pre0010-metadata.json`, mode
  `0600`, with SHA-256
  `8f5925babf3607fb10016041ab799baaf8e42d8cedea8c0891d3227bd350329f`.
- Migration `0010` was applied on 2026-08-01 UTC after a linked-project dry-run.
  Read-only production manifests report all four source versions remain
  `OBSERVED` with `verifiedAt=null`. Their manifest SHA-256 fingerprints are
  `362b24ecc7785d1790955c3bac6ffc631df03eb09de170ee883ff0cda036169d`
  (MiCA),
  `602384c4fae8204c48eff40d0f4e149a2bb725dd53c2cca654d5ad8a472c35f1`
  (HKeL Cap. 656A),
  `84761e6fe3bd5dbafafdc8f6680950a46f57d5d8db74f7bdd54c181e5808c872`
  (Payment Services Act), and
  `5b3f88f643a6b1d43a6fc12d4efac61cd6c4f6a05076e944c2d43cb0c902d2d7`
  (Payment Services Regulations). A deliberately stale fingerprint was rejected
  by the production RPC and a second manifest check confirmed no state change.
  Database lint and the existing reviewed-only Phase 2 smoke passed. The
  post-`0010` metadata snapshot has SHA-256
  `baad49fb2039378e085879993756408c4b239da95f80e5829c2d6c274438ea7b`.
- Before migration `0011`, backup format `1.1.0` captured Phase 1 metadata,
  claim/citation/review/corpus/impact/coverage tables, and all four source status
  snapshots at `/private/tmp/stablecoin-policy-pre0011-metadata.json`, mode
  `0600`, with SHA-256
  `d78eb43d0e88a48c02998aa54f13dcfca79999dd512cbf33e76ad311622a71f0`.
  Claim, citation, review, corpus, and impact tables were empty; three coverage
  rows remained `IN_PROGRESS`.
- Migration `0011` was applied on 2026-08-01 UTC after a linked-project dry-run.
  Production database lint reports no schema errors. A negative-path smoke
  confirmed the service role cannot insert `review_records` directly and a
  missing claim cannot enter review. Existing Phase 2 smoke confirmed no public
  evidence or coverage change. The post-`0011` snapshot retained zero claim,
  citation, review, corpus, and impact rows and has SHA-256
  `371e1441fa17f44aa8403ddaa203c1b55114ef6f19a4dd1f8ee9e427c7bc555c`.
- Before migration `0012`, backup format `1.2.0` recorded the migration-pending
  release-review table as empty and captured all existing metadata and four
  source statuses at `/private/tmp/stablecoin-policy-pre0012-metadata.json`,
  mode `0600`, with SHA-256
  `6b73a02ece7cfbb81a5efb2aa268fb620bd5f2ffceb78dc462efd5529f7529d6`.
- Migration `0012` was applied on 2026-08-01 UTC after a linked-project dry-run.
  Database lint reports no schema errors. Negative-path smoke confirmed the
  service role cannot insert corpus releases directly and the create RPC rejects
  an invalid release ID without writing data. Phase 2 public-boundary smoke
  remains unchanged. The post-`0012` snapshot contains zero claim, review,
  corpus, membership, release-review, and impact rows and has SHA-256
  `72fcf9a9ab2662f0860e863d8c7d1b509828d617275e60eae293017494b40de9`.
- Before migration `0013`, backup format `1.3.0` recorded both migration-pending
  coverage workflow tables as empty and captured all existing metadata and four
  source statuses at `/private/tmp/stablecoin-policy-pre0013-metadata.json`,
  mode `0600`, with SHA-256
  `6d62e7e3632c51d1651891bdbb57a88d2071423544b8541ff6e40ae31ae17d45`.
- The first `0013` push was rejected while parsing the checklist function and
  its transaction made no changes. The validation was simplified, all local
  gates were rerun, and the corrected migration was then applied on 2026-08-01
  UTC. Negative-path smoke confirmed direct coverage updates are denied and an
  invalid checklist ID cannot write data. Public-boundary smoke and database
  lint pass. The post-`0013` snapshot contains zero claims, releases,
  checklists, or coverage-review records; all three coverage scopes remain
  `IN_PROGRESS`. Its SHA-256 is
  `272aa891d4fb34c7dc0714eb093dfcbe6bda4600fa319953bb2ec14f9307da8c`.
- Before migration `0014`, the metadata snapshot at
  `/private/tmp/stablecoin-policy-pre0014-metadata.json` had SHA-256
  `5d36670b514d953d5d7e74d6f2c81b213ec7143d1c5aa13edef56a2ebee483b9`.
  Migration `0014` closes the remaining Phase 2 foundation `INSERT` grant and
  makes coverage scopes fully read-only to the service role. Production smoke
  confirms direct `INSERT`, `UPDATE`, and `DELETE` are all denied, while the
  human-review RPC remains the sole advancement path. Database lint and the
  reviewed-only public boundary pass. The post-`0014` snapshot retained three
  `IN_PROGRESS` scopes and zero claims, releases, checklists, or coverage-review
  records; its SHA-256 is
  `9b315fbe12d9e26d326387328852da9c4b6b18edbea6bb4354c965ef18a29893`.
- Before migrations `0015` through `0019`, the linked dry-run listed exactly
  those five migrations. Private backup format `1.4.0` was written outside Git
  to `/private/tmp/stablecoin-policy-pre0015-0019-metadata.json`, mode `0600`,
  with SHA-256
  `c194a04cb87e6ecd2f0873938226961b478dd0d3f510285829d978ce7df71cb8`.
  It captured all four source statuses, 32 Storage objects, 4 reports, 6 report
  releases, 3 datasets, 22 dataset releases, three `IN_PROGRESS` coverage
  scopes, and zero claim, corpus, event, or impact rows.
- Migrations `0015` through `0019` were applied together on 2026-08-01 UTC.
  Migration history now matches local `0001` through `0019`, and linked
  database lint reports no schema errors. The sanitized claim-draft preflight
  correctly returned `provision_missing` without writing, while baseline
  readiness reported `SOURCE_REVIEW` for EEA, Hong Kong, and Singapore. The EEA
  review queue returned one `SOURCE_VERIFICATION` task and made no transition.
  Existing Phase 2 smoke retained the private source bucket, zero public
  evidence/changes, and all three `IN_PROGRESS`, `0%`, `UNKNOWN` scopes.
- The post-cutover snapshot at
  `/private/tmp/stablecoin-policy-post0019-metadata.json` has mode `0600` and
  SHA-256
  `2a4fb94db634d1a36f7d26451fc05a03e3ed46458afcaeb5a2d0877642bc1624`.
  Its normalized tables, four source statuses, and regulatory-change metadata
  are byte-identical to the pre-cutover snapshot. The Vercel production
  `/v1/coverage` and `/v1/changes` endpoints pass. (Resolved 2026-08-02: the
  former metadata canonical host `stablecoin.web3law.tech` was never attached
  to the Vercel project and returned `404` everywhere; the canonical site and
  API host is now `policy.citely.info`, and the web3law.tech subdomain is
  retired without any DNS change.)
- Pre- and post-migration database lint reported no schema errors.
- `npm run smoke:phase2` verified the private `policy-sources` bucket, EEA/HK/SG
  launch coverage rows, empty reviewed-only source/change views, and no false
  claim of baseline completion.

## Baseline claim draft import

Migration `0015` adds an atomic, idempotent importer for human-prepared claim
and citation drafts. It accepts schema version `1.0.0`, writes every claim as
`DRAFT`, records an immutable private batch fingerprint, and never submits,
reviews, publishes, or creates coverage. The CLI validates without writing by
default:

```bash
npm run legal:claims:draft -- --file <bundle.json>
npm run legal:claims:draft -- --file <bundle.json> --import
```

Only the second command writes. Existing source/provision identifiers must be
used; database constraints and the atomic RPC reject the whole batch on any
invalid citation, duplicate ID, forbidden review field, or batch-manifest
conflict. Imported drafts remain private until the independent claim, release,
and coverage review workflows complete.

## Jurisdiction baseline readiness

Migration `0016` adds a private, read-only workflow report for operators who
are preparing a jurisdiction baseline. It aggregates source-version,
verification, claim-review, corpus-release, checklist, and coverage counts into
one deterministic stage and ordered blocker list:

```bash
npm run legal:baseline:readiness -- --jurisdiction <code>
npm run legal:baseline:readiness -- --jurisdiction <code> --summary
```

The report is service-role only and contains no claim proposition or reviewer
data. It cannot write, submit, approve, publish, or advance coverage. The field
`legalCompletenessAssessed` is always `false`: `COMPLETE` means only that the
existing named-human publication workflow reached reviewed coverage, not that
the software independently determined legal completeness.

## Claim draft bundle preflight

Migration `0017` adds a private, read-only database preflight before draft
import. The three CLI modes now have distinct boundaries:

```bash
# JSON structure only; no database call
npm run legal:claims:draft -- --file <bundle.json>

# Database references and evidence gates; no writes
npm run legal:claims:draft -- --file <bundle.json> --preflight

# Preflight first, then atomic private-DRAFT import if importReady=true
npm run legal:claims:draft -- --file <bundle.json> --import
```

`importErrors` identify conditions that would make the database reject the
bundle, including ID conflicts, missing provisions, missing predecessor claims,
unauthorized excerpts, and changed reuse of an imported batch ID. Identical
batch-manifest replay remains idempotent. `reviewReadinessErrors` separately report
unverified sources, unknown permissions, contradictory evidence, and missing
direct official support. Evidence blockers do not prevent storing a private
draft, but remain mandatory before named-human approval. The envelope always
sets `legalValidityAssessed` to `false` and never writes review or publication
state.

## Human review queue

Migration `0018` adds a private, service-role-only projection of outstanding
source, claim, corpus-release, and coverage-preparation work. It derives every
task from canonical state and does not create task rows, review records, or
state transitions:

```bash
npm run legal:review:queue -- --jurisdiction <code>
npm run legal:review:queue -- --jurisdiction <code> --limit 25 --summary
```

Tasks are ordered by workflow priority and stable subject order. Each task
contains blocker codes, required inputs, the next human action, and a structured
CLI command. It deliberately excludes claim propositions, reviewer references,
and private notes. `humanReviewRequired=true` and
`automaticApprovalAllowed=false` are fixed contract fields; operators must use
the independent, fingerprint-bound review commands to make any transition.

## Regulatory event and claim-impact pipeline

Migration `0019` compares two immutable versions of the same official document
by provision locator, language, and checksum. Its manifest lists added,
modified, and removed provisions plus reviewed claims that cite the before
version. It contains no proposition or reviewer-private content and always sets
`legalImpactAssessed=false`.

```bash
# Read-only diff and candidate manifest
npm run legal:changes:review -- --before <version-id> --after <version-id> --summary

# Read-only event and impact review inventory
npm run legal:changes:review -- --event <event-id> --summary
```

An explicit `--create` can write only a `CANDIDATE` event and
`MAY_AFFECT / PENDING` suggestions. `--review-event` and `--review-impact` each
require `--confirm-human-review`, a named reviewer, and the exact current
manifest fingerprint. `--publish` fails while any impact is pending or no
reviewed impact exists. The service role has no direct event/impact write grant,
and the RPCs never update claims, citations, releases, or coverage.

The metadata backup format is `1.4.0`. Before migration `0019` it records empty
pending change-audit collections; after migration it exports private regulatory
event and event-review metadata through a service-only RPC, alongside impact
and impact-review tables. Keep this file outside Git with mode `0600`.

## Migration 0020-0022 production cutover (2026-08-02)

- Migrations `0020` (machine-assurance records/states), `0021` (provisional
  releases + extraction feed), and `0022` (provisional public views) were
  applied to the linked production project on 2026-08-02 after an exact
  dry-run listing and a verified private `1.5.0` metadata backup
  (SHA-256 `f1666d335402db37f8490ab75380289644ac9a243ee17d0acbf37e53f031905b`).
- Migration history matches `0001`-`0022` local/remote. Linked lint reports
  only one informational warning (`v_version` "never read" in
  `record_machine_assurance` - the SELECT ... FOR UPDATE exists for row
  locking and existence checking).
- Read-only production smoke: `public_provisional_claims` and
  `public_provisional_coverage` are empty, `get_machine_assurance_chain`
  returns an empty array for unknown subjects, direct service-role inserts
  into `machine_assurance_states` are denied (42501), and the reviewed-only
  `/v1/coverage` response is unchanged (EEA/HK/SG remain `IN_PROGRESS`, 0%).
- The post-cutover normalized snapshot is identical to the pre-cutover
  snapshot for every business table; the new machine-lane tables are empty.
  No claims, releases, or machine records exist in production yet.

## EEA provisional baseline run (2026-08-02)

- The committed checklist `data/legal-corpus/baselines/eea-mica-checklist.json`
  (12 topics for the Pre-listing and Business Model Boundary playbooks) was
  fixed before extraction.
- Extraction: `gpt-5.6-terra` over all 149 MiCA provisions produced 37 claim
  drafts; every citation locator matched an official provision exactly and
  the deterministic checks blocked none. Claim IDs are assigned
  deterministically by the CLI; model-provided identifiers are ignored.
- Import: preflight manifest
  `dce5a243213756546315ae80c9ad658d622b5e9e77a42667b29fb39e2d469e42`,
  37 claims imported as private DRAFT rows.
- Cross-check: `gpt-5.6-luna` independently re-derived the claims (the
  `resolveModel` fix guarantees the requested model is actually called);
  37/37 advanced to AI_CROSS_CHECKED with zero blockers. The independent
  derivations are cached beside the bundle for replay.
- Release: `provisional:eea:mica:2026-08-02`, 37 claims, manifest
  `fd5c1a2636de676221a44f3be37f75d6a2f4c84bc89ef9cfc17be53a3d5644f7`,
  published 2026-08-02T20:00:06Z. Production `/v1/provisional/coverage`
  reports EEA with 37 provisional claims; `/v1/claims/{id}` serves the full
  assurance envelope. Reviewed coverage remains `IN_PROGRESS`, `0%`.
- Checklist coverage completed 2026-08-03: a focused follow-up extraction
  (`--focus` on significance criteria) produced 12 candidate claims for
  `significant-token-thresholds` (Articles 43-45, 56-58, 117). The
  independent cross-check BLOCKED two voluntary-classification claims on
  CROSS_CHECK_CITATION_DIVERGENCE (the two models cited different article
  sets); the 10 agreed claims were published as
  `provisional:eea:mica:2026-08-03-significance` (manifest `c458c66a...`).
  Migration `0023` makes provisional coverage aggregate distinct claims
  across releases: production reports EEA 47 claims, 12/12 checklist topics.
  Provisional coverage still never claims reviewed completeness.
- Measured model cost for the full run including two failed intermediate
  attempts: about USD 1.44 (extraction 2x $0.40, cross-check $0.42 + $0.17
  failed, $0.05 final cached run).

## Required pre-production checks

- Take and verify a Supabase backup before applying the migration.
- When a managed backup or local Docker-backed `db dump` is unavailable, run
  `npm run storage:backup-metadata`; keep its private JSON output and SHA-256
  checksum outside the repository. This supplements, but does not replace,
  immutable Storage objects and their existing restore procedure. Format `1.4.0`
  includes claim, citation, review, corpus-membership, impact, and coverage rows
  plus coverage checklists, coverage-review records, event/impact reviews, and
  private regulatory event audit metadata, in addition to Phase 1
  metadata and explicitly requested source statuses. A
  migration-pending table on the explicit optional allowlist is exported as an
  empty array before creation; every other table or transport error fails closed.
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
