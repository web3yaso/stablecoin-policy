# Stablecoin Policy — Master Development Plan

Status: active execution plan  
Product: Stablecoin Policy public subsite and Citely stablecoin domain backend  
Last updated: 2026-08-08
Canonical product spec: `docs/superpowers/specs/2026-07-31-stablecoin-policy-domain-api-development-spec.md`

## 1. Purpose

This document turns the formal product specification into an execution plan
that another coding agent can resume without reconstructing project history.
It records the current production baseline, remaining phases, dependencies,
quality gates, rollout rules, and the bootstrap decision that initial operation
will not depend on a human review team.

The formal spec remains the canonical product and data-model definition. This
master plan is the canonical execution order. When the plan records an accepted
decision that conflicts with older text in the formal spec, the implementing PR
must first update the formal spec and executable Quint model where applicable.

## 2. Product outcome

Stablecoin Policy will provide three connected product layers:

1. a public, official-source-backed stablecoin policy subsite;
2. a versioned regulatory-data and evidence API for humans and agents;
3. a private stablecoin Playbook Runtime that Citely calls to obtain a
   presentation-safe `PlaybookPackage` and `EvidenceBundle`.

Citely remains thin. It owns authentication, billing, entitlements, domain
routing, and generic rendering. Stablecoin Policy owns stablecoin-specific
source ingestion, claims, assurance levels, dossiers, deterministic rules,
actions, evidence assembly, package generation, and change impact.

The public subsite never exposes raw `DecisionRule` definitions,
`PlaybookAction` generation logic, customer facts, private reviewer records, or
paid package bodies.

## 3. Scope

### In scope

- official source ingestion, provenance, versions, provisions, and rights;
- public jurisdiction, source, coverage, update, and change APIs;
- provisional machine-assisted and optional human-reviewed assurance lanes;
- Evidence RAG with pinned index releases and citations;
- stablecoin, issuer, authorization, and deployment dossiers;
- eight versioned stablecoin playbooks;
- deterministic decisions, reason codes, actions, evidence, and artifacts;
- authenticated Citely package APIs;
- regulatory change monitoring and package impact;
- tests, evals, Quint models, CI, production cutovers, rollback, and operations;
- extraction of unrelated legacy AI, politician, donor, energy, and data-center
  modules after stablecoin product parity is established.

### Out of scope

- Citely main-site UI, identity, billing, or subscription implementation;
- AI Policy and future Web3 Policy implementation in this repository;
- replacing local legal counsel or presenting the service as legal advice;
- KYC, KYT, sanctions screening, Travel Rule messaging, custody, accounting,
  reserve verification, or market-data execution products;
- storing production corpora or frequently changing generated data in Git;
- exposing private decision graphs or customer-specific outputs publicly.

## 4. Architecture and dependency order

```mermaid
flowchart LR
    S["Official Sources"] --> C["Versioned Corpus"]
    C --> A["Assurance and Claims"]
    A --> F["Public Policy Feed and APIs"]
    A --> R["Evidence RAG"]
    I["Issuer and Asset Dossiers"] --> D["Deterministic Decision Engine"]
    A --> D
    R --> W["Playbook Runtime"]
    D --> W
    W --> P["PlaybookPackage and EvidenceBundle"]
    P --> M["Watchlist and Change Impact"]
    P --> X["Citely Thin Client"]
```

Dependency rules:

- immutable source identity and rights precede claims;
- claims and assurance metadata precede retrieval indexing;
- legal corpus and asset dossiers precede deterministic playbook decisions;
- deterministic decisions precede narrative explanation;
- packages pin corpus, index, rules, templates, and dossier versions;
- monitoring reopens or invalidates affected packages; it never silently
  rewrites historical packages;
- public policy feed delivery is independent of paid playbook readiness and can
  ship earlier.

## 5. Current production baseline

### Phase 0 — complete

- provider-neutral report metadata and immutable-object interfaces;
- file-backed compatibility adapters;
- initial PostgreSQL schema and RLS;
- JSON Schema, unit-test, typecheck, and security-eval foundations;
- existing report, x402, and Alipay behavior preserved.

### Phase 1 — complete and deployed

- Supabase PostgreSQL and Storage adapters;
- immutable report and dataset releases with checksums;
- backfill, dual-read, strict parity, cutover, restore, and rollback;
- cached loaders with bounded stale behavior;
- production workflows publish to Storage instead of growing Git;
- private report and dataset buckets;
- production Vercel runtime reads from Supabase;
- warm-stale, cold-start, stale-expiry, checksum, encryption, and paid fail-closed
  rehearsals passed.

