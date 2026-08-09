-- Service-only query and audit boundary for Phase 3 Evidence RAG.
-- PostgREST does not need to expose the private `retrieval` schema: the
-- application calls these fixed-search-path policy RPCs through the existing
-- provider-neutral Supabase client.

begin;

create function policy.resolve_retrieval_index_release(
  p_policy_domain text,
  p_requested_assurance_tier text,
  p_corpus_release_id text default null,
  p_index_release_id text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = policy, retrieval, public
as $$
declare
  v_release retrieval.index_releases%rowtype;
begin
  if p_policy_domain !~ '^[a-z][a-z0-9-]{2,40}$'
     or p_requested_assurance_tier not in ('PROVISIONAL', 'HUMAN_REVIEWED') then
    raise exception 'invalid retrieval index selector';
  end if;

  if p_index_release_id is not null then
    select * into v_release
    from retrieval.index_releases release
    where release.index_release_id = p_index_release_id
      and release.policy_domain = p_policy_domain
      and release.release_state in ('ACTIVE', 'RETIRED')
      and (
        p_corpus_release_id is null
        or release.corpus_release_id = p_corpus_release_id
      );
  else
    select release.* into v_release
    from retrieval.active_index_pointers pointer
    join retrieval.index_releases release
      on release.index_release_id = pointer.active_index_release_id
    where pointer.policy_domain = p_policy_domain
      and pointer.assurance_tier = p_requested_assurance_tier
      and release.release_state = 'ACTIVE'
      and (
        p_corpus_release_id is null
        or release.corpus_release_id = p_corpus_release_id
      );
  end if;
  if v_release.index_release_id is null then
    return null;
  end if;

  return jsonb_build_object(
    'indexReleaseId', v_release.index_release_id,
    'corpusReleaseId', v_release.corpus_release_id,
    'assuranceTier', v_release.assurance_tier,
    'asOf', v_release.as_of,
    'knowledgeCutoff', v_release.knowledge_cutoff,
    'generatedAt', v_release.activated_at,
    'freshThrough', v_release.fresh_through,
    'embeddingModel', v_release.embedding_model,
    'embeddingModelVersion', v_release.embedding_model_version,
    'embeddingDimensions', v_release.embedding_dimensions,
    'lexicalConfigVersion', coalesce(v_release.lexical_config->>'version', 'unknown'),
    'vectorConfigVersion', coalesce(v_release.vector_config->>'version', 'unknown')
  );
end;
$$;

create function policy.list_retrieval_index_chunks(p_index_release_id text)
returns jsonb
language sql
stable
security definer
set search_path = policy, retrieval, regulatory, public, extensions
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'chunkId', chunk.chunk_id,
    'indexReleaseId', release.index_release_id,
    'corpusReleaseId', release.corpus_release_id,
    'claimId', claim.claim_id,
    'citationId', citation.citation_id,
    'provisionId', provision.provision_id,
    'sourceVersionId', version.version_id,
    'sourceVersionChecksumSha256', version.checksum_sha256,
    'sourceDocumentId', document.document_id,
    'documentTitle', document.title,
    'sourceType', document.document_type,
    'authorityId', authority.authority_id,
    'authorityName', authority.name,
    'jurisdictionCode', claim.jurisdiction_code,
    'topic', claim.topic,
    'supportRelation', citation.support_relation,
    'legalStatus', claim.legal_status,
    'proposition', claim.proposition,
    'locator', citation.exact_locator,
    'canonicalUrl', version.official_url,
    'languageCode', chunk.language_code,
    'effectiveFrom', claim.effective_from,
    'effectiveTo', claim.effective_to,
    'sourcePublishedAt', version.published_at,
    'sourceRetrievedAt', version.retrieved_at,
    'assuranceTier', release.assurance_tier,
    'reviewStatus', case release.assurance_tier
      when 'HUMAN_REVIEWED' then 'HUMAN_REVIEWED'
      else 'PROVISIONAL'
    end,
    'internalSearchAllowed', chunk.internal_search_allowed,
    'excerptPermission', chunk.excerpt_permission,
    'excerpt', case
      when chunk.excerpt_permission = 'ALLOWED'
        then coalesce(citation.allowed_excerpt, chunk.chunk_text)
      else null
    end,
    'searchText', chunk.chunk_text,
    'embedding', embedding.embedding::text
  ) order by member.ordinal, chunk.chunk_id), '[]'::jsonb)
  from retrieval.index_releases release
  join retrieval.index_release_chunks member
    on member.index_release_id = release.index_release_id
  join retrieval.evidence_chunks chunk on chunk.chunk_id = member.chunk_id
  join retrieval.embedding_records embedding
    on embedding.embedding_id = member.embedding_id
  join policy.legal_claims claim on claim.claim_id = chunk.claim_id
  join policy.citations citation on citation.citation_id = chunk.citation_id
  join regulatory.provisions provision
    on provision.provision_id = chunk.provision_id
  join regulatory.source_versions version
    on version.version_id = chunk.source_version_id
  join regulatory.source_documents document
    on document.document_id = version.document_id
  join regulatory.source_authorities authority
    on authority.authority_id = document.authority_id
  where release.index_release_id = p_index_release_id
    and release.release_state in ('ACTIVE', 'RETIRED');
