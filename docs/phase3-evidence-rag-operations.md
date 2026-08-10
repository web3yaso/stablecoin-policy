# Phase 3 Evidence RAG operations

## Current checkpoint

Phase 3 foundation was merged as PR #48 (`433ca8a`) on 2026-08-09. Migrations
`0024` through `0027` are applied to the linked Supabase project. A production
37-chunk EEA index exists as DRAFT only. It has no production eval record and
must remain inactive. Migration `0028` and its application tooling are in the
activation-gates development PR; they are not applied by merging code alone.

Implemented:

- executable Quint model `specs/evidenceRag.qnt` with 19 deterministic
  scenarios, 11 safety invariants, and 13 reachability witnesses;
- migrations `0024` through `0026` for the private cross-domain `retrieval`
  schema, pgvector, immutable evidence chunks and embeddings, versioned index
  releases, atomic activation/rollback, active pointers, and retrieval audit;
- a service-only corpus build-input RPC, deterministic provision-aligned
  builder, atomic/idempotent DRAFT import, exact server-manifest inspection,
  and a separately confirmed activation CLI;
- provider-neutral TypeScript retrieval and embedding interfaces;
- hybrid lexical/vector retrieval using deterministic reciprocal-rank fusion,
  structured filters, deduplication, exact citation assembly, and typed
  insufficient/conflicting/unauthorized/stale/unavailable states;
- strict request and response JSON Schema contracts;
- authenticated `POST /v1/evidence/search` and OpenAPI coverage;
- sanitized Phase 3 gold evals and unit/database regression tests.
- migration `0027` and matching application gates preserve an explicit
  provisional release-to-knowledge-cutoff gap while retaining the stronger
  human-reviewed cutoff rule and requiring freshness through both timestamps.
- migration `0028` defines immutable aggregate corpus snapshots, exact source
  release and deduplicated claim membership, immutable eval records, and an
  activation gate bound to the current server manifest;
- one-shot plan tooling writes embeddings once to a mode-`0600` file outside
  the repository; the build command only replays that exact artifact;
- a service-only DRAFT eval input and production runner support
  `MACHINE_ASSURED` bootstrap evals without mislabeling them as human review.

Deliberately incomplete:

- no production EEA MiCA index is active; the old 37-chunk DRAFT is not an
  activation candidate after `0028` because it has no exact-manifest eval;
- the aggregate 47-claim snapshot, exact private build artifact, replacement
  DRAFT, and real production eval dataset remain operational rollout work;
- no sentence-level generated explanation exists in v1 (`explanation` is
  always `null`);
- no PlaybookPackage has been changed to consume retrieval output;
- the sanitized eval establishes the harness and safety baseline; production
  exit still requires an independently reviewed EEA gold query set;
- PostgreSQL stores full-text documents and pgvector embeddings, while the
  initial small-corpus adapter performs deterministic RRF in the application.
  Database-side candidate retrieval and vector indexes are required before
  corpus size makes bounded in-memory ranking unsuitable.

Time-envelope rule: human-reviewed indexes require `knowledgeCutoff >= asOf`.
Provisional indexes preserve and expose a release whose evidence cutoff predates
its product snapshot date; this gap is an assurance limitation, not a timestamp
to rewrite. In every tier, `freshThrough` must cover both timestamps.

## Safety boundary

Evidence RAG retrieves evidence; it is not a decision authority. It cannot
write claims, citations, corpus releases, rules, conclusions, or reason codes.
The response contains no raw `DecisionRule` or private graph. Typed failure
states return no generated narrative. Optional deterministic decision
fingerprints on retrieval audits must be identical before and after RAG.

The `retrieval` schema is not exposed through PostgREST. The application uses
fixed-search-path, service-role-only `policy` RPCs. The service role has read
access to retrieval tables but no direct insert/update/delete grant. Chunks,
embeddings, index membership, manifests after activation, and run audits are
immutable.

Assurance tiers are isolated:

- `PROVISIONAL` indexes pin provisional corpus releases;
- `HUMAN_REVIEWED` indexes pin published human-reviewed corpus releases;
- an explicitly pinned provisional index cannot satisfy a
  `HUMAN_REVIEWED` request;
- internal search requires reviewed `storage_rights = ALLOWED`;
- `LINK_ONLY` passages may be searched internally but return `excerpt: null`.

## Runtime configuration

The authenticated route accepts `EVIDENCE_API_KEY`, falling back to the
interim `PLAYBOOK_API_KEY` so Citely can use the existing service credential
during the MVP. Supabase uses the existing variables:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `POLICY_STORAGE_TIMEOUT_MS`