### Phase 2 technical infrastructure — complete through migration `0019`

- shared `regulatory` schema and Stablecoin-specific `policy` schema;
- immutable source documents, versions, provisions, and retrieval provenance;
- commercial storage-rights and excerpt-rights gates;
- source verification, claim review, corpus release, and coverage workflows;
- claim-draft import, preflight, baseline readiness, and review queue;
- deterministic Regulatory Event and Change Impact candidate pipeline;
- reviewed-only public `/v1/coverage`, `/v1/sources/{id}`, and `/v1/changes`;
- migrations `0001` through `0019` applied to production;
- database lint, production smoke, metadata backup, pgTAP, eval, and Quint gates
  passed at the 2026-08-01 checkpoint.

### Current production data state

- four source versions are stored and remain `OBSERVED`;
- MiCA contains 149 provisions;
- Hong Kong Cap. 656A contains four reference-only provisions;
- Singapore Payment Services Act contains 148 sections;
- Singapore Payment Services Regulations contain 47 regulations;
- Hong Kong core Cap. 656 remains blocked by an official archive identity
  mismatch and cannot support a complete Hong Kong baseline;
- no production claims, citations, corpus releases, regulatory events, or
  impacts are published;
- EEA, Hong Kong, and Singapore remain `IN_PROGRESS`, `0%`, and `UNKNOWN`;
- the Vercel production `/v1/coverage` and `/v1/changes` routes work;
- the separately configured canonical hostname still returns `404` for `/v1/*`
  and needs a domain-mapping review.

### Current repository quality baseline

At the last completed checkpoint:

- 85 unit tests passed;
- Phase 0 evals passed 4/4;
- Phase 1 evals passed 11/11;
- Phase 2 evals passed 77/77;
- pgTAP passed 120/120;
- Quint covered 20 scenarios, nine invariants, and six witnesses;
- lint, typecheck, build, and repository data checks passed.

Treat these counts as a regression floor, not a permanent target. New behavior
must add tests and may increase the totals.

## 6. Accepted bootstrap assurance policy

Initial launch will not depend on assembling a human legal-review team. Human
review remains available as a higher-assurance path, but it is not the only way
to publish useful policy research or operate the first playbook experience.

The intended assurance ladder is:

| Assurance level | Meaning | Bootstrap availability |
|---|---|---:|
| `SOURCE_OBSERVED` | immutable official material acquired | yes |
| `SOURCE_VALIDATED` | identity, version, checksum, locator, and rights checks pass | yes |
| `AI_EXTRACTED` | machine-generated structured claim with citations | yes, labeled |
| `AI_CROSS_CHECKED` | independently checked by models and deterministic validation | yes, provisional |
| `HUMAN_REVIEWED` | qualified person approved the exact version | later/optional |

These names are the accepted product language but are not authorization to
silently reuse existing database states. Before implementation, model and
approve the exact state-machine delta. Existing `VERIFIED` and reviewed release
semantics must retain their named-human meaning unless the formal spec and
Quint model explicitly create separate machine-assurance states.

Bootstrap outputs must include:

- `assuranceLevel`;
- `reviewStatus`;
- confidence and blocking reasons;
- `asOf`, knowledge cutoff, and source versions;
- exact citations and canonical official URLs;
- limitations and explicit counsel triggers.

Machine-assisted output may provide findings, evidence, uncertainty, and next
actions. It must not represent an unreviewed result as a definitive legal
permission, guarantee compliance, or hide contradictory, stale, or missing
evidence. Ambiguous or unsupported branches return a typed provisional,
undetermined, or counsel-review state.

Reviewer Registry and scoped reviewer authorization are deliberately deferred.
The future plan is recorded in GitHub Issue
`web3yaso/stablecoin-policy#35` and begins only when an external reviewer,
enterprise credential requirement, or `HUMAN_REVIEWED` commercial tier exists.

## 7. Delivery roadmap

## Phase 2A — legal-corpus infrastructure

Status: complete and deployed.

No further feature work belongs in Phase 2A. Only production defects,
security fixes, or migration corrections should modify migrations `0003`
through `0019`; forward changes use new migrations.

Exit evidence:

- production migration history matches `0001`–`0019`;
- public/private permission boundaries pass;
- transaction rollback and stale-fingerprint behavior pass;
- production business data was unchanged by the final cutover.

## Phase 2B — provisional assurance and launch-market baseline

Status: next core milestone.

Goal: make high-quality, explicitly provisional regulatory intelligence usable
without weakening or impersonating the existing human-reviewed lane.

### Specification first