$$;

create function policy.record_rag_retrieval_run(
  p_run_id text,
  p_policy_domain text,
  p_query_sha256 text,
  p_filters jsonb,
  p_requested_assurance_tier text,
  p_index_release_id text,
  p_corpus_release_id text,
  p_outcome text,
  p_ranked_chunk_ids text[],
  p_result_sha256 text,
  p_deterministic_decision_before_sha256 text default null,
  p_deterministic_decision_after_sha256 text default null
)
returns jsonb
language plpgsql
security definer
set search_path = policy, retrieval, public
as $$
declare
  v_ranked_hits jsonb;
begin
  if jsonb_typeof(p_filters) <> 'object' then
    raise exception 'retrieval run filters must be an object';
  end if;
  if p_ranked_chunk_ids is null then
    raise exception 'retrieval run ranked chunk ids must be an array';
  end if;
  if p_outcome = 'SUCCESS' and (
    p_index_release_id is null or cardinality(p_ranked_chunk_ids) = 0
  ) then
    raise exception 'successful retrieval run requires a pinned index and hits';
  end if;
  if p_index_release_id is null and cardinality(p_ranked_chunk_ids) > 0 then
    raise exception 'unpinned retrieval run cannot contain hits';
  end if;
  if p_index_release_id is not null and not exists (
    select 1 from retrieval.index_releases release
    where release.index_release_id = p_index_release_id
      and release.policy_domain = p_policy_domain
      and release.corpus_release_id = p_corpus_release_id
      and release.release_state in ('ACTIVE', 'RETIRED')
  ) then
    raise exception 'retrieval run index/corpus pin is invalid';
  end if;
  if exists (
    select 1
    from unnest(p_ranked_chunk_ids) as ranked(candidate_chunk_id)
    where not exists (
      select 1 from retrieval.index_release_chunks member
      where member.index_release_id = p_index_release_id
        and member.chunk_id = ranked.candidate_chunk_id
    )
  ) then
    raise exception 'retrieval run contains a chunk outside the pinned index';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'rank', ranked.ordinality,
    'chunkId', ranked.chunk_id
  ) order by ranked.ordinality), '[]'::jsonb)
  into v_ranked_hits
  from unnest(p_ranked_chunk_ids) with ordinality ranked(chunk_id, ordinality);

  insert into retrieval.rag_retrieval_runs (
    run_id, policy_domain, query_sha256, filters,
    requested_assurance_tier, index_release_id, corpus_release_id,
    outcome, ranked_hits, result_sha256,
    deterministic_decision_before_sha256,
    deterministic_decision_after_sha256
  ) values (
    p_run_id, p_policy_domain, p_query_sha256, p_filters,
    p_requested_assurance_tier, p_index_release_id, p_corpus_release_id,
    p_outcome, v_ranked_hits, p_result_sha256,
    p_deterministic_decision_before_sha256,
    p_deterministic_decision_after_sha256
  );

  return jsonb_build_object(
    'runId', p_run_id,
    'outcome', p_outcome,
    'indexReleaseId', p_index_release_id,
    'rankedHitCount', cardinality(p_ranked_chunk_ids)
  );
end;
$$;

revoke all on function policy.resolve_retrieval_index_release(
  text, text, text, text
) from public, anon, authenticated;
grant execute on function policy.resolve_retrieval_index_release(
  text, text, text, text
) to service_role;

revoke all on function policy.list_retrieval_index_chunks(text)
from public, anon, authenticated;
grant execute on function policy.list_retrieval_index_chunks(text)
to service_role;

revoke all on function policy.record_rag_retrieval_run(
  text, text, text, jsonb, text, text, text, text, text[], text, text, text
) from public, anon, authenticated;
grant execute on function policy.record_rag_retrieval_run(
  text, text, text, jsonb, text, text, text, text, text[], text, text, text
) to service_role;

comment on function policy.resolve_retrieval_index_release is
  'Service-only resolution of the active or explicitly pinned immutable retrieval index; returns no private rules or customer data.';
comment on function policy.list_retrieval_index_chunks is
  'Service-only, presentation-safe retrieval input with exact citation metadata; LINK_ONLY excerpts remain null.';
comment on function policy.record_rag_retrieval_run is
  'Appends an immutable pinned retrieval audit and rejects cross-index hits or any changed deterministic decision fingerprint.';

commit;
