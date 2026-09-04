# Evidence RAG — First-activation suspension proposal

Status: operator approved the state/type sketch on 2026-09-04. Implemented
locally; local verification passed. No production migration, activation,
or suspension has been executed as part of this change.

## Why this is needed

`policy.rollback_retrieval_index_release` (migration `0024`) rejects rollback
when `previous_index_release_id` is null. That is the first activation case.
Simply retiring an index is insufficient: the pinned resolver and chunk query
in `0025` deliberately allow `RETIRED` indexes for historical searches.

The proposal adds explicit emergency suspension of the exact active index,
without deleting evidence or rewriting a completed package. It does not relax
the independent production eval or signed-auth gates.

## Proposed behavior

1. A service-only, default-dry-run administrative command inspects the exact
   domain, assurance tier, active index ID, manifest hash, and pointer revision.
2. Execution requires that inspected target, an operation ID, and a reason.
   One database transaction checks authorization and the current target,
   marks the active index `SUSPENDED`, clears active/previous pointers for
   that scope, increments its revision, and appends an immutable audit entry.
   The scope pointer row survives with no active index so revision history
   cannot be reset by deleting/recreating the row.
3. `SUSPENDED` is not a synonym for `RETIRED`. Fresh retrieval cannot resolve
   or list chunks from a suspended index, including explicit index-ID queries.
   Without another active index, fresh searches use the existing
   `RETRIEVAL_UNAVAILABLE` response and `explanation: null`.
4. Completed package GET/replay remains byte-identical. Suspension does not
   delete chunks, embeddings, snapshots, eval records, or recorded results,
   and cannot alter claims, rules, actions, or deterministic conclusions.
5. Exact operation retries return the stored result without another transition.
   Reusing the operation ID with a different target/reason is rejected. A new
   request against an old pointer revision fails with zero writes, including
   an A → B → A pointer change. Idempotency lookup precedes current-state checks.
6. Activation, rollback, and suspension must serialize on the same scope before
   locking index rows, including first activation where no pointer yet exists.
   Each successful pointer transition increments the scope revision. One
   consistent lock order avoids activation/rollback deadlocks.
7. Recovery uses a separately evaluated new DRAFT and the existing explicit
   activation gates. There is no automatic fallback or unsuspend operation in
   this slice. Existing evidence/vector records may be reused by the builder;
   a suspended index itself can never be selected as a rollback target.

## Model scope and proposed type sketch

PostgreSQL is shared state: retain plain Quint, without message-passing Choreo.
Admin operations commit atomically; overlapping inspect/commit steps are
separate model actions. SQL locking and atomicity must also be tested in real
PostgreSQL, not assumed proven by the model. No liveness claim is made.