- update the formal spec to replace human review as a universal bootstrap gate;
- use the Quint modeling skill to define machine-assurance states, permitted
  transitions, publication visibility, and fail-closed behavior;
- preserve the human-reviewed path as an independent assurance upgrade;
- define which public and paid outputs may consume each assurance level;
- define the boundary between provisional findings and definitive permission;
- add invariants preventing machine evidence from being labeled
  `HUMAN_REVIEWED` or satisfying human-only gates;
- obtain explicit approval for the spec delta before database or API code.

### Data and workflow delivery

- add forward-only migrations for machine-validation audit records and
  assurance snapshots;
- record deterministic source-identity, checksum, locator, rights, freshness,
  and version checks;
- import AI-extracted claim candidates as private drafts with exact citations;
- run an independent cross-check pass for entailment, contradiction, effective
  dates, jurisdiction, and source-version correctness;
- store model, prompt/template, parameters, input fingerprints, output
  fingerprints, confidence, and failure reasons for reproducibility;
- publish provisional claims only through an explicit atomic path;
- keep provisional and human-reviewed corpus releases distinguishable;
- expose assurance and limitations in every public or paid response;
- prevent provisional publication from advancing reviewed coverage or
  overwriting historical reviewed releases.

### Launch-market baseline

- build EEA MiCA baseline claim bundles from the stored provisions;
- build Singapore Payment Services Act and Regulations baseline bundles;
- keep Hong Kong incomplete until the official Cap. 656 identity issue is
  resolved or an independently authoritative source is approved;
- define a versioned checklist per jurisdiction, even when the initial output
  is provisional;
- record explicit missing-topic and missing-source blockers;
- publish coverage as provisional or incomplete rather than reporting false
  `100%` reviewed completeness;
- ensure every claim can be reproduced from its source version and `asOf` date.

### Phase 2B evals

- source identity and version fixtures;
- claim entailment and contradiction fixtures;
- effective-date and jurisdiction fixtures;
- independent-model disagreement cases;
- stale, missing, rights-blocked, and superseded source cases;
- prompt-injection and malicious source-text cases;
- assurance-label and public-boundary privacy cases;
- replay determinism and fingerprint-change cases;
- machine-to-human escalation cases;
- proof that provisional evidence cannot satisfy human-reviewed invariants.

### Phase 2B exit

- EEA and Singapore have reproducible provisional baselines with explicit
  completeness and limitations;
- Hong Kong accurately reports its unresolved source blocker;
- machine evidence is never mislabeled as human reviewed;
- provisional public/API output is versioned, cited, and schema validated;
- all Quint, unit, pgTAP, eval, lint, typecheck, build, and smoke gates pass;
- production rollback requires only pointer/view or forward migration changes,
  not destructive data removal.

## Phase 2C — Citely public integration and API operations

Status: policy-feed plan written; implementation pending.

### Simple policy feed

Implement the separate plan:

- `docs/superpowers/plans/2026-08-01-citely-policy-feed.md`

The feed is a thin projection of the existing active `news-summaries` release
and must provide `schemaVersion`, immutable release `generatedAt`, and flat
items containing `date`, `jurisdiction`, `summary`, `sourceUrl`, and optional
subsite-owned `playbookId`.

### API operational work

- add the policy feed to OpenAPI and contract CI;
- fix or deliberately replace the canonical-domain mapping that currently
  returns `404` for `/v1/*`;
- publish a domain API base URL that Citely can configure once per subsite;
- standardize CORS, caching, ETag, stale headers, problem responses, request
  IDs, and schema-version headers across public APIs;
- add uptime and generated-time freshness monitoring;
- alert when ingestion or feed generation exceeds its stale threshold;
- document main-site last-known-good fallback behavior.

### Phase 2C exit

- Citely can consume one stable versioned policy feed without subsite-specific
  transformation logic;
- a deliberately stale fixture visibly retains its old `generatedAt`;
- a schema mismatch is rejected as a whole;
- production domain, Vercel route, OpenAPI, and contract all agree;
- no new ingestion or duplicated production dataset was introduced.

## Phase 3 — Evidence RAG

