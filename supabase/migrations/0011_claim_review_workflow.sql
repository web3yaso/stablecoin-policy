begin;

create or replace function policy.protect_reviewed_claim()
returns trigger
language plpgsql
set search_path = policy, regulatory, public
as $$
begin
  if old.review_state <> 'DRAFT' and (
    new.claim_id is distinct from old.claim_id
    or new.policy_domain is distinct from old.policy_domain
    or new.jurisdiction_code is distinct from old.jurisdiction_code
    or new.topic is distinct from old.topic
    or new.proposition is distinct from old.proposition
    or new.legal_status is distinct from old.legal_status
    or new.effective_from is distinct from old.effective_from
    or new.effective_to is distinct from old.effective_to
    or new.knowledge_cutoff is distinct from old.knowledge_cutoff
    or new.actor_types is distinct from old.actor_types
    or new.activity_codes is distinct from old.activity_codes
    or new.supersedes_claim_id is distinct from old.supersedes_claim_id
  ) then
    raise exception 'claim % content is immutable outside DRAFT', old.claim_id;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function policy.protect_reviewed_citation()
returns trigger
language plpgsql
set search_path = policy, public
as $$
declare
  v_claim_id text;
  v_state text;
begin
  v_claim_id := case when tg_op = 'DELETE' then old.claim_id else new.claim_id end;
  select review_state into strict v_state
  from policy.legal_claims
  where claim_id = v_claim_id
  for share;
  if v_state <> 'DRAFT' then
    raise exception 'citations for claim % are immutable outside DRAFT', v_claim_id;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create function policy.validate_citation_excerpt_permission()
returns trigger
language plpgsql
set search_path = policy, regulatory, public
as $$
declare
  v_permission text;
begin
  select coalesce(rights_review.excerpt_permission, provision.excerpt_permission)
  into strict v_permission
  from regulatory.provisions provision
  left join regulatory.provision_rights_reviews rights_review
    on rights_review.provision_id = provision.provision_id
  where provision.provision_id = new.provision_id;

  if nullif(btrim(new.allowed_excerpt), '') is not null and v_permission <> 'ALLOWED' then
    raise exception 'citation excerpt is not permitted for provision %', new.provision_id;
  end if;
  new.allowed_excerpt := nullif(btrim(new.allowed_excerpt), '');
  return new;
end;
$$;

create trigger validate_citation_excerpt_permission_trigger
before insert or update on policy.citations
for each row execute function policy.validate_citation_excerpt_permission();

create function policy.build_legal_claim_review_manifest(p_claim_id text)
returns jsonb
language sql
stable
set search_path = policy, regulatory, public
as $$
  select jsonb_build_object(
    'schemaVersion', '1.0.0',
    'claimId', claim.claim_id,
    'policyDomain', claim.policy_domain,
    'jurisdictionCode', claim.jurisdiction_code,
    'topic', claim.topic,
    'proposition', claim.proposition,
    'legalStatus', claim.legal_status,
    'effectiveFrom', claim.effective_from,
    'effectiveTo', claim.effective_to,
    'knowledgeCutoff', claim.knowledge_cutoff,
    'actorTypes', to_jsonb(claim.actor_types),
    'activityCodes', to_jsonb(claim.activity_codes),
    'supersedesClaimId', claim.supersedes_claim_id,
    'citations', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'citationId', citation.citation_id,
          'supportRelation', citation.support_relation,
          'exactLocator', citation.exact_locator,
          'allowedExcerpt', citation.allowed_excerpt,
          'provisionId', provision.provision_id,
          'provisionLocator', provision.locator,
          'languageCode', provision.language_code,
          'textChecksumSha256', provision.text_checksum_sha256,
          'effectiveExcerptPermission', coalesce(
            rights_review.excerpt_permission,
            provision.excerpt_permission
          ),
          'sourceVersionId', version.version_id,
          'sourceVersionChecksumSha256', version.checksum_sha256,
          'documentId', document.document_id,
          'documentTitle', document.title,
          'canonicalUrl', document.canonical_url,
          'authorityId', authority.authority_id,
          'authorityName', authority.name,
          'evidenceLayer', document.evidence_layer
        ) order by citation.citation_id
      )
      from policy.citations citation
      join regulatory.provisions provision
        on provision.provision_id = citation.provision_id
      left join regulatory.provision_rights_reviews rights_review
        on rights_review.provision_id = provision.provision_id
      join regulatory.source_versions version
        on version.version_id = provision.version_id
      join regulatory.source_documents document
        on document.document_id = version.document_id
      join regulatory.source_authorities authority
        on authority.authority_id = document.authority_id
      where citation.claim_id = claim.claim_id
    ), '[]'::jsonb)
  )
  from policy.legal_claims claim
  where claim.claim_id = p_claim_id;
