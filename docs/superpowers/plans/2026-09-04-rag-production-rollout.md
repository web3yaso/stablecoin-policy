# Evidence RAG — Production Rollout Checkpoint

Status: independent production gold dataset assembled; the ranking-v1 DRAFT
failed retrieval quality gates; ranking v2 is implemented, imported by reusing
the exact embeddings, and has passed the production private-gold evaluation.
Production migration `0036` remains applied and verified. The passing result is
not yet an immutable eval record, and index activation has not occurred.

## Accepted scope

Enable authenticated evidence retrieval from the two existing EEA provisional
MiCA releases. Do not change legal claims, upgrade machine assurance, enable
generated explanations, expose raw rules, or activate self-service scopes.

## Verified production state (2026-09-04)

- The provisional active-index lookup returns `null`.
- `index:stablecoin:eea:mica:2026-08-09` remains `DRAFT` with manifest SHA-256
  `2211cd83eeeab2369a7a38854b811b2f05815580880ac1b51455f9a95516c25d`.
- `provisional:eea:mica:2026-08-02` contains 37 claims / 37 citations.
- `provisional:eea:mica:2026-08-03-significance` contains 10 claims / 11 citations.
- Snapshot `snapshot:stablecoin:eea:mica:2026-09-04` was prepared, inspected,
  and created using exact manifest SHA-256
  `c3684c5dc0463e9880fc4b42e344e282b645a6e55d11e45b4164495fd7f704e0`.
- Snapshot membership is 47 distinct claims / 48 citation inputs. Its original
  `asOf` remains `2026-08-03T00:00:00Z` and `knowledgeCutoff` remains
  `2026-08-01T03:50:30.338Z`; rollout does not make the underlying law current.
- The builder reports zero preflight errors. The citation text totals 176,086
  characters. `buildRetrievalIndexPlan` sends normalized `provisionText` to the
  embedding provider, not customer profiles or raw playbook rules.
- Pre/post metadata exports have identical business projections, SHA-256
  `79223c42cb7603c1bb01b2d52f3da03f8e1fbac03e995e955affe2181921987e`.
  This projection covers the existing metadata exporter, not a full SQL backup
  of retrieval state. The new snapshot is the intended state change.
- Both backups are private mode-0600 files outside Git. Pre/post file hashes:
  `a70985438b2082ac99f3a8654c530210989f47117d5422b60939b6d57779a2e4` and
  `6fc3c7203ff94e7851daec20998c41df14972b8005961c3857cbc9d3bd16b296`.

## Remaining work, in order

1. Completed: after discussing costs, the operator explicitly confirmed
   continuing with OpenAI. The 48 official provision inputs were embedded with
   `text-embedding-3-small`, version `1`, 1536 dimensions. No customer profiles
   or private playbook rules were sent. The earlier blocked invocation sent
   nothing; this approved invocation completed successfully.
2. Completed: generated the mode-0600 private plan, inspected its dry-run,
   and imported `index:stablecoin:eea:mica:2026-09-04` as DRAFT. Technical
   `freshThrough` is `2026-10-30T00:00:00Z`; it is not fresh legal verification.
   Plan SHA-256 is
   `1bcd6b7c60dc7f11af7bdc91235e3360142720638dad7ec7a5f298a152968a4d`;
   artifact SHA-256 is
   `c3e2c26adb228655df6375ee8c7304be47e47f204f90b8fb1fe967c03845d3c2`.
   Server manifest SHA-256 is
   `f93148e5eaa04265644ff15825e3ddac1a933c8136f6f82fa7115479ea3aa11a`.
   Read-back verified 48 members / 47 claims and exact ordinal, claim,
   citation, provision, source version, text checksum, excerpt permission,
   and embedding checksum equality. Database reuse may resolve different
   chunk/embedding IDs than the local preview; use the server manifest for
   eval and activation. The old DRAFT hash is unchanged and active lookup
   remains `null`. Reuse the private plan; do not regenerate embeddings.
3. Completed 2026-09-06: `gpt-5.6-terra` generated 24 cases against the exact
   snapshot and `gpt-5.6-luna` independently re-derived each answer without
   receiving the generator's expected provision IDs. The strict assembler
   accepted 24/24 cases with zero answer divergence and 12/12 checklist-topic
   coverage. Dataset ID is
   `eval-dataset:63df58c8a8de46217fc2a7f7c784ea7f9a73dec7`; SHA-256 is
   `770d6d6f4b45b8ae74dcc39310431fab10fdd0490e2a7a7034e94ff7dabde450`.
   The proposal, check, model-run audit, and assembled dataset remain mode-0600
   outside Git.