Status: foundation merged as PR #48 (`433ca8a`), activation gates as PR #50
(`ca5a21f`), and production eval assembly as PR #51 (`4ab895d`).
Playbook EvidenceBundle integration is in development on
`codex/phase3-playbook-evidence-bundle` (2026-08-11).
The executable index/retrieval model, strict API contracts, provider-neutral
hybrid retrieval core, authenticated endpoint, pgvector-backed storage and
atomic index lifecycle migrations `0024`-`0025`, retrieval audit, sanitized
eval harness, and database tests are implemented locally. Migration `0026`
adds the default-dry-run EEA builder: service-only corpus input, deterministic
provision-aligned chunks, one-transaction/idempotent DRAFT import, immutable
chunk reuse, exact server-manifest inspection, and separately confirmed
activation. Migrations `0024`-`0026` are applied to the linked Supabase project.
The pre-build hotfix `0027` preserves an explicit provisional cutoff gap while
keeping human-reviewed time ordering strict and freshness bounded by both
timestamps. The activation-gates follow-up adds migration `0028`, an immutable
aggregate `RetrievalCorpusSnapshot`, exact private build-plan replay, production
DRAFT eval artifacts, and assurance-aware activation. A legacy 37-chunk
production DRAFT exists but remains inactive and is not grandfathered. The
intended replacement combines the two provisional source releases into a
deduplicated 47-claim snapshot. See
`docs/phase3-evidence-rag-operations.md`.

Goal: retrieve and explain exact regulatory evidence without allowing model
output to change deterministic decisions.

### Storage and indexing

- implement `EvidenceChunk`, `EmbeddingRecord`, `RetrievalIndexRelease`, and
  `RagRetrievalRun`;
- enable PostgreSQL full-text search and `pgvector` behind provider-neutral
  interfaces;
- chunk by legal structure and preserve provision, source version, locator,
  jurisdiction, topic, effective interval, rights, and assurance metadata;
- build immutable index manifests pinned to corpus releases;
- aggregate multiple immutable source releases through a snapshot whose exact
  source manifests and deduplicated claim membership are server-computed;
- call the embedding provider once, store the full plan outside Git with mode
  `0600`, and build only by replaying that exact checksum-pinned artifact;
- maintain separate filters or index visibility for provisional and
  human-reviewed evidence;
- never combine text from different source versions in one chunk.

### Retrieval and explanation

- implement hybrid lexical/vector retrieval;
- add structured filters, deterministic reranking, deduplication, and citation
  assembly;
- expose authenticated `POST /v1/evidence/search` and an internal Playbook
  Runtime interface;
- require sentence-level citations for material generated explanations;
- include assurance level and limitations with every retrieved item;
- return explicit low-confidence, stale-index, conflicting-evidence,
  unauthorized, and outage states;
- guarantee that disabling RAG cannot change deterministic result statuses or
  reason codes.

### Phase 3 quality gates

- gold provision Recall@10 at least 95%;
- MRR@10 at least 0.90;
- citation precision 100%;
- source/corpus/index version isolation 100%;
- prompt-injected instructions used as authority: zero;
- material unsupported explanations: zero;
- RAG outage changes deterministic decisions: zero;
- historical retrieval replay passes against pinned index releases.
- activation requires a passing eval for the current exact manifest;
- provisional indexes may use a documented independently cross-checked
  `MACHINE_ASSURED` eval, while human-reviewed indexes require a named
  `HUMAN_REVIEWED` eval.
- machine-assured gold datasets require different generator/checker identities,
  exact proposal and snapshot-manifest pins, case-level provision agreement,
  and full accepted checklist-topic coverage;

### Phase 3 exit

- aggregate snapshots and production-like indexes can be created, evaluated,
  activated, rolled back, and replayed;
- search returns exact citations and assurance metadata;
- Citely and playbook services can consume retrieval results through a stable
  contract;
- retrieval failure degrades explanation only, never the deterministic engine.

## Phase 4 — stablecoin, issuer, and deployment dossiers

Status: provisional USDC × EEA mini-dossier implemented; normalized persistent
dossier expansion and broader asset coverage remain.

Goal: add the asset-specific evidence required for Pre-listing decisions.

### Data model

- `Stablecoin` and aliases;
- `Issuer` and legal entities;
- `IssuerAuthorization` by jurisdiction and activity;
- native `Deployment`, contract address, chain, and verification source;
- `BridgeRelationship` and wrapped/synthetic representations;
- `ReserveDisclosure` and assurance reports;
- `RedemptionPolicy`;
- `AdministrativeControl`;
- `OperationalIncident`;
- dossier release, freshness, assurance, and provenance records.

### Initial dossiers

- default targets are USDC and USDT unless a design-partner decision changes
  them;
- verify issuer entities, official token lists, chain deployments, contracts,
  reserve disclosures, redemption terms, and material controls;
- distinguish issuer claims from regulatory authority;
- record missing, conflicting, or stale attributes explicitly;
- do not infer that an issuer authorization automatically covers every token,
  chain, deployment, activity, customer type, or jurisdiction.

### Public and private APIs