Query embeddings use:

- `OPENAI_API_KEY`
- `RAG_EMBEDDING_MODEL` (default `text-embedding-3-small`)
- `RAG_EMBEDDING_MODEL_VERSION` (default `1`; must match the index release)
- `RAG_EMBEDDING_DIMENSIONS` (default `1536`; must match the index release)

Model, version, and dimensions are pinned in each index release. A mismatch
fails as `RETRIEVAL_UNAVAILABLE`; the runtime never silently re-embeds against
a different configuration.

## EEA index builder

The builder creates one immutable provision-aligned chunk for each citation in
the selected corpus release. Existing identical chunks and embeddings are
reused across index releases. Rights-blocked text, claims outside the pinned
release, missing citations, mixed jurisdictions, and assurance mismatches stop
the entire build.

First prepare the aggregate snapshot without writing:

```bash
npm run rag:snapshot -- \
  --snapshot snapshot:stablecoin:eea:mica:2026-08-10 \
  --release provisional:eea:mica:2026-08-02 \
  --release <supplement-release-id>
```

Repeat with `--execute --expected-manifest-sha256 <sha>`. Then call the
embedding provider exactly once and store the full private plan outside Git:

```bash
npm run rag:index:plan -- \
  --snapshot snapshot:stablecoin:eea:mica:2026-08-10 \
  --index-release index:stablecoin:eea:mica:2026-08-10 \
  --fresh-through 2026-12-31T00:00:00Z \
  --output /private/path/eea-index-plan.json
```

Inspect the safe preview, then dry-run and execute the exact same artifact:

```bash
npm run rag:index:build -- --plan /private/path/eea-index-plan.json
npm run rag:index:build -- --plan /private/path/eea-index-plan.json \
  --execute --expected-plan-sha256 <plan-sha>
```

Run `npm run eval:phase3:production` against the DRAFT with a
provenance-bearing dataset and an external `--output` path. `--record`
additionally requires the inspected manifest SHA and an immutable eval-record
ID. A failed eval may be recorded but can never authorize activation. Machine
assurance can authorize only a provisional index; a human-reviewed index
requires named human review.

Activation is a separate two-pass operation. The first command prints the
exact manifest and server-computed hash without writing:

```bash
npm run rag:index:activate -- \
  --index-release index:stablecoin:eea:mica:2026-08-09
```

Only after inspection, repeat with `--execute` and the printed
`--expected-manifest-sha256`. The CLI refreshes the manifest immediately before
calling the atomic activation RPC and fails if the fingerprint changed.

## Verification

```bash
npm run spec:rag
npm run eval:phase3
npm test
npm run typecheck
npm run lint
npm run build
```

The database suite applies every migration from zero and runs all pgTAP tests:

```bash
npm run db:phase2:start
npm run test:db:phase2
npm run db:phase2:stop
```

On 2026-08-10, migrations `0001` through `0028` applied locally from zero and
all 209 pgTAP assertions passed. The Phase 3 sanitized retrieval eval reported
Recall@10 `1.00`, MRR@10 `1.00`, citation precision `1.00`, version isolation
`1.00`, twelve of twelve index-builder safety classifications correct, and zero
assurance, rights, prompt-instruction, or unsafe-build leakage. These are
development fixtures, not the final production-quality EEA gold set.

## Rollout order

1. Merge the activation-gates PR only after CI passes.
2. Take and verify a private metadata backup.
3. Dry-run and apply `0028`, and confirm existing `policy` and `regulatory`
   snapshots do not change. Confirm the old 37-chunk DRAFT is still inactive.
4. Create the aggregate 47-claim snapshot, generate one private plan artifact,
   inspect its membership and cost, then replay it into the replacement DRAFT.
5. Run and record the production EEA eval against that exact DRAFT membership,
   inspect rights/version/assurance isolation, then explicitly activate the
   accepted manifest.
6. Configure Vercel embedding and service-auth variables, deploy, and smoke
   authenticated success, stale, unauthorized, and outage behavior.
7. Integrate retrieval output into `EvidenceBundle` while proving Playbook
   conclusions and reason codes are byte-identical with RAG enabled/disabled.

Rollback is the atomic `policy.rollback_retrieval_index_release` RPC for an
eligible prior index. Database rollback before production data exists is the
normal migration rollback procedure; after index creation, preserve immutable
rows and move the active pointer rather than deleting history.
