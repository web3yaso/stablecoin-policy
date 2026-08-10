-- Immutable aggregate corpus snapshots and assurance-aware activation evals.
--
-- A snapshot pins one or more source corpus releases and their deduplicated
-- claim membership. Index activation additionally requires a passing eval for
-- the exact server manifest. Existing DRAFT indexes therefore remain inactive
-- until explicitly evaluated.

begin;

create table retrieval.corpus_snapshots (
  snapshot_id text primary key
    check (snapshot_id ~ '^[a-z0-9][a-z0-9._:-]{2,200}$'),
  policy_domain text not null
    check (policy_domain ~ '^[a-z][a-z0-9-]{2,40}$'),
  corpus_release_kind text not null
    check (corpus_release_kind in ('PROVISIONAL', 'HUMAN_REVIEWED')),
  assurance_tier text not null
    check (assurance_tier = corpus_release_kind),
  jurisdiction_code text,
  as_of timestamptz not null,
  knowledge_cutoff timestamptz not null,
  manifest jsonb not null check (jsonb_typeof(manifest) = 'object'),
  manifest_sha256 text not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  source_release_count integer not null check (source_release_count > 0),
  claim_count integer not null check (claim_count > 0),
  created_at timestamptz not null default now(),
  check (corpus_release_kind = 'PROVISIONAL' or knowledge_cutoff >= as_of)
);

