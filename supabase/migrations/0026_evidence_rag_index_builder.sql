-- Default-dry-run Evidence RAG index-builder boundary.
--
-- The application reads an assurance-pinned corpus through a fixed RPC,
-- generates embeddings outside PostgreSQL, then submits the whole build plan
-- through one transactional RPC. A successful build creates only a DRAFT
-- index. Activation remains a separate exact-manifest operation.

begin;

create table retrieval.index_build_records (
  index_release_id text primary key
    references retrieval.index_releases(index_release_id),
  plan_sha256 text not null check (plan_sha256 ~ '^[0-9a-f]{64}$'),
  built_at timestamptz not null default now()
);

create trigger protect_index_build_record_trigger
before update or delete on retrieval.index_build_records
for each row execute function regulatory.reject_immutable_row_change();

alter table retrieval.index_build_records enable row level security;
revoke all on retrieval.index_build_records
from public, anon, authenticated, service_role;
grant select on retrieval.index_build_records to service_role;

create function policy.get_retrieval_index_build_input(
  p_policy_domain text,
  p_corpus_release_id text,
  p_corpus_release_kind text
)
returns jsonb
language sql
stable
security definer
set search_path = policy, regulatory, public
as $$
  with selected_release as (
    select
      release.release_id,
      'PROVISIONAL'::text as release_kind,
      release.jurisdiction_code,
      release.as_of,
      release.knowledge_cutoff,
      release.manifest_sha256,
      release.published_at
    from policy.provisional_corpus_releases release
    where p_policy_domain = 'stablecoin'
      and p_corpus_release_kind = 'PROVISIONAL'
      and release.release_id = p_corpus_release_id
    union all
    select
      release.release_id,
      'HUMAN_REVIEWED'::text,
      null::text,
      release.as_of,
      release.knowledge_cutoff,
      release.manifest_checksum_sha256,
      release.published_at
    from policy.corpus_releases release
    where p_policy_domain = 'stablecoin'
      and p_corpus_release_kind = 'HUMAN_REVIEWED'
      and release.release_id = p_corpus_release_id
      and release.release_state = 'PUBLISHED'
  ), selected_members as (
    select member.claim_id
    from policy.provisional_release_claims member
    where p_corpus_release_kind = 'PROVISIONAL'
      and member.release_id = p_corpus_release_id
    union all
    select member.claim_id
    from policy.corpus_release_claims member
    where p_corpus_release_kind = 'HUMAN_REVIEWED'
      and member.release_id = p_corpus_release_id
  ), member_claims as (
    select claim.*
    from selected_members member
    join policy.legal_claims claim on claim.claim_id = member.claim_id
    where claim.policy_domain = p_policy_domain
  ), release_scope as (
    select
      release.*,
      coalesce(
        release.jurisdiction_code,
        case when count(distinct claim.jurisdiction_code) = 1
          then min(claim.jurisdiction_code) end
      ) as resolved_jurisdiction_code
    from selected_release release
    left join member_claims claim on true
    group by release.release_id, release.release_kind,
      release.jurisdiction_code, release.as_of, release.knowledge_cutoff,
      release.manifest_sha256, release.published_at
  )
  select jsonb_build_object(
    'schemaVersion', '1.0.0',
    'policyDomain', p_policy_domain,
    'corpusReleaseId', scope.release_id,
    'corpusReleaseKind', scope.release_kind,
    'assuranceTier', scope.release_kind,
    'jurisdictionCode', scope.resolved_jurisdiction_code,
    'asOf', scope.as_of,
    'knowledgeCutoff', scope.knowledge_cutoff,
    'releaseManifestSha256', scope.manifest_sha256,
    'claimIds', coalesce((
      select jsonb_agg(claim.claim_id order by claim.claim_id)
      from member_claims claim
    ), '[]'::jsonb),
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object(
        'claimId', claim.claim_id,
        'citationId', citation.citation_id,
        'provisionId', provision.provision_id,
        'sourceVersionId', version.version_id,
        'sourceVersionChecksumSha256', version.checksum_sha256,
        'jurisdictionCode', claim.jurisdiction_code,
        'languageCode', provision.language_code,
        'supportRelation', citation.support_relation,
        'locator', citation.exact_locator,
        'provisionText', case
          when version.storage_rights = 'ALLOWED'
            and version.rights_reviewed_at is not null
            and nullif(btrim(version.rights_basis), '') is not null
          then provision.provision_text
          else null
        end,
        'storageRights', version.storage_rights,
        'rightsReviewedAt', version.rights_reviewed_at,
        'rightsBasis', version.rights_basis,
        'excerptPermission', coalesce(
          rights_review.excerpt_permission,
          provision.excerpt_permission
        ),
        'internalSearchAllowed',
          version.storage_rights = 'ALLOWED'
          and version.rights_reviewed_at is not null
          and nullif(btrim(version.rights_basis), '') is not null
      ) order by claim.claim_id, citation.citation_id,
        provision.provision_id, version.version_id)
      from member_claims claim
      join policy.citations citation on citation.claim_id = claim.claim_id
      join regulatory.provisions provision
        on provision.provision_id = citation.provision_id
      join regulatory.source_versions version
        on version.version_id = provision.version_id
      left join regulatory.provision_rights_reviews rights_review
        on rights_review.provision_id = provision.provision_id
    ), '[]'::jsonb)
  )
  from release_scope scope;
$$;