- `GET /v1/catalog/stablecoins`;
- `GET /v1/stablecoins/{id}`;
- `GET /v1/deployments/{id}`;
- internal version-pinned dossier lookup for the decision engine;
- public allowlists that exclude private review and commercial-only fields.

### Phase 4 evals and exit

- contract-address and chain identity fixtures;
- issuer/deployment relationship fixtures;
- wrapped/native/synthetic distinction cases;
- authorization scope and effective-date cases;
- reserve/redemption freshness and conflict cases;
- privacy and version replay cases;
- initial dossiers provide enough explicit, source-backed data to run a
  provisional Pre-listing case without inventing missing facts.

## Phase 5 — deterministic Playbook Runtime and Citely package API

Status: provisional vertical slice and retrieval integration are merged.
Immutable artifact persistence, idempotent creation, and authenticated replay
are merged as PR #53. Signed service authentication and target-bound
entitlement hardening are merged as PR #54. Strict create-request schema plus
deterministic Citely consumer fixtures for both launch playbooks are in
development on `codex/phase5-citely-consumer-fixtures`; production rollout
remains.

Goal: deliver the first paid evidence-backed workflow while keeping Citely
domain agnostic.

### Runtime foundations

- implement normalized `BusinessProfile` and confirmed-input contracts;
- implement versioned `DecisionRuleRelease`, `ReasonCode`, and
  `PlaybookTemplateRelease`;
- implement deterministic capability-level evaluation;
- implement `PlaybookAction` generation with evidence or an explicit
  operational basis;
- implement `EvidenceBundle` assembly from pinned corpus, dossier, and retrieval
  releases;
- implement immutable `PlaybookPackage` artifacts in Storage with queryable
  metadata in PostgreSQL;
- enforce idempotency, authorization, replay, and customer-data minimization.

### First vertical slice

Build **Stablecoin Pre-listing & Product Launch** first for small exchanges,
wallets, and payment integrators.

Output includes:

- confirmed and missing input facts;
- capability matrix rather than one asset-wide answer;
- deterministic result and reason codes;
- assurance and review status;
- confidence, limitations, and blockers;
- generated operational actions;
- exact evidence and citations;
- counsel triggers for high-risk or unresolved decisions;
- corpus, index, dossier, rules, template, and schema versions;
- `asOf`, knowledge cutoff, evaluated time, integrity, and artifact reference.

During bootstrap, the package may be sold as evidence-backed regulatory
research and operational preparation without mandatory human review. It must be
visibly provisional when its evidence is not `HUMAN_REVIEWED` and must not claim
to be legal advice or definitive compliance clearance.

### Citely API

- `GET /v1/playbooks`;
- `GET /v1/playbooks/{id}`;
- authenticated `POST /v1/playbook-packages`;
- authenticated `GET /v1/playbook-packages/{id}`;
- signed, short-lived service authentication and entitlement assertion;
- idempotency keys and retry-safe package creation;
- presentation-safe schemas and consumer fixtures;
- no raw rules, private graphs, prompts, or unnecessary customer facts.

### Remaining playbooks

After Pre-listing proves the runtime, add:

1. Stablecoin Business Model Regulatory Boundary;
2. First-Jurisdiction Selection;
3. Entity and Licence Landing Path;
4. Issue vs White-label vs Integrate;
5. Funding and Regulatory Due-Diligence Room;
6. Multi-jurisdiction Expansion;
7. Stablecoin Listing Lifecycle Monitor.

Each playbook must reuse the common runtime and evidence contract rather than
creating a bespoke application path.

### Phase 5 evals and exit

- normalized-input and missing-fact cases;
- exact deterministic status/reason-code cases;
- action grounding and counsel-trigger cases;
- provisional versus human-reviewed assurance cases;
- package schema and Citely rendering fixtures;
- idempotent retry, authorization, privacy, and replay cases;
- RAG enabled/disabled/outage equality for deterministic results;
- at least one production-like Pre-listing package can be created, retrieved,
  rendered by a generic client, and replayed from pinned versions.

Consumer-fixture checkpoint (2026-08-12): the strict
`playbook-package-create-request` schema rejects unknown customer fields,
duplicates, and empty identifiers. Sanitized deterministic request/response
pairs cover both launch playbooks, successful RAG, and typed RAG outage. CI
regenerates them in memory, validates request/response schemas and package
integrity, resolves every referenced claim, and proves a generic projection
retains assurance, limitations, counsel triggers, capability-level results,
citations, retrieval state, and version pins without branching on stablecoin
domain values. This closes the local consumer-fixture criterion; a deployed
signed create/retrieve/render replay remains the production-like exit gate.