create table retrieval.corpus_snapshot_releases (
  snapshot_id text not null references retrieval.corpus_snapshots(snapshot_id),
  source_release_id text not null,
  source_release_manifest_sha256 text not null
    check (source_release_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  ordinal integer not null check (ordinal >= 0),
  primary key (snapshot_id, source_release_id),
  unique (snapshot_id, ordinal)
);

create table retrieval.corpus_snapshot_claims (
  snapshot_id text not null references retrieval.corpus_snapshots(snapshot_id),
  claim_id text not null references policy.legal_claims(claim_id),
  ordinal integer not null check (ordinal >= 0),
  primary key (snapshot_id, claim_id),
  unique (snapshot_id, ordinal)
);

create table retrieval.index_eval_records (
  eval_record_id text primary key
    check (eval_record_id ~ '^[a-z0-9][a-z0-9._:-]{2,200}$'),
  index_release_id text not null references retrieval.index_releases(index_release_id),
  manifest_sha256 text not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  eval_assurance text not null
    check (eval_assurance in ('MACHINE_ASSURED', 'HUMAN_REVIEWED')),
  outcome text not null check (outcome in ('PASSED', 'FAILED')),
  artifact_sha256 text not null check (artifact_sha256 ~ '^[0-9a-f]{64}$'),
  metrics jsonb not null check (jsonb_typeof(metrics) = 'object'),
  evaluated_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  unique (index_release_id, manifest_sha256, artifact_sha256)
);

create trigger protect_corpus_snapshot_trigger
before update or delete on retrieval.corpus_snapshots
for each row execute function regulatory.reject_immutable_row_change();
create trigger protect_corpus_snapshot_release_trigger
before update or delete on retrieval.corpus_snapshot_releases
for each row execute function regulatory.reject_immutable_row_change();
create trigger protect_corpus_snapshot_claim_trigger
before update or delete on retrieval.corpus_snapshot_claims
for each row execute function regulatory.reject_immutable_row_change();
create trigger protect_index_eval_record_trigger
before update or delete on retrieval.index_eval_records
for each row execute function regulatory.reject_immutable_row_change();

create function retrieval.validate_snapshot_index_build()
returns trigger
language plpgsql
set search_path = retrieval, policy, public
as $$
declare
  v_snapshot_id text;
  v_expected_citations integer;
  v_actual_citations integer;
begin
  select release.corpus_release_id into v_snapshot_id
  from retrieval.index_releases release
  join retrieval.corpus_snapshots snapshot
    on snapshot.snapshot_id = release.corpus_release_id
  where release.index_release_id = new.index_release_id;
  if v_snapshot_id is null then return new; end if;

  select count(*) into v_expected_citations
  from retrieval.corpus_snapshot_claims member
  join policy.citations citation on citation.claim_id = member.claim_id
  where member.snapshot_id = v_snapshot_id;
  select count(*) into v_actual_citations
  from retrieval.index_release_chunks member
  where member.index_release_id = new.index_release_id;
  if v_expected_citations = 0 or v_actual_citations <> v_expected_citations
     or exists (
       select citation.citation_id
       from retrieval.corpus_snapshot_claims snapshot_member
       join policy.citations citation on citation.claim_id = snapshot_member.claim_id
       where snapshot_member.snapshot_id = v_snapshot_id
       except
       select chunk.citation_id
       from retrieval.index_release_chunks index_member
       join retrieval.evidence_chunks chunk on chunk.chunk_id = index_member.chunk_id
       where index_member.index_release_id = new.index_release_id
     ) or exists (
       select chunk.citation_id
       from retrieval.index_release_chunks index_member
       join retrieval.evidence_chunks chunk on chunk.chunk_id = index_member.chunk_id
       where index_member.index_release_id = new.index_release_id
       except
       select citation.citation_id
       from retrieval.corpus_snapshot_claims snapshot_member
       join policy.citations citation on citation.claim_id = snapshot_member.claim_id
       where snapshot_member.snapshot_id = v_snapshot_id
     ) then
    raise exception 'snapshot index build membership is incomplete or changed';
  end if;
  return new;
end;
$$;

create trigger validate_snapshot_index_build_trigger
before insert on retrieval.index_build_records
for each row execute function retrieval.validate_snapshot_index_build();

alter table retrieval.corpus_snapshots enable row level security;
alter table retrieval.corpus_snapshot_releases enable row level security;
alter table retrieval.corpus_snapshot_claims enable row level security;
alter table retrieval.index_eval_records enable row level security;

revoke all on retrieval.corpus_snapshots, retrieval.corpus_snapshot_releases,
  retrieval.corpus_snapshot_claims, retrieval.index_eval_records
from public, anon, authenticated, service_role;
grant select on retrieval.corpus_snapshots, retrieval.corpus_snapshot_releases,
  retrieval.corpus_snapshot_claims, retrieval.index_eval_records
to service_role;

create function policy.prepare_retrieval_corpus_snapshot(
  p_snapshot_id text,
  p_policy_domain text,
  p_corpus_release_kind text,
  p_source_release_ids text[]
)
returns jsonb
language plpgsql
stable
security definer
set search_path = policy, retrieval, public, extensions
as $$
declare
  v_release_count integer;
  v_expected_count integer;
  v_claim_count integer;
  v_jurisdiction text;
  v_as_of timestamptz;
  v_knowledge_cutoff timestamptz;
  v_releases jsonb;
  v_claim_ids jsonb;
  v_manifest jsonb;
begin
  if p_snapshot_id !~ '^[a-z0-9][a-z0-9._:-]{2,200}$'
     or p_policy_domain <> 'stablecoin'
     or p_corpus_release_kind not in ('PROVISIONAL', 'HUMAN_REVIEWED') then
    raise exception 'invalid retrieval corpus snapshot request';
  end if;
  select count(distinct release_id), count(*)
  into v_expected_count, v_release_count
  from unnest(p_source_release_ids) release_id;
  if v_release_count = 0 or v_release_count <> v_expected_count then
    raise exception 'source release identifiers must be non-empty and unique';
  end if;

  if p_corpus_release_kind = 'PROVISIONAL' then
    select count(*),
      case when count(distinct release.jurisdiction_code) = 1
        then min(release.jurisdiction_code) end,
      max(release.as_of), max(release.knowledge_cutoff),
      jsonb_agg(jsonb_build_object(
        'sourceReleaseId', release.release_id,
        'manifestSha256', release.manifest_sha256
      ) order by release.release_id)
    into v_release_count, v_jurisdiction, v_as_of, v_knowledge_cutoff, v_releases
    from policy.provisional_corpus_releases release
    where release.release_id = any(p_source_release_ids);

    select count(*), jsonb_agg(member.claim_id order by member.claim_id)
    into v_claim_count, v_claim_ids
    from (
      select distinct membership.claim_id
      from policy.provisional_release_claims membership
      where membership.release_id = any(p_source_release_ids)
    ) member;
  else
    select count(*), max(release.as_of), max(release.knowledge_cutoff),
      jsonb_agg(jsonb_build_object(
        'sourceReleaseId', release.release_id,
        'manifestSha256', release.manifest_checksum_sha256
      ) order by release.release_id)
    into v_release_count, v_as_of, v_knowledge_cutoff, v_releases
    from policy.corpus_releases release
    where release.release_id = any(p_source_release_ids)
      and release.release_state = 'PUBLISHED';

    select count(*), jsonb_agg(member.claim_id order by member.claim_id)
    into v_claim_count, v_claim_ids
    from (
      select distinct membership.claim_id
      from policy.corpus_release_claims membership
      where membership.release_id = any(p_source_release_ids)
    ) member;

    select case when count(distinct claim.jurisdiction_code) = 1
      then min(claim.jurisdiction_code) end
    into v_jurisdiction
    from policy.legal_claims claim
    where claim.claim_id in (
      select membership.claim_id
      from policy.corpus_release_claims membership
      where membership.release_id = any(p_source_release_ids)
    );
  end if;

  if v_release_count <> v_expected_count then
    raise exception 'one or more eligible source releases do not exist';
  end if;
  if v_jurisdiction is null then
    raise exception 'snapshot source releases must resolve to one jurisdiction';
  end if;
  if coalesce(v_claim_count, 0) = 0 then
    raise exception 'snapshot claim membership is empty';
  end if;

  v_manifest := jsonb_build_object(
    'schemaVersion', '1.0.0',
    'snapshotId', p_snapshot_id,
    'policyDomain', p_policy_domain,
    'corpusReleaseKind', p_corpus_release_kind,
    'assuranceTier', p_corpus_release_kind,
    'jurisdictionCode', v_jurisdiction,
    'asOf', v_as_of,
    'knowledgeCutoff', v_knowledge_cutoff,
    'sourceReleases', v_releases,
    'claimIds', v_claim_ids
  );
  return jsonb_build_object(
    'snapshotId', p_snapshot_id,
    'manifest', v_manifest,
    'manifestSha256', encode(
      extensions.digest(convert_to(v_manifest::text, 'UTF8'), 'sha256'), 'hex'
    ),
    'sourceReleaseCount', v_release_count,
    'claimCount', v_claim_count
  );
end;
$$;

create function policy.create_retrieval_corpus_snapshot(
  p_snapshot_id text,
  p_policy_domain text,
  p_corpus_release_kind text,
  p_source_release_ids text[],
  p_expected_manifest_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = policy, retrieval, public
as $$
declare
  v_prepared jsonb;
  v_manifest jsonb;
  v_existing_sha text;
begin
  v_prepared := policy.prepare_retrieval_corpus_snapshot(
    p_snapshot_id, p_policy_domain, p_corpus_release_kind, p_source_release_ids
  );
  if p_expected_manifest_sha256 is distinct from v_prepared->>'manifestSha256' then
    raise exception 'retrieval corpus snapshot fingerprint is stale';
  end if;
  select manifest_sha256 into v_existing_sha
  from retrieval.corpus_snapshots where snapshot_id = p_snapshot_id;
  if v_existing_sha is not null then
    if v_existing_sha <> p_expected_manifest_sha256 then
      raise exception 'retrieval corpus snapshot identifier was already used';
    end if;
    return v_prepared;
  end if;
  v_manifest := v_prepared->'manifest';
  insert into retrieval.corpus_snapshots (
    snapshot_id, policy_domain, corpus_release_kind, assurance_tier,
    jurisdiction_code, as_of, knowledge_cutoff, manifest, manifest_sha256,
    source_release_count, claim_count
  ) values (
    p_snapshot_id, p_policy_domain, p_corpus_release_kind, p_corpus_release_kind,
    v_manifest->>'jurisdictionCode', (v_manifest->>'asOf')::timestamptz,
    (v_manifest->>'knowledgeCutoff')::timestamptz, v_manifest,
    p_expected_manifest_sha256, (v_prepared->>'sourceReleaseCount')::integer,
    (v_prepared->>'claimCount')::integer
  );
  insert into retrieval.corpus_snapshot_releases (
    snapshot_id, source_release_id, source_release_manifest_sha256, ordinal
  )
  select p_snapshot_id, value->>'sourceReleaseId', value->>'manifestSha256', ordinality - 1
  from jsonb_array_elements(v_manifest->'sourceReleases') with ordinality;
  insert into retrieval.corpus_snapshot_claims (snapshot_id, claim_id, ordinal)
  select p_snapshot_id, value #>> '{}', ordinality - 1
  from jsonb_array_elements(v_manifest->'claimIds') with ordinality;
  return v_prepared;
end;
$$;

create function policy.get_retrieval_snapshot_build_input(p_snapshot_id text)
returns jsonb
language sql
stable
security definer
set search_path = policy, retrieval, regulatory, public
as $$
  select jsonb_build_object(
    'schemaVersion', '1.0.0',
    'policyDomain', snapshot.policy_domain,
    'corpusReleaseId', snapshot.snapshot_id,
    'corpusReleaseKind', snapshot.corpus_release_kind,
    'assuranceTier', snapshot.assurance_tier,
    'jurisdictionCode', snapshot.jurisdiction_code,
    'asOf', snapshot.as_of,
    'knowledgeCutoff', snapshot.knowledge_cutoff,
    'releaseManifestSha256', snapshot.manifest_sha256,
    'claimIds', coalesce((
      select jsonb_agg(member.claim_id order by member.ordinal)
      from retrieval.corpus_snapshot_claims member
      where member.snapshot_id = snapshot.snapshot_id
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
        'provisionText', case when version.storage_rights = 'ALLOWED'
          and version.rights_reviewed_at is not null
          and nullif(btrim(version.rights_basis), '') is not null
          then provision.provision_text else null end,
        'storageRights', version.storage_rights,
        'rightsReviewedAt', version.rights_reviewed_at,
        'rightsBasis', version.rights_basis,
        'excerptPermission', coalesce(rights.excerpt_permission, provision.excerpt_permission),
        'internalSearchAllowed', version.storage_rights = 'ALLOWED'
          and version.rights_reviewed_at is not null
          and nullif(btrim(version.rights_basis), '') is not null
      ) order by claim.claim_id, citation.citation_id,
        provision.provision_id, version.version_id)
      from retrieval.corpus_snapshot_claims member
      join policy.legal_claims claim on claim.claim_id = member.claim_id
      join policy.citations citation on citation.claim_id = claim.claim_id
      join regulatory.provisions provision on provision.provision_id = citation.provision_id
      join regulatory.source_versions version on version.version_id = provision.version_id
      left join regulatory.provision_rights_reviews rights
        on rights.provision_id = provision.provision_id
      where member.snapshot_id = snapshot.snapshot_id
    ), '[]'::jsonb)
  )
  from retrieval.corpus_snapshots snapshot
  where snapshot.snapshot_id = p_snapshot_id;
