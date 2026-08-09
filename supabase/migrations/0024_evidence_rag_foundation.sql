-- Phase 3 Evidence RAG storage and index-release lifecycle.
--
-- This migration owns the cross-domain `retrieval` schema. Stablecoin Policy
-- remains the sole migration owner until a shared platform repository exists.
-- RAG data is service-only and cannot mutate legal claims, corpus releases,
-- DecisionRule definitions, or deterministic playbook results.

begin;

create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema extensions;

create schema if not exists retrieval;
revoke all on schema retrieval from public, anon, authenticated;
grant usage on schema retrieval to service_role;

create table retrieval.evidence_chunks (
  chunk_id text primary key
    check (chunk_id ~ '^[a-z0-9][a-z0-9._:-]{2,200}$'),
  claim_id text not null references policy.legal_claims(claim_id),
  citation_id text not null references policy.citations(citation_id),
  provision_id text not null references regulatory.provisions(provision_id),
  source_version_id text not null references regulatory.source_versions(version_id),
  language_code text not null,
  chunk_text text not null check (length(btrim(chunk_text)) > 0),
  chunk_checksum_sha256 text not null
    check (chunk_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  excerpt_permission text not null
    check (excerpt_permission in ('ALLOWED', 'LINK_ONLY')),
  internal_search_allowed boolean not null check (internal_search_allowed),
  lexical_document tsvector generated always as (
    to_tsvector('english'::regconfig, chunk_text)
  ) stored,
  created_at timestamptz not null default now(),
  unique (claim_id, citation_id, provision_id, chunk_checksum_sha256)
);

create index evidence_chunks_lexical_idx
  on retrieval.evidence_chunks using gin (lexical_document);
create index evidence_chunks_source_version_idx
  on retrieval.evidence_chunks (source_version_id, provision_id);

create table retrieval.embedding_records (
  embedding_id text primary key
    check (embedding_id ~ '^[a-z0-9][a-z0-9._:-]{2,200}$'),
  chunk_id text not null references retrieval.evidence_chunks(chunk_id),
  model_identifier text not null check (length(btrim(model_identifier)) > 0),
  model_version text not null check (length(btrim(model_version)) > 0),
  dimensions integer not null check (dimensions > 0 and dimensions <= 4096),
  embedding extensions.vector not null,
  embedding_checksum_sha256 text not null
    check (embedding_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  check (extensions.vector_dims(embedding) = dimensions),
  unique (chunk_id, model_identifier, model_version, embedding_checksum_sha256)
);

create index embedding_records_chunk_idx
  on retrieval.embedding_records (chunk_id, model_identifier, model_version);

create table retrieval.index_releases (
  index_release_id text primary key
    check (index_release_id ~ '^[a-z0-9][a-z0-9._:-]{2,200}$'),
  policy_domain text not null
    check (policy_domain ~ '^[a-z][a-z0-9-]{2,40}$'),
  corpus_release_id text not null,
  corpus_release_kind text not null
    check (corpus_release_kind in ('PROVISIONAL', 'HUMAN_REVIEWED')),
  assurance_tier text not null
    check (assurance_tier in ('PROVISIONAL', 'HUMAN_REVIEWED')),
  as_of timestamptz not null,
  knowledge_cutoff timestamptz not null,
  fresh_through timestamptz not null,
  manifest_sha256 text
    check (manifest_sha256 is null or manifest_sha256 ~ '^[0-9a-f]{64}$'),
  lexical_config jsonb not null check (jsonb_typeof(lexical_config) = 'object'),
  vector_config jsonb not null check (jsonb_typeof(vector_config) = 'object'),
  embedding_model text not null check (length(btrim(embedding_model)) > 0),
  embedding_model_version text not null
    check (length(btrim(embedding_model_version)) > 0),
  embedding_dimensions integer not null
    check (embedding_dimensions > 0 and embedding_dimensions <= 4096),
  release_state text not null default 'DRAFT'
    check (release_state in ('DRAFT', 'ACTIVE', 'RETIRED')),
  activated_at timestamptz,
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  check (knowledge_cutoff >= as_of),
  check (fresh_through >= as_of),
  check (corpus_release_kind = assurance_tier),
  check (
    (release_state = 'DRAFT' and activated_at is null and retired_at is null)
    or (release_state = 'ACTIVE' and activated_at is not null and retired_at is null)
    or (release_state = 'RETIRED' and activated_at is not null and retired_at is not null)
  )
);

create index index_releases_domain_tier_state_idx
  on retrieval.index_releases (
    policy_domain, assurance_tier, release_state, created_at desc
  );

create table retrieval.index_release_chunks (
  index_release_id text not null
    references retrieval.index_releases(index_release_id),
  chunk_id text not null references retrieval.evidence_chunks(chunk_id),
  embedding_id text not null references retrieval.embedding_records(embedding_id),
  ordinal integer not null check (ordinal >= 0),
  primary key (index_release_id, chunk_id),
  unique (index_release_id, ordinal)
);

create table retrieval.active_index_pointers (
  policy_domain text not null,
  assurance_tier text not null
    check (assurance_tier in ('PROVISIONAL', 'HUMAN_REVIEWED')),
  active_index_release_id text not null
    references retrieval.index_releases(index_release_id),
  previous_index_release_id text
    references retrieval.index_releases(index_release_id),
  updated_at timestamptz not null,
  primary key (policy_domain, assurance_tier),
  check (
    previous_index_release_id is null
    or previous_index_release_id <> active_index_release_id
  )
);

create table retrieval.rag_retrieval_runs (
  run_id text primary key
    check (run_id ~ '^rag-run:[0-9a-f]{16}:[0-9a-f]{16}$'),
  policy_domain text not null,
  query_sha256 text not null check (query_sha256 ~ '^[0-9a-f]{64}$'),
  filters jsonb not null check (jsonb_typeof(filters) = 'object'),
  requested_assurance_tier text not null
    check (requested_assurance_tier in ('PROVISIONAL', 'HUMAN_REVIEWED')),
  index_release_id text references retrieval.index_releases(index_release_id),
  corpus_release_id text,
  outcome text not null check (outcome in (
    'SUCCESS', 'INSUFFICIENT_EVIDENCE', 'CONFLICTING_EVIDENCE',
    'UNAUTHORIZED_EVIDENCE', 'STALE_INDEX', 'RETRIEVAL_UNAVAILABLE'
  )),
  ranked_hits jsonb not null check (jsonb_typeof(ranked_hits) = 'array'),
  result_sha256 text not null check (result_sha256 ~ '^[0-9a-f]{64}$'),
  deterministic_decision_before_sha256 text,
  deterministic_decision_after_sha256 text,
  created_at timestamptz not null default now(),
  check (
    deterministic_decision_before_sha256 is null
    or deterministic_decision_before_sha256 ~ '^[0-9a-f]{64}$'
  ),
  check (
    deterministic_decision_after_sha256 is null
    or deterministic_decision_after_sha256 ~ '^[0-9a-f]{64}$'
  ),
  check (
    deterministic_decision_before_sha256 is null
    or deterministic_decision_after_sha256 is null
    or deterministic_decision_before_sha256 = deterministic_decision_after_sha256
  )
);

create index rag_retrieval_runs_index_created_idx
  on retrieval.rag_retrieval_runs (index_release_id, created_at desc);

create function retrieval.validate_evidence_chunk()
returns trigger
language plpgsql
set search_path = retrieval, policy, regulatory, public, extensions
as $$
declare
  v_citation policy.citations%rowtype;
  v_provision regulatory.provisions%rowtype;
  v_version regulatory.source_versions%rowtype;
  v_effective_permission text;
begin
  select * into strict v_citation
  from policy.citations where citation_id = new.citation_id;
  select * into strict v_provision
  from regulatory.provisions where provision_id = new.provision_id;
  select * into strict v_version
  from regulatory.source_versions where version_id = new.source_version_id;

  if v_citation.claim_id <> new.claim_id
     or v_citation.provision_id <> new.provision_id then
    raise exception 'evidence chunk claim/citation/provision relationship is invalid';
  end if;
  if v_provision.version_id <> new.source_version_id then
    raise exception 'evidence chunk source version does not own the provision';
  end if;
  if v_version.storage_rights <> 'ALLOWED'
     or v_version.rights_reviewed_at is null
     or nullif(btrim(v_version.rights_basis), '') is null then
    raise exception 'evidence chunk source lacks reviewed internal search rights';
  end if;
  select coalesce(review.excerpt_permission, v_provision.excerpt_permission)
  into v_effective_permission
  from (select 1) singleton
  left join regulatory.provision_rights_reviews review
    on review.provision_id = v_provision.provision_id;
  if v_effective_permission not in ('ALLOWED', 'LINK_ONLY')
     or new.excerpt_permission <> v_effective_permission then
    raise exception 'evidence chunk excerpt permission is unknown or stale';
  end if;
  if new.chunk_checksum_sha256 <> encode(
    extensions.digest(convert_to(new.chunk_text, 'UTF8'), 'sha256'),
    'hex'
  ) then
    raise exception 'evidence chunk checksum mismatch';
  end if;
  return new;
end;
$$;

create trigger validate_evidence_chunk_trigger
before insert on retrieval.evidence_chunks
for each row execute function retrieval.validate_evidence_chunk();

create trigger protect_evidence_chunk_trigger
before update or delete on retrieval.evidence_chunks
for each row execute function regulatory.reject_immutable_row_change();
create trigger protect_embedding_record_trigger
before update or delete on retrieval.embedding_records
for each row execute function regulatory.reject_immutable_row_change();
create trigger protect_index_release_chunk_trigger
before update or delete on retrieval.index_release_chunks
for each row execute function regulatory.reject_immutable_row_change();
create trigger protect_rag_retrieval_run_trigger
before update or delete on retrieval.rag_retrieval_runs
for each row execute function regulatory.reject_immutable_row_change();

create function retrieval.protect_index_release_content()
returns trigger
language plpgsql
set search_path = retrieval, public
as $$
begin
  if new.index_release_id is distinct from old.index_release_id
     or new.policy_domain is distinct from old.policy_domain
     or new.corpus_release_id is distinct from old.corpus_release_id
     or new.corpus_release_kind is distinct from old.corpus_release_kind
     or new.assurance_tier is distinct from old.assurance_tier
     or new.as_of is distinct from old.as_of
     or new.knowledge_cutoff is distinct from old.knowledge_cutoff
     or new.fresh_through is distinct from old.fresh_through
     or new.lexical_config is distinct from old.lexical_config
     or new.vector_config is distinct from old.vector_config
     or new.embedding_model is distinct from old.embedding_model
     or new.embedding_model_version is distinct from old.embedding_model_version
     or new.embedding_dimensions is distinct from old.embedding_dimensions
     or new.created_at is distinct from old.created_at then
    raise exception 'retrieval index release content is immutable';
  end if;
  if old.release_state <> 'DRAFT'
     and new.manifest_sha256 is distinct from old.manifest_sha256 then
    raise exception 'active retrieval index manifest is immutable';
  end if;
  return new;
end;
$$;

create trigger protect_index_release_content_trigger
before update on retrieval.index_releases
for each row execute function retrieval.protect_index_release_content();

create function retrieval.build_index_manifest(p_index_release_id text)
returns jsonb
language sql
stable
set search_path = retrieval, policy, regulatory, public
as $$
  select jsonb_build_object(
    'schemaVersion', '1.0.0',
    'indexReleaseId', release.index_release_id,
    'policyDomain', release.policy_domain,
    'corpusReleaseId', release.corpus_release_id,
    'corpusReleaseKind', release.corpus_release_kind,
    'assuranceTier', release.assurance_tier,
    'asOf', release.as_of,
    'knowledgeCutoff', release.knowledge_cutoff,
    'freshThrough', release.fresh_through,
    'lexicalConfig', release.lexical_config,
    'vectorConfig', release.vector_config,
    'embeddingModel', release.embedding_model,
    'embeddingModelVersion', release.embedding_model_version,
    'embeddingDimensions', release.embedding_dimensions,
    'chunks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'ordinal', member.ordinal,
        'chunkId', chunk.chunk_id,
        'chunkChecksumSha256', chunk.chunk_checksum_sha256,
        'claimId', chunk.claim_id,
        'citationId', chunk.citation_id,
        'provisionId', chunk.provision_id,
        'sourceVersionId', chunk.source_version_id,
        'excerptPermission', chunk.excerpt_permission,
        'embeddingId', embedding.embedding_id,
        'embeddingChecksumSha256', embedding.embedding_checksum_sha256
      ) order by member.ordinal, chunk.chunk_id)
      from retrieval.index_release_chunks member
      join retrieval.evidence_chunks chunk on chunk.chunk_id = member.chunk_id
      join retrieval.embedding_records embedding
        on embedding.embedding_id = member.embedding_id
      where member.index_release_id = release.index_release_id
    ), '[]'::jsonb)
  )
  from retrieval.index_releases release
  where release.index_release_id = p_index_release_id;