Replay-smoke checkpoint (2026-08-12): branch
`codex/phase5-package-replay-smoke` adds a Citely-secret-bound runner for the
remaining production-like package gate. It mints exact five-minute Ed25519
entitlements in memory and checks create, exact retry, changed-request
conflict, target denial, audience rejection, expiry rejection, authenticated
replay, response schema, package integrity, artifact equality, and generic
render readiness without printing credentials or the artifact. It creates a
real immutable package only when explicitly invoked; CI uses mocked transport
and no production key or endpoint. Applying migration `0030`, configuring
public keys, deploying, and invoking the smoke remain rollout actions.

## Phase 6 — monitoring, subscriptions, and controlled self-service

Status: event/impact candidate infrastructure exists; package integration and
customer delivery are not started.

### Monitoring graph

- connect source-version diffs to claims, rules, dossiers, packages, and
  watchlists;
- preserve at-least-once cursor semantics and deduplication;
- compute candidate impacts automatically;
- distinguish machine-suggested, provisional, and reviewed impact states;
- reopen affected packages or create immutable superseding evaluations;
- never mutate historical package conclusions in place.

### Customer delivery

- implement watchlist creation from completed packages;
- expose change-to-action deltas to Citely;
- add webhook first unless a product decision selects email;
- sign webhook payloads, retry safely, and provide delivery audit;
- include affected package, evidence change, status, actions, assurance, and
  required customer response;
- add notification throttling, deduplication, and replay.

### Controlled self-service

- collect production error and correction cases as regressions;
- measure decision, action, retrieval, and monitoring quality by supported
  jurisdiction/asset/capability combination;
- enable self-service only for combinations meeting all current gates;
- keep unsupported combinations typed and blocked;
- introduce optional human-reviewed commercial tiers when reviewers exist;
- implement Reviewer Registry only after Issue #35 activation criteria are met.

### Phase 6 exit

- a material source change identifies affected packages and watchlists;
- Citely receives an idempotent, evidence-backed change delta;
- critical monitoring recall meets the formal threshold;
- self-service scope is explicit, versioned, and reversible;
- unsupported scope never falls through to a confident answer.

## Phase 7 — legacy-domain extraction and repository focus

Status: implementation and local verification complete on
`codex/legacy-domain-cleanup`; pending pull-request review and deployment.

Goal: leave this repository focused on Stablecoin Policy without breaking the
public site or shared data needed by AI Policy.

### Inventory and dependency mapping

- identify AI, politician, donor, election, energy, and data-center routes,
  data, scripts, components, tests, and imports;
- classify each item as stablecoin-required, cross-domain reusable,
  AI-Policy-owned, archive-only, or removable;
- map URLs, search traffic, and redirect requirements;
- identify shared official documents that belong in the shared `regulatory`
  substrate rather than either product repository.

### Extraction

- migrate reusable AI materials through shared data interfaces or the AI Policy
  project;
- preserve licence, provenance, version, and rights metadata;
- add redirects before removing public routes;
- remove orphaned scripts, packages, data, components, and tests in small PRs;
- do not rewrite Git history as part of ordinary extraction;
- preserve stablecoin public APIs and paid endpoints throughout.

### Phase 7 exit

- no production stablecoin route imports unrelated legacy modules;
- AI Policy owns its domain UI and analysis while sharing canonical official
  evidence where appropriate;
- repository-data limits and build output materially improve;
- redirects, analytics, tests, and rollback checks pass.

Implementation record: `docs/phase7-legacy-domain-cleanup.md` is the approved
disposition inventory, redirect plan, before/after measurement, verification
record, and rollback handoff for GitHub Issue #46. The cleanup removes legacy
AI/data-center, politician, donor, vote, energy/EIA product code and generated
data while preserving Stablecoin APIs, shared regulatory storage, and the
machine-assurance lane. Local build output fell from 65 to 23 generated app
pages and tracked bytes fell by 79.7%. Production/preview smoke remains a
deployment gate, not a reason to mutate current production before review.

## 8. Cross-phase engineering workstreams

### Contracts and compatibility

- every public, Citely, MCP, and webhook payload has an immutable major-version
  JSON Schema;
- unknown or unsupported schema versions fail atomically;
- OpenAPI matches runtime behavior;
- breaking changes create a new major contract;
- Citely consumer fixtures run in subsite CI;
- old report and payment routes remain compatible until an explicitly approved
  retirement.

### Storage and data integrity