$$;

create or replace function policy.create_retrieval_index_release(
  p_index_release_id text, p_policy_domain text, p_corpus_release_id text,
  p_corpus_release_kind text, p_fresh_through timestamptz,
  p_lexical_config jsonb, p_vector_config jsonb, p_embedding_model text,
  p_embedding_model_version text, p_embedding_dimensions integer
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
  select snapshot.as_of, snapshot.knowledge_cutoff
  into v_as_of, v_knowledge_cutoff
  from retrieval.corpus_snapshots snapshot
  where snapshot.snapshot_id = p_corpus_release_id
    and snapshot.policy_domain = p_policy_domain
    and snapshot.corpus_release_kind = p_corpus_release_kind;
  if v_as_of is null and p_corpus_release_kind = 'PROVISIONAL' then
    select release.as_of, release.knowledge_cutoff into v_as_of, v_knowledge_cutoff
    from policy.provisional_corpus_releases release
    where release.release_id = p_corpus_release_id;
  elsif v_as_of is null and p_corpus_release_kind = 'HUMAN_REVIEWED' then
    select release.as_of, release.knowledge_cutoff into v_as_of, v_knowledge_cutoff
    from policy.corpus_releases release
    where release.release_id = p_corpus_release_id and release.release_state = 'PUBLISHED';
  elsif v_as_of is null and p_corpus_release_kind not in ('PROVISIONAL', 'HUMAN_REVIEWED') then
    raise exception 'invalid corpus release kind';
  end if;
  if v_as_of is null then raise exception 'eligible corpus release does not exist'; end if;
  if p_corpus_release_kind = 'HUMAN_REVIEWED' and v_knowledge_cutoff < v_as_of then
    raise exception 'human-reviewed knowledge cutoff cannot predate corpus as_of';
  end if;
  if p_fresh_through < greatest(v_as_of, v_knowledge_cutoff) then
    raise exception 'retrieval index freshness cannot predate corpus time envelope';
  end if;
  insert into retrieval.index_releases (
    index_release_id, policy_domain, corpus_release_id, corpus_release_kind,
    assurance_tier, as_of, knowledge_cutoff, fresh_through, lexical_config,
    vector_config, embedding_model, embedding_model_version, embedding_dimensions
  ) values (
    p_index_release_id, p_policy_domain, p_corpus_release_id,
    p_corpus_release_kind, p_corpus_release_kind, v_as_of, v_knowledge_cutoff,
    p_fresh_through, p_lexical_config, p_vector_config, p_embedding_model,
    p_embedding_model_version, p_embedding_dimensions
  );
  return jsonb_build_object('indexReleaseId', p_index_release_id,
    'releaseState', 'DRAFT', 'corpusReleaseId', p_corpus_release_id,
    'assuranceTier', p_corpus_release_kind);
end;
$$;

create or replace function policy.add_retrieval_index_chunk(
  p_index_release_id text, p_chunk_id text, p_claim_id text,
  p_citation_id text, p_provision_id text, p_source_version_id text,
  p_language_code text, p_chunk_text text, p_chunk_checksum_sha256 text,
  p_excerpt_permission text, p_embedding_id text, p_embedding_model text,
  p_embedding_model_version text, p_embedding_dimensions integer,
  p_embedding text, p_embedding_checksum_sha256 text, p_ordinal integer
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
  select * into strict v_release from retrieval.index_releases
  where index_release_id = p_index_release_id for update;
  if v_release.release_state <> 'DRAFT' then
    raise exception 'retrieval index membership is frozen after activation';
  end if;
  if p_embedding_model <> v_release.embedding_model
     or p_embedding_model_version <> v_release.embedding_model_version
     or p_embedding_dimensions <> v_release.embedding_dimensions then
    raise exception 'embedding configuration does not match index release';
  end if;

  select exists (
    select 1 from retrieval.corpus_snapshot_claims member
    where member.snapshot_id = v_release.corpus_release_id
      and member.claim_id = p_claim_id
  ) into v_member_exists;
  if not v_member_exists and v_release.corpus_release_kind = 'PROVISIONAL' then
    select exists (
      select 1 from policy.provisional_release_claims member
      where member.release_id = v_release.corpus_release_id
        and member.claim_id = p_claim_id
    ) into v_member_exists;
  elsif not v_member_exists then
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

  select * into v_chunk from retrieval.evidence_chunks chunk
  where chunk.claim_id = p_claim_id and chunk.citation_id = p_citation_id
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

  select * into v_embedding from retrieval.embedding_records embedding
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
  return jsonb_build_object('indexReleaseId', p_index_release_id,
    'chunkId', v_chunk.chunk_id, 'embeddingId', v_embedding.embedding_id,
    'ordinal', p_ordinal);
end;
$$;

create function policy.record_retrieval_index_eval(
  p_eval_record_id text,
  p_index_release_id text,
  p_expected_manifest_sha256 text,
  p_eval_assurance text,
  p_outcome text,
  p_artifact_sha256 text,
  p_metrics jsonb,
  p_evaluated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = policy, retrieval, public, extensions
as $$
declare
  v_release retrieval.index_releases%rowtype;
  v_manifest_sha text;
  v_existing retrieval.index_eval_records%rowtype;
begin
  select * into strict v_release from retrieval.index_releases
  where index_release_id = p_index_release_id;
  if v_release.release_state <> 'DRAFT' then
    raise exception 'only a DRAFT retrieval index can be evaluated';
  end if;
  v_manifest_sha := encode(extensions.digest(convert_to(
    retrieval.build_index_manifest(p_index_release_id)::text, 'UTF8'
  ), 'sha256'), 'hex');
  if p_expected_manifest_sha256 is distinct from v_manifest_sha then
    raise exception 'retrieval index manifest fingerprint is stale';
  end if;
  if p_eval_assurance not in ('MACHINE_ASSURED', 'HUMAN_REVIEWED')
     or p_outcome not in ('PASSED', 'FAILED') then
    raise exception 'invalid retrieval eval assurance or outcome';
  end if;
  if v_release.assurance_tier = 'HUMAN_REVIEWED'
     and p_eval_assurance <> 'HUMAN_REVIEWED' then
    raise exception 'human-reviewed index requires a human-reviewed eval';
  end if;
  if p_evaluated_at is null or p_evaluated_at < v_release.created_at then
    raise exception 'retrieval eval timestamp predates the DRAFT index';
  end if;
  if p_outcome = 'PASSED' and not (
    coalesce((p_metrics->>'recallAt10')::numeric, -1) between 0.95 and 1
    and coalesce((p_metrics->>'mrrAt10')::numeric, -1) between 0.90 and 1
    and coalesce((p_metrics->>'citationPrecision')::numeric, -1) = 1
    and coalesce((p_metrics->>'versionIsolation')::numeric, -1) = 1
    and coalesce((p_metrics->>'checklistTopicCoverage')::numeric, -1) = 1
    and coalesce((p_metrics->>'rightsLeaks')::integer, -1) = 0
    and coalesce((p_metrics->>'assuranceLeaks')::integer, -1) = 0
    and coalesce((p_metrics->>'promptInstructionLeaks')::integer, -1) = 0
    and coalesce((p_metrics->>'unsafeBuildsAccepted')::integer, -1) = 0
  ) then
    raise exception 'passing retrieval eval does not meet activation thresholds';
  end if;
  select * into v_existing from retrieval.index_eval_records
  where eval_record_id = p_eval_record_id;
  if found then
    if v_existing.index_release_id <> p_index_release_id
       or v_existing.manifest_sha256 <> v_manifest_sha
       or v_existing.artifact_sha256 <> p_artifact_sha256
       or v_existing.eval_assurance <> p_eval_assurance
       or v_existing.outcome <> p_outcome
       or v_existing.metrics <> p_metrics then
      raise exception 'retrieval eval identifier was already used';
    end if;
  else
    insert into retrieval.index_eval_records (
      eval_record_id, index_release_id, manifest_sha256, eval_assurance,
      outcome, artifact_sha256, metrics, evaluated_at
    ) values (
      p_eval_record_id, p_index_release_id, v_manifest_sha, p_eval_assurance,
      p_outcome, p_artifact_sha256, p_metrics, p_evaluated_at
    );
  end if;
  return jsonb_build_object('evalRecordId', p_eval_record_id,
    'indexReleaseId', p_index_release_id, 'manifestSha256', v_manifest_sha,
    'evalAssurance', p_eval_assurance, 'outcome', p_outcome);
end;
$$;

create function policy.get_retrieval_draft_eval_input(p_index_release_id text)
returns jsonb
language sql
stable
security definer
set search_path = policy, retrieval, regulatory, public, extensions
as $$
  select jsonb_build_object(
    'indexRelease', jsonb_build_object(
      'indexReleaseId', release.index_release_id,
      'corpusReleaseId', release.corpus_release_id,
      'assuranceTier', release.assurance_tier,
      'asOf', release.as_of,
      'knowledgeCutoff', release.knowledge_cutoff,
      'generatedAt', release.created_at,
      'freshThrough', release.fresh_through,
      'embeddingModel', release.embedding_model,
      'embeddingModelVersion', release.embedding_model_version,
      'embeddingDimensions', release.embedding_dimensions,
      'lexicalConfigVersion', coalesce(release.lexical_config->>'version', 'unknown'),
      'vectorConfigVersion', coalesce(release.vector_config->>'version', 'unknown')
    ),
    'chunks', coalesce((
      select jsonb_agg(jsonb_build_object(
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
          when 'HUMAN_REVIEWED' then 'HUMAN_REVIEWED' else 'PROVISIONAL' end,
        'internalSearchAllowed', chunk.internal_search_allowed,
        'excerptPermission', chunk.excerpt_permission,
        'excerpt', case when chunk.excerpt_permission = 'ALLOWED'
          then coalesce(citation.allowed_excerpt, chunk.chunk_text) else null end,
        'searchText', chunk.chunk_text,
        'embedding', embedding.embedding::text
      ) order by member.ordinal, chunk.chunk_id)
      from retrieval.index_release_chunks member
      join retrieval.evidence_chunks chunk on chunk.chunk_id = member.chunk_id
      join retrieval.embedding_records embedding on embedding.embedding_id = member.embedding_id
      join policy.legal_claims claim on claim.claim_id = chunk.claim_id
      join policy.citations citation on citation.citation_id = chunk.citation_id
      join regulatory.provisions provision on provision.provision_id = chunk.provision_id
      join regulatory.source_versions version on version.version_id = chunk.source_version_id
      join regulatory.source_documents document on document.document_id = version.document_id
      join regulatory.source_authorities authority on authority.authority_id = document.authority_id
      where member.index_release_id = release.index_release_id
    ), '[]'::jsonb)
  )
  from retrieval.index_releases release
  where release.index_release_id = p_index_release_id
    and release.release_state = 'DRAFT';
$$;

create or replace function policy.activate_retrieval_index_release(
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
  select * into strict v_release from retrieval.index_releases
  where index_release_id = p_index_release_id for update;
  if v_release.release_state <> 'DRAFT' then
    raise exception 'only a DRAFT retrieval index can be activated';
  end if;
  if p_activated_at is null or p_activated_at < v_release.created_at then
    raise exception 'invalid retrieval index activation time';
  end if;
  if not exists (select 1 from retrieval.index_release_chunks
    where index_release_id = p_index_release_id) then
    raise exception 'retrieval index membership is empty';
  end if;
  v_manifest := retrieval.build_index_manifest(p_index_release_id);
  v_manifest_sha256 := encode(extensions.digest(
    convert_to(v_manifest::text, 'UTF8'), 'sha256'), 'hex');
  if p_expected_manifest_sha256 is distinct from v_manifest_sha256 then
    raise exception 'retrieval index manifest fingerprint is stale';
  end if;
  if not exists (
    select 1 from retrieval.index_eval_records evaluation
    where evaluation.index_release_id = p_index_release_id
      and evaluation.manifest_sha256 = v_manifest_sha256
      and evaluation.outcome = 'PASSED'
      and (v_release.assurance_tier = 'PROVISIONAL'
        or evaluation.eval_assurance = 'HUMAN_REVIEWED')
  ) then
    raise exception 'retrieval index lacks a passing exact-manifest eval';
  end if;
  select pointer.active_index_release_id into v_previous_id
  from retrieval.active_index_pointers pointer
  where pointer.policy_domain = v_release.policy_domain
    and pointer.assurance_tier = v_release.assurance_tier for update;
  if v_previous_id is not null then
    update retrieval.index_releases set release_state = 'RETIRED',
      retired_at = p_activated_at where index_release_id = v_previous_id
      and release_state = 'ACTIVE';
  end if;
  update retrieval.index_releases set release_state = 'ACTIVE',
    manifest_sha256 = v_manifest_sha256, activated_at = p_activated_at,
    retired_at = null where index_release_id = p_index_release_id;
  insert into retrieval.active_index_pointers (
    policy_domain, assurance_tier, active_index_release_id,
    previous_index_release_id, updated_at
  ) values (
    v_release.policy_domain, v_release.assurance_tier, p_index_release_id,
    v_previous_id, p_activated_at
  ) on conflict (policy_domain, assurance_tier) do update set
    active_index_release_id = excluded.active_index_release_id,
    previous_index_release_id = excluded.previous_index_release_id,
    updated_at = excluded.updated_at;
  return jsonb_build_object('indexReleaseId', p_index_release_id,
    'releaseState', 'ACTIVE', 'manifestSha256', v_manifest_sha256,
    'previousIndexReleaseId', v_previous_id);
end;
$$;

revoke all on function policy.prepare_retrieval_corpus_snapshot(text,text,text,text[])
from public, anon, authenticated;
grant execute on function policy.prepare_retrieval_corpus_snapshot(text,text,text,text[])
to service_role;
revoke all on function policy.create_retrieval_corpus_snapshot(text,text,text,text[],text)
from public, anon, authenticated;
grant execute on function policy.create_retrieval_corpus_snapshot(text,text,text,text[],text)
to service_role;
revoke all on function policy.get_retrieval_snapshot_build_input(text)
from public, anon, authenticated;
grant execute on function policy.get_retrieval_snapshot_build_input(text)
to service_role;
revoke all on function policy.record_retrieval_index_eval(text,text,text,text,text,text,jsonb,timestamptz)
from public, anon, authenticated;
grant execute on function policy.record_retrieval_index_eval(text,text,text,text,text,text,jsonb,timestamptz)
to service_role;
revoke all on function policy.get_retrieval_draft_eval_input(text)
from public, anon, authenticated;
grant execute on function policy.get_retrieval_draft_eval_input(text)
to service_role;

comment on table retrieval.corpus_snapshots is
  'Immutable aggregate retrieval corpus membership pinned to exact source release manifests.';
comment on table retrieval.index_eval_records is
  'Immutable activation evidence for one exact DRAFT index manifest; machine assurance cannot authorize a human-reviewed index.';
comment on function policy.activate_retrieval_index_release is
  'Activates only a DRAFT index with an exact manifest and a tier-appropriate passing eval.';

commit;