$$;

create function policy.create_retrieval_index_release(
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
  if p_fresh_through < v_as_of then
    raise exception 'retrieval index freshness cannot predate corpus as_of';
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

create function policy.add_retrieval_index_chunk(
  p_index_release_id text,
  p_chunk_id text,
  p_claim_id text,
  p_citation_id text,
  p_provision_id text,
  p_source_version_id text,
  p_language_code text,
  p_chunk_text text,
  p_chunk_checksum_sha256 text,
  p_excerpt_permission text,
  p_embedding_id text,
  p_embedding_model text,
  p_embedding_model_version text,
  p_embedding_dimensions integer,
  p_embedding text,
  p_embedding_checksum_sha256 text,
  p_ordinal integer
)
returns jsonb
language plpgsql
security definer
set search_path = policy, retrieval, regulatory, public, extensions
as $$
declare
  v_release retrieval.index_releases%rowtype;
  v_member_exists boolean;
  v_vector extensions.vector;
  v_chunk retrieval.evidence_chunks%rowtype;
  v_embedding retrieval.embedding_records%rowtype;
begin
  select * into strict v_release
  from retrieval.index_releases
  where index_release_id = p_index_release_id
  for update;
  if v_release.release_state <> 'DRAFT' then
    raise exception 'retrieval index membership is frozen after activation';
  end if;
  if p_embedding_model <> v_release.embedding_model
     or p_embedding_model_version <> v_release.embedding_model_version
     or p_embedding_dimensions <> v_release.embedding_dimensions then
    raise exception 'embedding configuration does not match index release';
  end if;

  if v_release.corpus_release_kind = 'PROVISIONAL' then
    select exists (
      select 1 from policy.provisional_release_claims member
      where member.release_id = v_release.corpus_release_id
        and member.claim_id = p_claim_id
    ) into v_member_exists;
  else
    select exists (
      select 1 from policy.corpus_release_claims member
      where member.release_id = v_release.corpus_release_id
        and member.claim_id = p_claim_id
    ) into v_member_exists;
  end if;
  if not v_member_exists then
    raise exception 'claim is not a member of the pinned corpus release';
  end if;

  begin
    v_vector := p_embedding::extensions.vector;
  exception when others then
    raise exception 'invalid embedding vector';
  end;
  if extensions.vector_dims(v_vector) <> p_embedding_dimensions then
    raise exception 'embedding dimensions do not match index release';
  end if;

  select * into v_chunk
  from retrieval.evidence_chunks chunk
  where chunk.claim_id = p_claim_id
    and chunk.citation_id = p_citation_id
    and chunk.provision_id = p_provision_id
    and chunk.chunk_checksum_sha256 = p_chunk_checksum_sha256;
  if found then
    if v_chunk.source_version_id <> p_source_version_id
       or v_chunk.language_code <> p_language_code
       or v_chunk.chunk_text <> p_chunk_text
       or v_chunk.excerpt_permission <> p_excerpt_permission
       or not v_chunk.internal_search_allowed then
      raise exception 'existing retrieval chunk does not match immutable build input';
    end if;
  else
    insert into retrieval.evidence_chunks (
      chunk_id, claim_id, citation_id, provision_id, source_version_id,
      language_code, chunk_text, chunk_checksum_sha256,
      excerpt_permission, internal_search_allowed
    ) values (
      p_chunk_id, p_claim_id, p_citation_id, p_provision_id,
      p_source_version_id, p_language_code, p_chunk_text,
      p_chunk_checksum_sha256, p_excerpt_permission, true
    ) returning * into v_chunk;
  end if;

  select * into v_embedding
  from retrieval.embedding_records embedding
  where embedding.chunk_id = v_chunk.chunk_id
    and embedding.model_identifier = p_embedding_model
    and embedding.model_version = p_embedding_model_version
    and embedding.embedding_checksum_sha256 = p_embedding_checksum_sha256;
  if found then
    if v_embedding.dimensions <> p_embedding_dimensions
       or v_embedding.embedding::text <> v_vector::text then
      raise exception 'existing retrieval embedding does not match immutable build input';
    end if;
  else
    insert into retrieval.embedding_records (
      embedding_id, chunk_id, model_identifier, model_version, dimensions,
      embedding, embedding_checksum_sha256
    ) values (
      p_embedding_id, v_chunk.chunk_id, p_embedding_model,
      p_embedding_model_version, p_embedding_dimensions, v_vector,
      p_embedding_checksum_sha256
    ) returning * into v_embedding;
  end if;

  insert into retrieval.index_release_chunks (
    index_release_id, chunk_id, embedding_id, ordinal
  ) values (
    p_index_release_id, v_chunk.chunk_id, v_embedding.embedding_id, p_ordinal
  );

  return jsonb_build_object(
    'indexReleaseId', p_index_release_id,
    'chunkId', v_chunk.chunk_id,
    'embeddingId', v_embedding.embedding_id,
    'ordinal', p_ordinal
  );
end;
$$;

create function policy.activate_retrieval_index_release(
  p_index_release_id text,
  p_expected_manifest_sha256 text,
  p_activated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = policy, retrieval, regulatory, public, extensions
as $$
declare
  v_release retrieval.index_releases%rowtype;
  v_manifest jsonb;
  v_manifest_sha256 text;
  v_previous_id text;
begin
  select * into strict v_release
  from retrieval.index_releases
  where index_release_id = p_index_release_id
  for update;
  if v_release.release_state <> 'DRAFT' then
    raise exception 'only a DRAFT retrieval index can be activated';
  end if;
  if p_activated_at is null or p_activated_at < v_release.created_at then
    raise exception 'invalid retrieval index activation time';
  end if;
  if not exists (
    select 1 from retrieval.index_release_chunks member
    where member.index_release_id = p_index_release_id
  ) then
    raise exception 'retrieval index membership is empty';
  end if;

  v_manifest := retrieval.build_index_manifest(p_index_release_id);
  v_manifest_sha256 := encode(
    extensions.digest(convert_to(v_manifest::text, 'UTF8'), 'sha256'),
    'hex'
  );
  if p_expected_manifest_sha256 is distinct from v_manifest_sha256 then
    raise exception 'retrieval index manifest fingerprint is stale';
  end if;

  select pointer.active_index_release_id into v_previous_id
  from retrieval.active_index_pointers pointer
  where pointer.policy_domain = v_release.policy_domain
    and pointer.assurance_tier = v_release.assurance_tier
  for update;

  if v_previous_id is not null then
    update retrieval.index_releases
    set release_state = 'RETIRED', retired_at = p_activated_at
    where index_release_id = v_previous_id
      and release_state = 'ACTIVE';
  end if;
  update retrieval.index_releases
  set release_state = 'ACTIVE', manifest_sha256 = v_manifest_sha256,
      activated_at = p_activated_at, retired_at = null
  where index_release_id = p_index_release_id;

  insert into retrieval.active_index_pointers (
    policy_domain, assurance_tier, active_index_release_id,
    previous_index_release_id, updated_at
  ) values (
    v_release.policy_domain, v_release.assurance_tier,
    p_index_release_id, v_previous_id, p_activated_at
  ) on conflict (policy_domain, assurance_tier) do update
  set active_index_release_id = excluded.active_index_release_id,
      previous_index_release_id = excluded.previous_index_release_id,
      updated_at = excluded.updated_at;

  return jsonb_build_object(
    'indexReleaseId', p_index_release_id,
    'releaseState', 'ACTIVE',
    'manifestSha256', v_manifest_sha256,
    'previousIndexReleaseId', v_previous_id
  );
end;
$$;

create function policy.rollback_retrieval_index_release(
  p_policy_domain text,
  p_assurance_tier text,
  p_rolled_back_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = policy, retrieval, regulatory, public
as $$
declare
  v_pointer retrieval.active_index_pointers%rowtype;
  v_previous retrieval.index_releases%rowtype;
begin
  select * into strict v_pointer
  from retrieval.active_index_pointers
  where policy_domain = p_policy_domain
    and assurance_tier = p_assurance_tier
  for update;
  if v_pointer.previous_index_release_id is null then
    raise exception 'no previous retrieval index is available for rollback';
  end if;
  select * into strict v_previous
  from retrieval.index_releases
  where index_release_id = v_pointer.previous_index_release_id
  for update;
  if v_previous.release_state <> 'RETIRED'
     or v_previous.manifest_sha256 is null
     or p_rolled_back_at > v_previous.fresh_through then
    raise exception 'previous retrieval index is not rollback-eligible';
  end if;

  update retrieval.index_releases
  set release_state = 'RETIRED', retired_at = p_rolled_back_at
  where index_release_id = v_pointer.active_index_release_id;
  update retrieval.index_releases
  set release_state = 'ACTIVE', retired_at = null
  where index_release_id = v_pointer.previous_index_release_id;
  update retrieval.active_index_pointers
  set active_index_release_id = v_pointer.previous_index_release_id,
      previous_index_release_id = v_pointer.active_index_release_id,
      updated_at = p_rolled_back_at
  where policy_domain = p_policy_domain
    and assurance_tier = p_assurance_tier;

  return jsonb_build_object(
    'activeIndexReleaseId', v_pointer.previous_index_release_id,
    'previousIndexReleaseId', v_pointer.active_index_release_id,
    'rolledBackAt', p_rolled_back_at
  );
end;
$$;

alter table retrieval.evidence_chunks enable row level security;
alter table retrieval.embedding_records enable row level security;
alter table retrieval.index_releases enable row level security;
alter table retrieval.index_release_chunks enable row level security;
alter table retrieval.active_index_pointers enable row level security;
alter table retrieval.rag_retrieval_runs enable row level security;

revoke all on all tables in schema retrieval
from public, anon, authenticated, service_role;
grant select on all tables in schema retrieval to service_role;

revoke all on function retrieval.build_index_manifest(text)
from public, anon, authenticated;
grant execute on function retrieval.build_index_manifest(text) to service_role;

revoke all on function policy.create_retrieval_index_release(
  text, text, text, text, timestamptz, jsonb, jsonb, text, text, integer
) from public, anon, authenticated;
grant execute on function policy.create_retrieval_index_release(
  text, text, text, text, timestamptz, jsonb, jsonb, text, text, integer
) to service_role;

revoke all on function policy.add_retrieval_index_chunk(
  text, text, text, text, text, text, text, text, text, text,
  text, text, text, integer, text, text, integer
) from public, anon, authenticated;
grant execute on function policy.add_retrieval_index_chunk(
  text, text, text, text, text, text, text, text, text, text,
  text, text, text, integer, text, text, integer
) to service_role;

revoke all on function policy.activate_retrieval_index_release(
  text, text, timestamptz
) from public, anon, authenticated;
grant execute on function policy.activate_retrieval_index_release(
  text, text, timestamptz
) to service_role;

revoke all on function policy.rollback_retrieval_index_release(
  text, text, timestamptz
) from public, anon, authenticated;
grant execute on function policy.rollback_retrieval_index_release(
  text, text, timestamptz
) to service_role;

comment on schema retrieval is
  'Cross-domain, service-only Evidence RAG chunks, embeddings, immutable index releases, and retrieval audit.';
comment on table retrieval.rag_retrieval_runs is
  'Immutable retrieval audit. Optional deterministic decision fingerprints must be identical before and after RAG.';
comment on function policy.activate_retrieval_index_release is
  'Atomically verifies an exact manifest, retires the prior active index, and moves the active pointer; it cannot mutate legal or decision state.';

commit;
