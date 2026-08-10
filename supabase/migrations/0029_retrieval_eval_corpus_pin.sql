-- Bind production DRAFT eval datasets to the exact corpus manifest used by
-- the index. This is a read-only service boundary and changes no retrieval,
-- legal-corpus, or decision state.

begin;

create function policy.get_retrieval_draft_corpus_pin(p_index_release_id text)
returns jsonb
language sql
stable
security definer
set search_path = policy, retrieval, public
as $$
  select jsonb_build_object(
    'indexReleaseId', release.index_release_id,
    'corpusReleaseId', release.corpus_release_id,
    'corpusReleaseKind', release.corpus_release_kind,
    'manifestSha256', coalesce(
      snapshot.manifest_sha256,
      provisional.manifest_sha256,
      reviewed.manifest_checksum_sha256
    )
  )
  from retrieval.index_releases release
  left join retrieval.corpus_snapshots snapshot
    on snapshot.snapshot_id = release.corpus_release_id
      and snapshot.corpus_release_kind = release.corpus_release_kind
  left join policy.provisional_corpus_releases provisional
    on release.corpus_release_kind = 'PROVISIONAL'
      and provisional.release_id = release.corpus_release_id
  left join policy.corpus_releases reviewed
    on release.corpus_release_kind = 'HUMAN_REVIEWED'
      and reviewed.release_id = release.corpus_release_id
      and reviewed.release_state = 'PUBLISHED'
  where release.index_release_id = p_index_release_id
    and release.release_state = 'DRAFT'
    and coalesce(
      snapshot.manifest_sha256,
      provisional.manifest_sha256,
      reviewed.manifest_checksum_sha256
    ) is not null;
$$;

revoke all on function policy.get_retrieval_draft_corpus_pin(text)
from public, anon, authenticated;
grant execute on function policy.get_retrieval_draft_corpus_pin(text)
to service_role;

comment on function policy.get_retrieval_draft_corpus_pin is
  'Returns the exact immutable corpus manifest pinned by one DRAFT index for production eval binding.';

commit;