create function policy.get_retrieval_index_manifest(p_index_release_id text)
returns jsonb
language sql
stable
security definer
set search_path = policy, retrieval, public, extensions
as $$
  select jsonb_build_object(
    'indexReleaseId', release.index_release_id,
    'releaseState', release.release_state,
    'manifest', manifest.value,
    'manifestSha256', encode(
      extensions.digest(convert_to(manifest.value::text, 'UTF8'), 'sha256'),
      'hex'
    )
  )
  from retrieval.index_releases release
  cross join lateral (
    select retrieval.build_index_manifest(release.index_release_id) as value
  ) manifest
  where release.index_release_id = p_index_release_id;
$$;

create function policy.build_retrieval_index_release(p_plan jsonb)
returns jsonb
language plpgsql
security definer
set search_path = policy, retrieval, regulatory, public, extensions
as $$
declare
  v_index_release_id text := p_plan->>'indexReleaseId';
  v_plan_sha256 text;
  v_existing_sha256 text;
  v_chunk jsonb;
  v_chunk_count integer;
begin
  if jsonb_typeof(p_plan) <> 'object'
     or p_plan->>'schemaVersion' <> '1.0.0'
     or jsonb_typeof(p_plan->'lexicalConfig') <> 'object'
     or jsonb_typeof(p_plan->'vectorConfig') <> 'object'
     or jsonb_typeof(p_plan->'chunks') <> 'array' then
    raise exception 'retrieval index build plan shape is invalid';
  end if;
  v_chunk_count := jsonb_array_length(p_plan->'chunks');
  if v_chunk_count = 0 then
    raise exception 'retrieval index build plan membership is empty';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_plan->'chunks') chunk
    where jsonb_typeof(chunk) <> 'object'
  ) then
    raise exception 'retrieval index build plan chunk shape is invalid';
  end if;
  if (
    select count(distinct (chunk->>'citationId'))
    from jsonb_array_elements(p_plan->'chunks') chunk
  ) <> v_chunk_count then
    raise exception 'retrieval index build plan citations must be unique';
  end if;
  if (
    select count(distinct (chunk->>'ordinal')::integer)
    from jsonb_array_elements(p_plan->'chunks') chunk
  ) <> v_chunk_count
     or (
       select min((chunk->>'ordinal')::integer)
       from jsonb_array_elements(p_plan->'chunks') chunk
     ) <> 0
     or (
       select max((chunk->>'ordinal')::integer)
       from jsonb_array_elements(p_plan->'chunks') chunk
     ) <> v_chunk_count - 1 then
    raise exception 'retrieval index build plan ordinals are invalid';
  end if;

  v_plan_sha256 := encode(
    extensions.digest(convert_to(p_plan::text, 'UTF8'), 'sha256'),
    'hex'
  );
  select record.plan_sha256 into v_existing_sha256
  from retrieval.index_build_records record
  where record.index_release_id = v_index_release_id;
  if v_existing_sha256 is not null then
    if v_existing_sha256 <> v_plan_sha256 then
      raise exception 'retrieval index identifier was already used for a different plan';
    end if;
    return policy.get_retrieval_index_manifest(v_index_release_id);
  end if;
  if exists (
    select 1 from retrieval.index_releases release
    where release.index_release_id = v_index_release_id
  ) then
    raise exception 'retrieval index identifier already exists outside the builder';
  end if;

  perform policy.create_retrieval_index_release(
    v_index_release_id,
    p_plan->>'policyDomain',
    p_plan->>'corpusReleaseId',
    p_plan->>'corpusReleaseKind',
    (p_plan->>'freshThrough')::timestamptz,
    p_plan->'lexicalConfig',
    p_plan->'vectorConfig',
    p_plan->>'embeddingModel',
    p_plan->>'embeddingModelVersion',
    (p_plan->>'embeddingDimensions')::integer
  );

  for v_chunk in
    select value from jsonb_array_elements(p_plan->'chunks')
  loop
    perform policy.add_retrieval_index_chunk(
      v_index_release_id,
      v_chunk->>'chunkId',
      v_chunk->>'claimId',
      v_chunk->>'citationId',
      v_chunk->>'provisionId',
      v_chunk->>'sourceVersionId',
      v_chunk->>'languageCode',
      v_chunk->>'chunkText',
      v_chunk->>'chunkChecksumSha256',
      v_chunk->>'excerptPermission',
      v_chunk->>'embeddingId',
      v_chunk->>'embeddingModel',
      v_chunk->>'embeddingModelVersion',
      (v_chunk->>'embeddingDimensions')::integer,
      (v_chunk->'embedding')::text,
      v_chunk->>'embeddingChecksumSha256',
      (v_chunk->>'ordinal')::integer
    );
  end loop;

  insert into retrieval.index_build_records (
    index_release_id, plan_sha256
  ) values (v_index_release_id, v_plan_sha256);

  return policy.get_retrieval_index_manifest(v_index_release_id);
end;
$$;

revoke all on function policy.get_retrieval_index_build_input(text, text, text)
from public, anon, authenticated;
grant execute on function policy.get_retrieval_index_build_input(text, text, text)
to service_role;

revoke all on function policy.get_retrieval_index_manifest(text)
from public, anon, authenticated;
grant execute on function policy.get_retrieval_index_manifest(text)
to service_role;

revoke all on function policy.build_retrieval_index_release(jsonb)
from public, anon, authenticated;
grant execute on function policy.build_retrieval_index_release(jsonb)
to service_role;

comment on table retrieval.index_build_records is
  'Immutable idempotency record for an atomic Evidence RAG build plan; stores no private rule or customer data.';
comment on function policy.get_retrieval_index_build_input is
  'Service-only assurance-pinned claim/citation/provision input for a retrieval index builder; rights-blocked provision text is returned as null.';
comment on function policy.build_retrieval_index_release is
  'Atomically and idempotently creates a DRAFT retrieval index from one exact build plan; never activates an index or mutates legal/decision state.';

commit;