$$;

create function policy.get_legal_claim_review_manifest(p_claim_id text)
returns jsonb
language plpgsql
stable
set search_path = policy, regulatory, public, extensions
as $$
declare
  v_manifest jsonb;
  v_review_state text;
  v_readiness_errors text[];
begin
  select review_state into strict v_review_state
  from policy.legal_claims
  where claim_id = p_claim_id;
  v_manifest := policy.build_legal_claim_review_manifest(p_claim_id);
  select array_remove(array[
    case when count(*) = 0 then 'citations_missing' end,
    case when count(*) filter (where citation.support_relation = 'CONTRADICTS') > 0
      then 'contradictory_evidence' end,
    case when count(*) filter (
      where version.lifecycle_state <> 'VERIFIED'
        or not exists (
          select 1 from regulatory.source_verification_records verification
          where verification.version_id = version.version_id
            and verification.outcome = 'APPROVED'
        )
    ) > 0 then 'unverified_source' end,
    case when count(*) filter (
      where coalesce(rights_review.excerpt_permission, provision.excerpt_permission) = 'UNKNOWN'
    ) > 0 then 'unknown_excerpt_permission' end,
    case when count(*) filter (
      where nullif(btrim(citation.allowed_excerpt), '') is not null
        and coalesce(rights_review.excerpt_permission, provision.excerpt_permission) <> 'ALLOWED'
    ) > 0 then 'unauthorized_excerpt' end,
    case when count(*) filter (
      where citation.support_relation = 'DIRECT_SUPPORT'
        and document.evidence_layer = 'OFFICIAL_SOURCE'
        and version.lifecycle_state = 'VERIFIED'
        and exists (
          select 1 from regulatory.source_verification_records verification
          where verification.version_id = version.version_id
            and verification.outcome = 'APPROVED'
        )
    ) = 0 then 'direct_official_support_missing' end
  ], null)
  into v_readiness_errors
  from policy.citations citation
  join regulatory.provisions provision on provision.provision_id = citation.provision_id
  left join regulatory.provision_rights_reviews rights_review
    on rights_review.provision_id = provision.provision_id
  join regulatory.source_versions version on version.version_id = provision.version_id
  join regulatory.source_documents document on document.document_id = version.document_id
  where citation.claim_id = p_claim_id;
  return jsonb_build_object(
    'manifest', v_manifest,
    'manifestSha256', encode(
      extensions.digest(convert_to(v_manifest::text, 'UTF8'), 'sha256'),
      'hex'
    ),
    'reviewState', v_review_state,
    'readinessErrors', to_jsonb(v_readiness_errors)
  );
end;
$$;

create function policy.submit_legal_claim_for_review(p_claim_id text)
returns jsonb
language plpgsql
security definer
set search_path = policy, regulatory, public
as $$
declare
  v_claim policy.legal_claims%rowtype;
  v_citation_count integer;
begin
  select * into strict v_claim
  from policy.legal_claims
  where claim_id = p_claim_id
  for update;
  if v_claim.review_state <> 'DRAFT' then
    raise exception 'only DRAFT claims may be submitted for review';
  end if;
  select count(*)::integer into v_citation_count
  from policy.citations
  where claim_id = p_claim_id;
  if v_citation_count = 0 then
    raise exception 'claim review requires at least one citation';
  end if;
  update policy.legal_claims
  set review_state = 'IN_REVIEW'
  where claim_id = p_claim_id;
  return jsonb_build_object(
    'claimId', p_claim_id,
    'reviewState', 'IN_REVIEW',
    'citationCount', v_citation_count
  );
end;
$$;

