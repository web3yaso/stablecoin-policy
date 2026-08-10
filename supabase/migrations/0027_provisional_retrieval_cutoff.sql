-- Preserve the exact time envelope of provisional corpus releases.
--
-- A provisional snapshot may be published after its evidence knowledge cutoff;
-- that visible gap is part of its assurance limitation. Human-reviewed releases
-- retain the stronger knowledge_cutoff >= as_of requirement. Every retrieval
-- index must remain fresh through both timestamps.

begin;

do $$
declare
  v_constraint_name text;
begin
  select constraint_row.conname
  into v_constraint_name
  from pg_constraint constraint_row
  where constraint_row.conrelid = 'retrieval.index_releases'::regclass
    and constraint_row.contype = 'c'
    and pg_get_constraintdef(constraint_row.oid) like '%knowledge_cutoff >= as_of%';

  if v_constraint_name is null then
    raise exception 'knowledge cutoff constraint not found';
  end if;

  execute format(
    'alter table retrieval.index_releases drop constraint %I',
    v_constraint_name
  );
end;
$$;

do $$
declare
  v_constraint_name text;
begin
  select constraint_row.conname
  into v_constraint_name
  from pg_constraint constraint_row
  where constraint_row.conrelid = 'retrieval.index_releases'::regclass
    and constraint_row.contype = 'c'
    and pg_get_constraintdef(constraint_row.oid) like '%fresh_through >= as_of%';

  if v_constraint_name is null then
    raise exception 'fresh-through constraint not found';
  end if;

  execute format(
    'alter table retrieval.index_releases drop constraint %I',
    v_constraint_name
  );
end;
$$;

alter table retrieval.index_releases
  add constraint index_releases_cutoff_by_assurance_check
  check (
    assurance_tier = 'PROVISIONAL'
    or knowledge_cutoff >= as_of
  ),
  add constraint index_releases_fresh_through_envelope_check
  check (fresh_through >= greatest(as_of, knowledge_cutoff));

create or replace function policy.create_retrieval_index_release(
  p_index_release_id text,
  p_policy_domain text,
  p_corpus_release_id text,
  p_corpus_release_kind text,
  p_fresh_through timestamptz,
  p_lexical_config jsonb,
  p_vector_config jsonb,
  p_embedding_model text,
  p_embedding_model_version text,
  p_embedding_dimensions integer
)
returns jsonb
language plpgsql
security definer
set search_path = policy, retrieval, regulatory, public, extensions
as $$
declare
  v_as_of timestamptz;
  v_knowledge_cutoff timestamptz;
begin
  if p_index_release_id !~ '^[a-z0-9][a-z0-9._:-]{2,200}$'
     or p_policy_domain !~ '^[a-z][a-z0-9-]{2,40}$' then
    raise exception 'invalid retrieval index identifier or policy domain';
  end if;
  if p_corpus_release_kind = 'PROVISIONAL' then
    select release.as_of, release.knowledge_cutoff
    into v_as_of, v_knowledge_cutoff
    from policy.provisional_corpus_releases release
    where release.release_id = p_corpus_release_id;
  elsif p_corpus_release_kind = 'HUMAN_REVIEWED' then
    select release.as_of, release.knowledge_cutoff
    into v_as_of, v_knowledge_cutoff
    from policy.corpus_releases release
    where release.release_id = p_corpus_release_id
      and release.release_state = 'PUBLISHED';
  else
    raise exception 'invalid corpus release kind';
  end if;
  if v_as_of is null then
    raise exception 'eligible corpus release does not exist';
  end if;
  if p_corpus_release_kind = 'HUMAN_REVIEWED'
     and v_knowledge_cutoff < v_as_of then
    raise exception 'human-reviewed knowledge cutoff cannot predate corpus as_of';
  end if;
  if p_fresh_through < greatest(v_as_of, v_knowledge_cutoff) then
    raise exception 'retrieval index freshness cannot predate corpus time envelope';
  end if;

  insert into retrieval.index_releases (
    index_release_id, policy_domain, corpus_release_id,
    corpus_release_kind, assurance_tier, as_of, knowledge_cutoff,
    fresh_through, lexical_config, vector_config, embedding_model,
    embedding_model_version, embedding_dimensions
  ) values (
    p_index_release_id, p_policy_domain, p_corpus_release_id,
    p_corpus_release_kind, p_corpus_release_kind, v_as_of,
    v_knowledge_cutoff, p_fresh_through, p_lexical_config,
    p_vector_config, p_embedding_model, p_embedding_model_version,
    p_embedding_dimensions
  );

  return jsonb_build_object(
    'indexReleaseId', p_index_release_id,
    'releaseState', 'DRAFT',
    'corpusReleaseId', p_corpus_release_id,
    'assuranceTier', p_corpus_release_kind
  );
end;
$$;

revoke all on function policy.create_retrieval_index_release(
  text, text, text, text, timestamptz, jsonb, jsonb, text, text, integer
) from public, anon, authenticated;
grant execute on function policy.create_retrieval_index_release(
  text, text, text, text, timestamptz, jsonb, jsonb, text, text, integer
) to service_role;

comment on constraint index_releases_cutoff_by_assurance_check
on retrieval.index_releases is
  'Human-reviewed indexes require knowledge_cutoff >= as_of; provisional indexes preserve and expose any release-to-evidence time gap.';
comment on constraint index_releases_fresh_through_envelope_check
on retrieval.index_releases is
  'The freshness horizon must cover both the corpus as_of and knowledge cutoff timestamps.';

commit;