- Extend `IndexPhase` with `Suspended`.
- Group each scope's pointer state as `{activeIndexId, previousIndexId,
  revision}`; retain immutable index/evidence identity separately.
- Model pending admin requests with `{operationId, scope, expectedIndexId,
  expectedManifest, expectedRevision, authorized}`. IDs/hashes are opaque.
- Keep append-only operation results/audit separate from pointer state.
- Preserve existing retrieval/replay and deterministic-decision fingerprints.
- Use bounded symbolic scopes, indexes, requests, and freshness states for
  simulation. Timeouts, model quality, network transport, JWT cryptography,
  and cancellation of already-running searches are outside the model.
  A search that already acquired evidence before suspension can finish;
  suspension blocks subsequent acquisition, not an in-flight revocation fence.

## Required verification after approval

- Quint typecheck and sampled runs incrementally; separate scenario tests.
- Witnesses: first activation → suspension → unavailable; exact retry;
  stale-request rejection; recovery via new DRAFT; historical replay.
- Invariants: pointer/state agreement; no fresh suspended-index retrieval;
  exact target and revision binding; immutable/idempotent audit;
  assurance isolation; no mutation of evidence or deterministic decisions.
- pgTAP: service-only permissions, null/stale/wrong-scope inputs, checksum
  mismatch, replay conflict, pinned lookup denial, late-failure atomic rollback,
  retained historical records, and rejected rollback to a suspended index.
- Two-session PostgreSQL races: suspend vs activate, suspend vs rollback,
  duplicate suspend, and competing first activations. Check durable results,
  not only return values.
- TypeScript: dry-run makes no write; strict input validation; exact RPC args;
  typed unavailable response; unchanged package replay and decisions.

Implementation correspondence: `specs/evidenceRag*.qnt`, a new forward migration
after `0035` (number rechecked before implementation), `lib/retrieval/index-admin.ts`,
admin CLI, and retrieval/pgTAP tests. Do not edit already-applied migrations.

## Implementation record

The domain is concurrent administrative control of a shared index pointer.
PostgreSQL transactions are atomic; inspect-to-execute gaps permit interleaving.
Embedding quality and service-token cryptography are outside this model.

| Step | Implementation and state delta | Verification gate |
| --- | --- | --- |
| 1 | `evidenceRagSuspension.qnt` imports the original lifecycle phase type; grouped scope pointers, prepared requests, immutable operation audit, suspension and recovery | 11 scenarios, 5 invariants, 11 reachable witnesses; original RAG model unchanged apart from the extra phase |
| 2 | `0036_retrieval_index_suspension.sql`: new phase/audit/revision, locked activation and rollback wrappers, service-only inspection and suspension | Same Quint invariants plus real pgTAP late-failure atomic rollback and 6 two-session race schedules |
| 3 | `index-admin.ts`, `suspend-command.ts`, `suspend-index.ts`: strict request pins, default dry-run, exact ledger replay | TypeScript validation, no-write dry-run, unchanged pins and bigint precision |
| 4 | `search.ts`: no eligible index returns `RETRIEVAL_UNAVAILABLE` / HTTP 503, not evidence insufficiency; no embedding call in that path | Typed-degradation test, full RAG and package replay regressions |

The existing SQL resolver/list RPCs already whitelist ACTIVE/RETIRED, so they
need no edits to deny SUSPENDED. Activated/retired indexes retain their existing
content and exact-manifest eval gates. Internal activation/rollback bodies are
moved to the private retrieval schema and revoked from service callers; only
the wrappers are exposed. This preserves the existing gate implementation
without duplicating it. Scope serialization also fixes absent-pointer races.

Pointer revision is encoded as a decimal string across JSON to preserve bigint
precision. Exact retries go straight to the operation ledger without refreshing
operator pins. Missing/unknown index lookup now returns the same generic 503 as
suspension; no public response leaks the administrative reason. Indexes that
exist but lack matching evidence still return `INSUFFICIENT_EVIDENCE`.

The test-only concurrency runner reuses the sanitized foundation fixture,
refuses pre-existing fixture/scope rows, proves the contender is waiting on an
advisory lock before releasing the first transaction, checks durable results,
and cleans up only its local fixture rows. It accepts no remote database URL.

If a safety invariant fails, stop and fix the implementation; do not weaken
the approved model. The verified transition scope does not guarantee
already-running searches are cancelled at suspension time.

## Local verification record — 2026-09-04

- Pinned Quint 0.32.0: 11 suspension scenarios passed; sampled simulation
  (5,000 samples, 40 steps) found no violation of all 5 invariants and reached
  all 11 witnesses. Original RAG: 19 scenarios, 11 invariants, 13 witnesses
  passed. This is bounded simulation, not exhaustive proof.
- Model self-review: all lifecycle actions participate in `step`; witnesses
  exercise non-initial transitions, rejection, replay, and recovery. The model
  abstracts corpus eligibility and atomic commits; real lock ordering and
  rollback are checked separately in PostgreSQL. No liveness or in-flight
  cancellation guarantee is claimed.
- Fresh local database reset applied migrations `0001`–`0036`. All 15 pgTAP
  files passed, 475 assertions total, including 107 RAG foundation assertions.
  The Supabase test-container mount was blocked by the local Docker host;
  the same SQL files were streamed to local PostgreSQL instead. Every TAP
  plan and assertion count was checked, with no failing assertions.
- All 6 true two-session suspension race schedules passed after the reset;
  the existing superseding-package race also passed. Local fixtures were
  cleaned up by the runners.
- 328 application tests, typecheck, lint, production build, repository data
  policy, and whitespace checks passed. The build required normal local
  process permissions because the sandbox denied Turbopack port binding.
- Phase 3 sanitized eval, Phase 5's 16-case retrieval/RAG readiness eval,
  and both byte-exact Citely consumer fixture replays passed. These do not
  replace independent production corpus evaluation.

## Separate production-eval prerequisite

The existing assembler and DRAFT runner consume, but do not generate, the
generator/checker artifacts. Produce genuinely independent artifacts pinned
to the recorded snapshot, then run the exact-manifest eval. Do not invent agent
identities or mark fixture tests as production acceptance. This proposal does
not authorize additional model calls or delegation.
