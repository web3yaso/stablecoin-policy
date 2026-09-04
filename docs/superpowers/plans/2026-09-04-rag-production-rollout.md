# Evidence RAG — Production Rollout Checkpoint

Status: snapshot created; embedding generation awaits explicit external-data
transfer approval. Index activation has not occurred.

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

1. Obtain explicit approval to send the 48 official provision texts to OpenAI
   for embeddings. The execution approval layer rejected the command before
   process launch; no private plan file exists. Do not retry by another path
   without resolving the approval.
2. Generate one private plan for `index:stablecoin:eea:mica:2026-09-04`, inspect
   its checksum and membership, dry-run its import, then import the exact plan
   as a replacement DRAFT. The proposed technical freshness cutoff is
   `2026-10-30T00:00:00Z`, conservatively within 90 days of the pinned source
   cutoff; revalidate this before execution. It is not a claim of fresh legal
   verification.
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
6. Verify Vercel embedding configuration and use a short-lived Citely token
   with `evidence:search` for production smoke. The local subsite environment
   has no Citely signing private key; do not copy that key into the subsite or
   relax service authentication. A successful unsigned `401` only proves the
   route/auth boundary, not retrieval availability.
7. After eval and rollback readiness, activate the exact accepted manifest and
   verify authenticated success, pinned citations, stale/unauthorized
   degradation, and deterministic playbook isolation. Keep `explanation:null`.

## Private artifact handling

Operator-local backup paths are recorded only in the ignored
`docs/PROJECT_CONTEXT.md`. Temporary files are not durable disaster-recovery
storage. Retain the verified artifacts in approved private storage before
clearing the temporary directory; do not commit them into this repository.
