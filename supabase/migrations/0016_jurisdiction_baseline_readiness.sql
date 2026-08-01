begin;

create function policy.get_jurisdiction_baseline_readiness(
  p_jurisdiction_code text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = policy, regulatory, public
as $$
declare
  v_coverage policy.coverage_scopes%rowtype;
  v_source_version_count integer;
  v_verified_source_version_count integer;
  v_claim_count integer;
  v_pending_claim_count integer;
  v_reviewed_claim_count integer;
  v_published_release_count integer;
  v_checklist_count integer;
  v_workflow_stage text;
  v_blockers text[];
  v_warnings text[];
begin
  if p_jurisdiction_code !~ '^[A-Z][A-Z0-9-]{1,15}$' then
    raise exception 'invalid baseline readiness jurisdiction';
  end if;

  select * into v_coverage
  from policy.coverage_scopes
  where jurisdiction_code = p_jurisdiction_code;
  if not found then
    raise exception 'unknown baseline readiness jurisdiction';
  end if;

  select
    count(*)::integer,
    count(*) filter (
      where version.lifecycle_state = 'VERIFIED'
        and exists (
          select 1
          from regulatory.source_verification_records verification
          where verification.version_id = version.version_id
            and verification.outcome = 'APPROVED'
        )
    )::integer
  into v_source_version_count, v_verified_source_version_count
  from regulatory.source_versions version
  join regulatory.source_documents document
    on document.document_id = version.document_id
  join regulatory.source_authorities authority
    on authority.authority_id = document.authority_id
  where authority.jurisdiction_code = p_jurisdiction_code
    and version.lifecycle_state not in ('RETRACTED', 'CORRECTED');

  select
    count(*)::integer,
    count(*) filter (where review_state in ('DRAFT', 'IN_REVIEW'))::integer,
    count(*) filter (where review_state in ('REVIEWED', 'PUBLISHED'))::integer
  into v_claim_count, v_pending_claim_count, v_reviewed_claim_count
  from policy.legal_claims
  where jurisdiction_code = p_jurisdiction_code
    and review_state not in ('SUPERSEDED', 'RETRACTED');

  select count(distinct release.release_id)::integer
  into v_published_release_count
  from policy.corpus_releases release
  join policy.corpus_release_claims membership
    on membership.release_id = release.release_id
  join policy.legal_claims claim on claim.claim_id = membership.claim_id
  where release.release_state = 'PUBLISHED'
    and claim.jurisdiction_code = p_jurisdiction_code
    and claim.review_state in ('REVIEWED', 'PUBLISHED');

  select count(*)::integer into v_checklist_count
  from policy.coverage_baseline_checklists
  where jurisdiction_code = p_jurisdiction_code;

  v_workflow_stage := case
    when v_coverage.coverage_state = 'REVIEWED' then 'COMPLETE'
    when v_source_version_count = 0 then 'SOURCE_INGESTION'
    when v_verified_source_version_count = 0 then 'SOURCE_REVIEW'
    when v_claim_count = 0 then 'CLAIM_DRAFTING'
    when v_reviewed_claim_count = 0 then 'CLAIM_REVIEW'
    when v_published_release_count = 0 then 'CORPUS_RELEASE'
    else 'COVERAGE_REVIEW'
  end;

  v_blockers := array_remove(array[
    case when v_source_version_count = 0 then 'source_versions_missing' end,
    case when v_verified_source_version_count = 0 then 'verified_sources_missing' end,
    case when v_claim_count = 0 then 'claims_missing' end,
    case when v_reviewed_claim_count = 0 then 'reviewed_claims_missing' end,
    case when v_published_release_count = 0 then 'published_release_missing' end,
    case when v_checklist_count = 0 then 'coverage_checklist_missing' end,
    case when v_coverage.coverage_state <> 'REVIEWED'
      then 'coverage_review_missing' end
  ], null);
  v_warnings := array_remove(array[
    case when v_pending_claim_count > 0 then 'pending_claims_present' end,
    case when v_coverage.freshness_state <> 'CURRENT'
      then 'coverage_freshness_not_current' end
  ], null);

  return jsonb_build_object(
    'schemaVersion', '1.0.0',
    'jurisdictionCode', p_jurisdiction_code,
    'workflowStage', v_workflow_stage,
    'workflowComplete', v_coverage.coverage_state = 'REVIEWED',
    'legalCompletenessAssessed', false,
    'coverage', jsonb_build_object(
      'coverageState', v_coverage.coverage_state,
      'completenessPercent', v_coverage.completeness_percent,
      'freshnessState', v_coverage.freshness_state,
      'reviewedAt', v_coverage.reviewed_at
    ),
    'counts', jsonb_build_object(
      'sourceVersions', v_source_version_count,
      'verifiedSourceVersions', v_verified_source_version_count,
      'claims', v_claim_count,
      'pendingClaims', v_pending_claim_count,
      'reviewedClaims', v_reviewed_claim_count,
      'publishedReleases', v_published_release_count,
      'coverageChecklists', v_checklist_count
    ),
    'blockers', to_jsonb(v_blockers),
    'warnings', to_jsonb(v_warnings)
  );
end;
$$;

revoke all on function policy.get_jurisdiction_baseline_readiness(text)
from public, anon, authenticated;
grant execute on function policy.get_jurisdiction_baseline_readiness(text)
to service_role;

comment on function policy.get_jurisdiction_baseline_readiness is
  'Returns a private read-only workflow inventory; it does not assess legal completeness or change review state.';

commit;
