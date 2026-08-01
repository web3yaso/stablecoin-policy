begin;

create function policy.preflight_legal_claim_draft_bundle(p_bundle jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = policy, regulatory, public, extensions
as $$
declare
  v_batch_id text := p_bundle->>'batchId';
  v_jurisdiction text := p_bundle->>'jurisdictionCode';
  v_claims jsonb := p_bundle->'claims';
  v_claim jsonb;
  v_citation jsonb;
  v_claim_results jsonb := '[]'::jsonb;
  v_manifest_sha256 text;
  v_existing_manifest_sha256 text;
  v_idempotent_replay boolean := false;
  v_bundle_errors text[];
  v_import_errors text[];
  v_review_errors text[];
  v_bundle_import_ready boolean := true;
  v_bundle_review_ready boolean := true;
  v_citation_count integer := 0;
  v_missing_provision_count integer;
  v_contradiction_count integer;
  v_unverified_source_count integer;
  v_unknown_permission_count integer;
  v_unauthorized_excerpt_count integer;
  v_direct_official_support_count integer;
begin
  if jsonb_typeof(p_bundle) is distinct from 'object'
     or p_bundle->>'schemaVersion' <> '1.0.0'
     or v_batch_id !~ '^[a-z0-9][a-z0-9._:-]{2,160}$'
     or not exists (
       select 1 from policy.coverage_scopes
       where jurisdiction_code = v_jurisdiction
     )
     or jsonb_typeof(v_claims) is distinct from 'array'
     or jsonb_array_length(v_claims) = 0 then
    raise exception 'invalid legal claim draft preflight bundle';
  end if;

  v_manifest_sha256 := encode(
    extensions.digest(convert_to(p_bundle::text, 'UTF8'), 'sha256'), 'hex'
  );
  select manifest_sha256 into v_existing_manifest_sha256
  from policy.claim_draft_imports
  where batch_id = v_batch_id;
  v_idempotent_replay := coalesce(
    v_existing_manifest_sha256 = v_manifest_sha256,
    false
  );
  v_bundle_errors := array_remove(array[
    case when v_existing_manifest_sha256 is not null
      and v_existing_manifest_sha256 <> v_manifest_sha256
      then 'batch_manifest_conflict' end
  ], null);
  if cardinality(v_bundle_errors) > 0 then
    v_bundle_import_ready := false;
  end if;

  for v_claim in select value from jsonb_array_elements(v_claims) loop
    if v_claim->>'claimId' !~ '^[a-z0-9][a-z0-9._:-]{2,160}$'
       or nullif(btrim(v_claim->>'topic'), '') is null
       or nullif(btrim(v_claim->>'proposition'), '') is null
       or v_claim->>'legalStatus' not in (
         'REQUIREMENT', 'PERMISSION', 'PROHIBITION', 'EXEMPTION',
         'GUIDANCE', 'UNDETERMINED'
       )
       or nullif(v_claim->>'effectiveFrom', '') is null
       or nullif(v_claim->>'knowledgeCutoff', '') is null
       or jsonb_typeof(v_claim->'actorTypes') is distinct from 'array'
       or jsonb_typeof(v_claim->'activityCodes') is distinct from 'array'
       or jsonb_typeof(v_claim->'citations') is distinct from 'array'
       or jsonb_array_length(v_claim->'citations') = 0
       or v_claim ?| array['reviewState', 'reviewedAt', 'publishedAt'] then
      raise exception 'invalid legal claim draft preflight claim';
    end if;

    perform (v_claim->>'effectiveFrom')::timestamptz;
    perform nullif(v_claim->>'effectiveTo', '')::timestamptz;
    perform (v_claim->>'knowledgeCutoff')::timestamptz;

    for v_citation in select value
      from jsonb_array_elements(v_claim->'citations')
    loop
      if v_citation->>'citationId' !~ '^[a-z0-9][a-z0-9._:-]{2,160}$'
         or v_citation->>'provisionId' !~ '^[a-z0-9][a-z0-9._:-]{2,200}$'
         or v_citation->>'supportRelation' not in (
           'DIRECT_SUPPORT', 'INDIRECT_SUPPORT', 'CONTRADICTS'
         )
         or nullif(btrim(v_citation->>'exactLocator'), '') is null then
        raise exception 'invalid legal claim draft preflight citation';
      end if;
      v_citation_count := v_citation_count + 1;
    end loop;

    select
      count(*) filter (where provision.provision_id is null)::integer,
      count(*) filter (
        where citation->>'supportRelation' = 'CONTRADICTS'
      )::integer,
      count(*) filter (
        where provision.provision_id is not null
          and (
            version.lifecycle_state <> 'VERIFIED'
            or not exists (
              select 1
              from regulatory.source_verification_records verification
              where verification.version_id = version.version_id
                and verification.outcome = 'APPROVED'
            )
          )
      )::integer,
      count(*) filter (
        where provision.provision_id is not null
          and coalesce(
            rights_review.excerpt_permission,
            provision.excerpt_permission
          ) = 'UNKNOWN'
      )::integer,
      count(*) filter (
        where nullif(btrim(citation->>'allowedExcerpt'), '') is not null
          and coalesce(
            rights_review.excerpt_permission,
            provision.excerpt_permission
          ) is distinct from 'ALLOWED'
      )::integer,
      count(*) filter (
        where citation->>'supportRelation' = 'DIRECT_SUPPORT'
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
      v_missing_provision_count,
      v_contradiction_count,
      v_unverified_source_count,
      v_unknown_permission_count,
      v_unauthorized_excerpt_count,
      v_direct_official_support_count
    from jsonb_array_elements(v_claim->'citations') citation
    left join regulatory.provisions provision
      on provision.provision_id = citation->>'provisionId'
    left join regulatory.provision_rights_reviews rights_review
      on rights_review.provision_id = provision.provision_id
    left join regulatory.source_versions version
      on version.version_id = provision.version_id
    left join regulatory.source_documents document
      on document.document_id = version.document_id;

    v_import_errors := array_remove(array[
      case when (
        select count(*) from jsonb_array_elements(v_claims) candidate
        where candidate->>'claimId' = v_claim->>'claimId'
      ) > 1 then 'duplicate_claim_id' end,
      case when exists (
        select 1 from policy.legal_claims existing
        where existing.claim_id = v_claim->>'claimId'
      ) and not v_idempotent_replay then 'claim_id_exists' end,
      case when nullif(v_claim->>'supersedesClaimId', '') is not null
        and not exists (
          select 1 from policy.legal_claims predecessor
          where predecessor.claim_id = v_claim->>'supersedesClaimId'
        ) then 'supersedes_claim_missing' end,
      case when exists (
        select 1
        from jsonb_array_elements(v_claim->'citations') current_citation
        where (
          select count(*)
          from jsonb_array_elements(v_claims) candidate_claim
          cross join lateral jsonb_array_elements(
            candidate_claim->'citations'
          ) candidate_citation
          where candidate_citation->>'citationId'
            = current_citation->>'citationId'
        ) > 1
      ) then 'duplicate_citation_id' end,
      case when exists (
        select 1
        from jsonb_array_elements(v_claim->'citations') citation
        join policy.citations existing
          on existing.citation_id = citation->>'citationId'
      ) and not v_idempotent_replay then 'citation_id_exists' end,
      case when v_missing_provision_count > 0 then 'provision_missing' end,
      case when v_unauthorized_excerpt_count > 0
        then 'unauthorized_excerpt' end
    ], null);

    v_review_errors := array_remove(array[
      case when v_missing_provision_count > 0 then 'provision_missing' end,
      case when v_contradiction_count > 0 then 'contradictory_evidence' end,
      case when v_unverified_source_count > 0 then 'unverified_source' end,
      case when v_unknown_permission_count > 0
        then 'unknown_excerpt_permission' end,
      case when v_unauthorized_excerpt_count > 0
        then 'unauthorized_excerpt' end,
      case when v_direct_official_support_count = 0
        then 'direct_official_support_missing' end
    ], null);

    if cardinality(v_import_errors) > 0 then
      v_bundle_import_ready := false;
    end if;
    if cardinality(v_review_errors) > 0 then
      v_bundle_review_ready := false;
    end if;
    v_claim_results := v_claim_results || jsonb_build_array(
      jsonb_build_object(
        'claimId', v_claim->>'claimId',
        'importReady', cardinality(v_import_errors) = 0,
        'reviewEvidenceReady', cardinality(v_review_errors) = 0,
        'importErrors', to_jsonb(v_import_errors),
        'reviewReadinessErrors', to_jsonb(v_review_errors)
      )
    );
  end loop;

  return jsonb_build_object(
    'schemaVersion', '1.0.0',
    'batchId', v_batch_id,
    'jurisdictionCode', v_jurisdiction,
    'manifestSha256', v_manifest_sha256,
    'claimCount', jsonb_array_length(v_claims),
    'citationCount', v_citation_count,
    'importReady', v_bundle_import_ready,
    'idempotentReplay', v_idempotent_replay,
    'bundleErrors', to_jsonb(v_bundle_errors),
    'reviewEvidenceReady', v_bundle_review_ready,
    'legalValidityAssessed', false,
    'claims', v_claim_results
  );
end;
$$;

revoke all on function policy.preflight_legal_claim_draft_bundle(jsonb)
from public, anon, authenticated;
grant execute on function policy.preflight_legal_claim_draft_bundle(jsonb)
to service_role;

comment on function policy.preflight_legal_claim_draft_bundle is
  'Read-only evidence and import preflight for claim draft bundles; it never assesses legal validity or changes workflow state.';

commit;