create function policy.review_legal_claim(
  p_review_id text,
  p_claim_id text,
  p_outcome text,
  p_reviewer_role text,
  p_reviewer_ref text,
  p_manifest_sha256 text,
  p_reviewed_at timestamptz,
  p_private_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = policy, regulatory, public, extensions
as $$
declare
  v_claim policy.legal_claims%rowtype;
  v_manifest jsonb;
  v_actual_manifest_sha256 text;
  v_citation_count integer;
  v_contradiction_count integer;
  v_unverified_count integer;
  v_unknown_permission_count integer;
  v_invalid_excerpt_count integer;
  v_direct_official_count integer;
  v_next_state text;
begin
  if p_review_id !~ '^[a-z0-9][a-z0-9._:-]{2,160}$' then
    raise exception 'invalid claim review id';
  end if;
  if p_outcome not in ('APPROVED', 'CHANGES_REQUESTED', 'REJECTED') then
    raise exception 'invalid claim review outcome';
  end if;
  if nullif(btrim(p_reviewer_role), '') is null
     or nullif(btrim(p_reviewer_ref), '') is null
     or lower(btrim(p_reviewer_ref)) in ('ai', 'llm', 'system', 'automation', 'unknown') then
    raise exception 'claim review requires an identified human reviewer';
  end if;
  if p_manifest_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid claim review manifest checksum';
  end if;
  if p_reviewed_at is null or p_reviewed_at > now() + interval '5 minutes' then
    raise exception 'invalid claim review time';
  end if;

  select * into strict v_claim
  from policy.legal_claims
  where claim_id = p_claim_id
  for update;
  if v_claim.review_state <> 'IN_REVIEW' then
    raise exception 'only IN_REVIEW claims may be reviewed';
  end if;
  if p_reviewed_at < v_claim.updated_at then
    raise exception 'claim review cannot predate review submission';
  end if;

  v_manifest := policy.build_legal_claim_review_manifest(p_claim_id);
  v_actual_manifest_sha256 := encode(
    extensions.digest(convert_to(v_manifest::text, 'UTF8'), 'sha256'),
    'hex'
  );
  if v_actual_manifest_sha256 is distinct from p_manifest_sha256 then
    raise exception 'claim review manifest checksum mismatch';
  end if;

  select
    count(*)::integer,
    count(*) filter (where citation.support_relation = 'CONTRADICTS')::integer,
    count(*) filter (
      where version.lifecycle_state <> 'VERIFIED'
        or not exists (
          select 1
          from regulatory.source_verification_records verification
          where verification.version_id = version.version_id
            and verification.outcome = 'APPROVED'
        )
    )::integer,
    count(*) filter (
      where coalesce(rights_review.excerpt_permission, provision.excerpt_permission) = 'UNKNOWN'
    )::integer,
    count(*) filter (
      where nullif(btrim(citation.allowed_excerpt), '') is not null
        and coalesce(rights_review.excerpt_permission, provision.excerpt_permission) <> 'ALLOWED'
    )::integer,
    count(*) filter (
      where citation.support_relation = 'DIRECT_SUPPORT'
        and document.evidence_layer = 'OFFICIAL_SOURCE'
        and version.lifecycle_state = 'VERIFIED'
        and exists (
          select 1
          from regulatory.source_verification_records verification
          where verification.version_id = version.version_id
            and verification.outcome = 'APPROVED'
        )
    )::integer
  into
    v_citation_count,
    v_contradiction_count,
    v_unverified_count,
    v_unknown_permission_count,
    v_invalid_excerpt_count,
    v_direct_official_count
  from policy.citations citation
  join regulatory.provisions provision on provision.provision_id = citation.provision_id
  left join regulatory.provision_rights_reviews rights_review
    on rights_review.provision_id = provision.provision_id
  join regulatory.source_versions version on version.version_id = provision.version_id
  join regulatory.source_documents document on document.document_id = version.document_id
  where citation.claim_id = p_claim_id;

  if p_outcome = 'APPROVED' and (
    v_citation_count = 0
    or v_contradiction_count > 0
    or v_unverified_count > 0
    or v_unknown_permission_count > 0
    or v_invalid_excerpt_count > 0
    or v_direct_official_count = 0
  ) then
    raise exception 'claim is not ready for approval';
  end if;

  insert into policy.review_records (
    review_id,
    claim_id,
    outcome,
    reviewer_role,
    reviewer_ref,
    evidence_fingerprint_sha256,
    private_notes,
    reviewed_at
  ) values (
    p_review_id,
    p_claim_id,
    p_outcome,
    btrim(p_reviewer_role),
    btrim(p_reviewer_ref),
    p_manifest_sha256,
    nullif(btrim(p_private_notes), ''),
    p_reviewed_at
  );

  v_next_state := case p_outcome
    when 'APPROVED' then 'REVIEWED'
    when 'CHANGES_REQUESTED' then 'DRAFT'
    else 'RETRACTED'
  end;
  update policy.legal_claims
  set review_state = v_next_state
  where claim_id = p_claim_id;

  return jsonb_build_object(
    'reviewId', p_review_id,
    'claimId', p_claim_id,
    'outcome', p_outcome,
    'manifestSha256', p_manifest_sha256,
    'reviewState', v_next_state,
    'reviewedAt', p_reviewed_at
  );
end;
$$;

create or replace function policy.validate_corpus_publication()
returns trigger
language plpgsql
set search_path = policy, regulatory, public, extensions
as $$
begin
  if new.release_state = 'PUBLISHED' and (
    tg_op = 'INSERT' or old.release_state <> 'PUBLISHED'
  ) then
    if not exists (
      select 1 from policy.corpus_release_claims where release_id = new.release_id
    ) then
      raise exception 'corpus release % has no claims', new.release_id;
    end if;

    if exists (
      select 1
      from policy.corpus_release_claims membership
      join policy.legal_claims claim on claim.claim_id = membership.claim_id
      where membership.release_id = new.release_id
        and (
          claim.review_state not in ('REVIEWED', 'PUBLISHED')
          or not exists (
            select 1
            from policy.review_records review
            where review.claim_id = claim.claim_id
              and review.outcome = 'APPROVED'
              and review.evidence_fingerprint_sha256 = encode(
                extensions.digest(
                  convert_to(
                    policy.build_legal_claim_review_manifest(claim.claim_id)::text,
                    'UTF8'
                  ),
                  'sha256'
                ),
                'hex'
              )
          )
          or not exists (
            select 1
            from policy.citations citation
            join regulatory.provisions provision
              on provision.provision_id = citation.provision_id
            left join regulatory.provision_rights_reviews rights_review
              on rights_review.provision_id = provision.provision_id
            join regulatory.source_versions version
              on version.version_id = provision.version_id
            join regulatory.source_documents document
              on document.document_id = version.document_id
            where citation.claim_id = claim.claim_id
              and citation.support_relation = 'DIRECT_SUPPORT'
              and document.evidence_layer = 'OFFICIAL_SOURCE'
              and version.lifecycle_state in ('VERIFIED', 'SUPERSEDED', 'CORRECTED')
              and coalesce(rights_review.excerpt_permission, provision.excerpt_permission) <> 'UNKNOWN'
              and exists (
                select 1
                from regulatory.source_verification_records verification
                where verification.version_id = version.version_id
                  and verification.outcome = 'APPROVED'
              )
          )
          or exists (
            select 1
            from policy.citations citation
            join regulatory.provisions provision
              on provision.provision_id = citation.provision_id
            left join regulatory.provision_rights_reviews rights_review
              on rights_review.provision_id = provision.provision_id
            where citation.claim_id = claim.claim_id
              and (
                citation.support_relation = 'CONTRADICTS'
                or coalesce(rights_review.excerpt_permission, provision.excerpt_permission) = 'UNKNOWN'
                or (
                  nullif(btrim(citation.allowed_excerpt), '') is not null
                  and coalesce(rights_review.excerpt_permission, provision.excerpt_permission) <> 'ALLOWED'
                )
              )
          )
        )
    ) then
      raise exception 'corpus release % contains insufficient, stale, or conflicting reviewed evidence', new.release_id;
    end if;
  end if;
  return new;
end;
$$;

revoke insert, update, delete on table policy.review_records from service_role;
grant select on table policy.review_records to service_role;

revoke all on function policy.build_legal_claim_review_manifest(text)
from public, anon, authenticated;
grant execute on function policy.build_legal_claim_review_manifest(text) to service_role;

revoke all on function policy.get_legal_claim_review_manifest(text)
from public, anon, authenticated;
grant execute on function policy.get_legal_claim_review_manifest(text) to service_role;

revoke all on function policy.submit_legal_claim_for_review(text)
from public, anon, authenticated;
grant execute on function policy.submit_legal_claim_for_review(text) to service_role;

revoke all on function policy.review_legal_claim(
  text, text, text, text, text, text, timestamptz, text
) from public, anon, authenticated;
grant execute on function policy.review_legal_claim(
  text, text, text, text, text, text, timestamptz, text
) to service_role;

comment on function policy.get_legal_claim_review_manifest is
  'Returns a service-only deterministic claim and citation review manifest without private reviewer data.';
comment on function policy.review_legal_claim is
  'Records a named human claim review against an exact manifest and changes review state atomically.';

commit;