- Git stores code, schemas, migrations, small fixtures, and manifests only;
- PostgreSQL stores queryable relationships and metadata;
- Storage holds immutable raw sources and complete artifacts;
- every object has checksum, type, size, version, and provenance;
- no object is overwritten in place;
- no production data is duplicated across Git paths or policy-domain repos;
- every cutover has backup, dry run, post-snapshot, and pointer-based rollback.

### Security and privacy

- separate public, service, reviewer, and admin authorization scopes;
- deny direct service-role writes where controlled RPCs own transitions;
- encrypt customer facts and minimize retention;
- never log complete customer facts, secrets, decrypted reports, or package
  bodies;
- use private buckets and short-lived signed URLs;
- maintain public-view allowlists and privacy evals;
- treat source text and retrieved content as untrusted data;
- keep reviewer PII and credentials private if Reviewer Registry is later built.

### Rights and provenance

- commercial internal-storage rights and public excerpt/redistribution rights
  remain separate;
- rights-blocked artifacts are not uploaded;
- link-only material does not become mirrored content;
- research is labeled separately from legal authority;
- corrections create new immutable versions;
- every material output identifies source version, locator, and assurance.

### Observability and operations

- monitor ingestion success, source health, release freshness, cache state,
  schema failures, API latency, retrieval quality, package creation, and
  notification delivery;
- expose data generation time rather than request time;
- alert on source/feed staleness before users discover it;
- retain request IDs and structured, privacy-safe error logs;
- document operational commands, expected output, rollback, and escalation;
- exercise cold-start and degraded-mode behavior before major cutovers.

## 9. Evaluation strategy

### PR gates

- lint and typecheck;
- unit and contract tests;
- deterministic evals;
- applicable Quint typecheck, scenarios, invariants, and witnesses;
- pgTAP for migrations, permissions, triggers, and RPC atomicity;
- privacy and rights tests;
- build and repository data-size checks;
- fixed fixtures only; no required live network.

### Nightly gates

- live official-source health;
- source discovery recall and drift;
- feed and dataset freshness;
- retrieval quality and index drift;
- monitoring replay;
- dependency and security audit;
- production read-only smoke.

### Release gates

- versioned eval report;
- database migration dry run from zero and against linked history;
- private pre-cutover metadata backup;
- permission and public-boundary audit;
- OpenAPI and consumer contract verification;
- Vercel preview smoke;
- production deployment and read-only smoke;
- post-cutover normalized snapshot comparison;
- documented rollback result.

### Non-negotiable quality thresholds

- required evidence metadata: 100%;
- material citation traceability: 100%;
- contradictory evidence in a confident output: zero;
- critical deterministic cases: 100%;
- repeated pinned-run equality: 100%;
- public leakage of private rules/customer data/reviewer data: zero;
- retrieval citation precision and version isolation: 100%;
- known critical monitoring event missed: zero;
- missing or stale material evidence producing certainty: zero;
- machine output mislabeled as human reviewed: zero.

## 10. Branch, PR, and checkpoint policy

- start each bounded capability from current `main` on a `codex/` branch;
- keep schema/model, migration, repository/client, route, tests, and docs for one
  capability in the same PR when they form one atomic contract;
- create a Git checkpoint before beginning a separate storage or state-machine
  migration;
- do not mix unrelated cleanup with feature or cutover work;
- do not commit `docs/PROJECT_CONTEXT.md`; it is a local index;
- do not modify or delete unrelated user work in a dirty tree;
- require passing CI and resolved review feedback before merge;
- merge in dependency order and update this plan after each completed phase;
- record production migrations and smoke evidence in the formal spec and local
  context.

## 11. Immediate execution order

**Vertical-slice decision (2026-08-01):** the fastest path to the first
sellable playbook takes priority over full phase completion. Do not wait for
all of Phase 3 and Phase 4; build one minimal vertical slice — EEA provisional
baseline → USDC×EEA mini-dossier → Pre-listing MVP → first `PlaybookPackage` +
`EvidenceBundle` delivered to Citely — then widen. The Phase 2B exit
conditions in section 7 still define full phase completion; the slice is an
intermediate sellable milestone, not a replacement for them.

1. ~~commit the master plan and policy-feed plan as a documentation
   checkpoint~~ — done 2026-08-01;
2. ~~implement and deploy the simple `/v1/policy-feed` quick win~~ — merged
   as PR #36 and deployed 2026-08-02; production smoke passed: schemaVersion
   `1.0.0`, `generatedAt` equals the active `news-summaries` release
   (`2026-08-01T06:14:09.810Z`), 77 official items, ETag/304 verified;
3. ~~write the Phase 2B provisional-assurance spec delta and Quint model~~ —
   `specs/machineAssurance.qnt` and spec §8.4 revision awaiting approval;