4. In progress. The exact dataset was run once against ranking-v1 DRAFT
   `index:stablecoin:eea:mica:2026-09-04`. It correctly failed closed:
   Recall@10 `0.9166666667`, MRR@10 `0.4903769841`; every citation, version,
   rights, assurance, prompt-injection, and topic-coverage gate passed. No eval
   record was written and the index remained inactive. Private failure artifact
   SHA-256 is
   `da9814003e9af90f32a790d6811aacb14d99b35a718092fe0e064846e1ef2567`.
   Diagnostics showed vector-only Recall@10 `1` / MRR@10 `0.8892857143`; the
   equal-weight raw-term-frequency leg was the regression source.

   Ranking v2 replaces the raw lexical score with BM25 (`k1=1.2`, `b=0.75`)
   and uses weighted RRF (`lexical=0.1`, `vector=1`, `rrfK=60`). It is pinned
   as `bm25-en-v2` + `cosine-weighted-rrf-v2`; unknown or mixed config versions
   fail as `RETRIEVAL_UNAVAILABLE`. Sanitized regression tests, 370 application
   tests, the Phase 3 eval, all 19 Quint scenarios / 11 invariants / 13
   witnesses, typecheck, lint, and build pass. A checksum-pinned private tool
   derived the v2 plan from the inspected v1 artifact and reused all 48
   embedding records without calling the embedding provider. Derived plan
   SHA-256 is
   `dce45bf32ae3d6a09ee84b406e735a9a626b957137e189379ebf231d53937898`;
   embedding-set SHA-256 is
   `86201ce39d7c2ffc5e45e4fd4fe9c63c82cf0742595b60c18cd1c45b93eab20d`.
   Production DRAFT `index:stablecoin:eea:mica:2026-09-06-ranking-v2` now has
   server manifest
   `97ec789cc0f8ed3d6e6d6d0ebfb1b1675f16467fefed799be8a8b2e6b526ea8d`.
   The old DRAFT remains unchanged and no active pointer exists. After explicit
   operator approval, the same 24 private gold queries were embedded and run
   against ranking v2 on 2026-09-06. It passed Recall@10 `1`, MRR@10
   `0.9101190476`, citation precision `1`, version isolation `1`, checklist
   coverage `1`, and zero rights, assurance, prompt-instruction, or unsafe-build
   leaks. Private eval artifact SHA-256 is
   `2f60795cd3b97d6273fe702b0c65e6b39375976affd4863b84573f3643440c28`.
   The run was intentionally eval-only: no eval record was written and the
   index remains DRAFT. Record this already-inspected artifact against the exact
   v2 manifest without recomputing embeddings before considering activation.
5. Resolve first-activation rollback before moving the active pointer. The
   current rollback RPC requires an eligible prior index; none exists. Any new
   suspension/deactivation state-machine behavior requires a Quint spec delta
   presented for approval before implementation.
   The operator-approved state/type design is
   [First-activation suspension](./2026-09-04-rag-first-activation-suspension.md);
   implementation and local verification are complete (328 application tests,
   475 pgTAP assertions, 6 race schedules, Quint, evals, and build passed).
   Completed 2026-09-05: after backup and linked dry-run, migration `0036` was
   applied. Remote history matches `0001`–`0036`; business metadata and all
   unchanged retrieval fingerprints match pre-migration state. The two indexes
   remain DRAFT, pointer/audit rows remain empty, service inspection returns
   null, and role privilege checks pass. No activation or suspension occurred.
   Restore caveat and hashes are recorded in the operations guide.
6. Verify Vercel embedding configuration and use a short-lived Citely token
   with `evidence:search` for production smoke. The local subsite environment
   has no Citely signing private key; do not copy that key into the subsite or
   relax service authentication. A successful unsigned `401` only proves the
   route/auth boundary, not retrieval availability.
   The signed evidence runner is implemented on `codex/rag-signed-smoke`,
   stacked on suspension PR #74. `npm run smoke:citely-evidence` is a
   no-network preview; `--execute` is a separately authorized live operation
   that may incur query-embedding costs and append retrieval audits. Its
   ACTIVE and UNAVAILABLE modes never change the index pointer. See
   [Signed smoke plan](./2026-09-04-rag-signed-smoke.md) and the operations guide
   for private case preparation and the Citely-only signing boundary.
7. After eval and rollback readiness, activate the exact accepted manifest and
   verify authenticated success, pinned citations, stale/unauthorized
   degradation, and deterministic playbook isolation. Keep `explanation:null`.

## Private artifact handling

Operator-local backup paths are recorded only in the ignored
`docs/PROJECT_CONTEXT.md`. Temporary files are not durable disaster-recovery
storage. Retain the verified artifacts in approved private storage before
clearing the temporary directory; do not commit them into this repository.
