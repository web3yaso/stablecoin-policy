# Evidence RAG — Production Rollout Checkpoint

Status: OpenAI embeddings generated, replacement DRAFT imported, and production
migration `0036` applied and verified. Index activation has not occurred.

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
3. Produce genuinely separate generator and independent-checker artifacts for
   the real EEA gold dataset. Pin the exact snapshot manifest, cover every
   required checklist topic, and use the existing strict assembler. Do not
   invent a second agent identity, relabel self-review, or substitute the
   sanitized PR #73 regression fixtures for production evidence. Any further
   source-text transfer to a model must be authorized too.
4. Run and record the real production DRAFT eval against its exact manifest;
   failure must leave the index inactive. Preserve the private dataset and
   eval artifacts outside Git.
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