4. implement machine-validation records and provisional publication paths
   (migrations `0020`–`0022`);
5. build and publish the reproducible **EEA MiCA** provisional baseline (first
   and only baseline before the MVP);
6. keep Hong Kong truthfully blocked; defer the Cap. 656 resolution;
7. **Phase 4 Mini:** only the USDC issuer/deployment dossier fields the EEA
   Pre-listing decision actually consumes — no USDT, no full dossier catalog;
8. **Phase 5 MVP:** the Stablecoin Pre-listing & Product Launch playbook plus
   the Stablecoin Business Model Regulatory Boundary playbook (decision
   2026-08-02: they share the EEA baseline and the common runtime, and the
   boundary playbook needs no asset dossier, so both are prepared together).
   The EEA checklist must cover both playbooks' topics: MiCA scope and
   definitions (Articles 2-3), ART/EMT issuance boundaries (Titles III-IV),
   and CASP activity perimeter (Title V) in addition to the Pre-listing
   topics. Deterministic evaluation runs over the EEA baseline (plus the USDC
   mini-dossier for Pre-listing only), producing immutable `PlaybookPackage`
   + `EvidenceBundle` payloads for Citely, visibly provisional, without RAG.
   Release decision (2026-08-02): both playbooks launch together in the same
   release — the MVP ships when Pre-listing AND Business Boundary packages
   both pass their acceptance fixtures;
9. fix the canonical API hostname or select and document the permanent base
   URL (required before Citely integration goes live);
10. **widen after first sale:** Singapore baseline, USDT dossier, Phase 3
    Evidence RAG, remaining playbooks;
11. connect packages to Phase 6 monitoring and delivery;
12. extract unrelated legacy modules in Phase 7.

Parallel work is allowed only when contracts and database ownership do not
overlap. RAG must not begin production implementation before the MVP package
contract is stable; the MVP explicitly does not depend on RAG — evidence
assembly uses direct claim/citation lookups from the provisional corpus.

## 12. Decisions required before their dependent phase

These are not blockers for the policy-feed quick win.

- Phase 2B: approve exact machine-assurance state names and publication gates.
- Phase 2B/4: confirm whether EEA, Singapore, Hong Kong, USDC, and USDT remain
  the launch scope.
- Phase 5: finalize Citely service authentication and entitlement assertion.
- Phase 5: set package pricing, retention, and customer-facing limitation text.
- Phase 6: select webhook, email, or both for the first notification channel.
- Phase 6: define product thresholds for `CONDITIONAL`, `UNDETERMINED`, and
  mandatory counsel escalation.

Use explicit `UNDECIDED` or unsupported states until these choices are made;
do not fill gaps through model inference.

## 13. Master definition of done

Stablecoin Policy reaches the planned product outcome when:

- the public subsite exposes current, versioned, official-source-backed policy
  intelligence with visible freshness;
- Citely consumes standard feeds and package APIs without stablecoin-specific
  domain logic;
- EEA and Singapore baselines and initial USDC/USDT dossiers are reproducible
  from exact source versions, with Hong Kong accurately scoped to available
  authority;
- Evidence RAG retrieves precise, version-isolated citations and cannot change
  deterministic decisions;
- Pre-listing produces an immutable, evidence-backed, replayable package with
  explicit assurance, uncertainty, actions, and counsel triggers;
- change monitoring identifies affected packages and sends idempotent deltas;
- bootstrap operation works without a mandatory human review team while never
  misrepresenting machine output as reviewed legal advice;
- optional human assurance can be added later without redesigning the evidence
  or package model;
- all public/private boundaries, quality thresholds, rollback exercises, and
  production smokes pass;
- unrelated legacy domains no longer burden the stablecoin product runtime.

## 14. Agent handoff procedure

Every coding agent continuing the project must:

1. read `AGENTS.md` and `docs/PROJECT_CONTEXT.md` first;
2. read this master plan and the formal development spec;
3. follow any phase-specific plan linked from this document;
4. inspect `git status`, current branch, recent commits, migrations, and deployed
   state before assuming the checkpoint described here is unchanged;
5. read the relevant Next.js 16 documentation before editing Next.js code;
6. use Quint before coding any new state machine or modifying a modeled one;
7. use forward-only migrations and preserve existing immutable audit records;
8. update tests, evals, OpenAPI, operations docs, formal spec, this plan, and
   local context when behavior changes;
9. run the complete quality gate appropriate to the phase;
10. report exact remaining blockers and production state instead of describing
    implementation completion as product-data completion.
