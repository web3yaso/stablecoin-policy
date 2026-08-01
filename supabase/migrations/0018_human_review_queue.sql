begin;

create function policy.get_legal_corpus_review_queue(
  p_jurisdiction_code text,
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = policy, regulatory, public
as $$
declare
  v_scope policy.coverage_scopes%rowtype;
  v_source record;
  v_claim record;
  v_release record;
  v_envelope jsonb;
  v_tasks jsonb := '[]'::jsonb;
  v_returned_tasks jsonb;
  v_readiness_errors text[];
  v_release_id text;
  v_checklist_id text;
  v_total_count integer;
begin
  if p_jurisdiction_code !~ '^[A-Z][A-Z0-9-]{1,15}$' then
    raise exception 'invalid review queue jurisdiction';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception 'review queue limit must be between 1 and 200';
  end if;
  select * into v_scope from policy.coverage_scopes
  where jurisdiction_code = p_jurisdiction_code;
  if not found then
    raise exception 'unknown review queue jurisdiction';
  end if;

  for v_source in
    select version.*
    from regulatory.source_versions version
    join regulatory.source_documents document
      on document.document_id = version.document_id
    join regulatory.source_authorities authority
      on authority.authority_id = document.authority_id
    where authority.jurisdiction_code = p_jurisdiction_code
      and version.lifecycle_state = 'OBSERVED'
    order by version.retrieved_at, version.version_id
  loop
    select array_remove(array[
      case when v_source.storage_rights <> 'ALLOWED'
        then 'storage_rights_not_allowed' end,
      case when v_source.rights_reviewed_at is null
        or nullif(btrim(v_source.rights_basis), '') is null
        then 'storage_rights_review_missing' end,
      case when count(provision.provision_id) = 0
        then 'provisions_missing' end,
      case when count(provision.provision_id) filter (
        where coalesce(
          rights_review.excerpt_permission,
          provision.excerpt_permission
        ) = 'UNKNOWN'
      ) > 0 then 'excerpt_permission_unknown' end
    ], null)
    into v_readiness_errors
    from regulatory.provisions provision
    left join regulatory.provision_rights_reviews rights_review
      on rights_review.provision_id = provision.provision_id
    where provision.version_id = v_source.version_id;

    v_tasks := v_tasks || jsonb_build_array(jsonb_build_object(
      'taskType', 'SOURCE_VERIFICATION',
      'subjectId', v_source.version_id,
      'subjectState', v_source.lifecycle_state,
      'priority', 10,
      'nextAction', case when cardinality(v_readiness_errors) = 0
        then 'REVIEW_SOURCE' else 'RESOLVE_SOURCE_EVIDENCE' end,
      'readinessErrors', to_jsonb(v_readiness_errors),
      'requiredInputs', jsonb_build_array(
        'verificationMethod', 'reviewerRole', 'reviewerRef',
        'manifestSha256', 'reviewedAt'
      ),
      'command', jsonb_build_object(
        'script', 'legal:sources:verify',
        'args', jsonb_build_array('--source-version', v_source.version_id)
      )
    ));
  end loop;

  for v_claim in
    select claim_id, review_state, created_at
    from policy.legal_claims
    where jurisdiction_code = p_jurisdiction_code
      and review_state in ('DRAFT', 'IN_REVIEW')
    order by created_at, claim_id
  loop
    v_envelope := policy.get_legal_claim_review_manifest(v_claim.claim_id);
    v_tasks := v_tasks || jsonb_build_array(jsonb_build_object(
      'taskType', 'CLAIM_REVIEW',
      'subjectId', v_claim.claim_id,
      'subjectState', v_claim.review_state,
      'priority', 20,
      'nextAction', case
        when jsonb_array_length(v_envelope->'readinessErrors') > 0
          then 'RESOLVE_CLAIM_EVIDENCE'
        when v_claim.review_state = 'DRAFT'
          then 'SUBMIT_CLAIM_FOR_REVIEW'
        else 'REVIEW_CLAIM'
      end,
      'readinessErrors', v_envelope->'readinessErrors',
      'requiredInputs', case when v_claim.review_state = 'DRAFT'
        then '[]'::jsonb
        else jsonb_build_array(
          'outcome', 'reviewerRole', 'reviewerRef',
          'manifestSha256', 'reviewedAt'
        )
      end,
      'command', jsonb_build_object(
        'script', 'legal:claims:review',
        'args', jsonb_build_array('--claim', v_claim.claim_id)
      )
    ));
  end loop;

  for v_release in
    select distinct release.release_id, release.release_state,
      release.created_at
    from policy.corpus_releases release
    join policy.corpus_release_claims membership
      on membership.release_id = release.release_id
    join policy.legal_claims claim on claim.claim_id = membership.claim_id
    where claim.jurisdiction_code = p_jurisdiction_code
      and release.release_state in ('DRAFT', 'IN_REVIEW', 'REVIEWED')
    order by release.created_at, release.release_id, release.release_state
  loop
    v_envelope := policy.get_corpus_release_review_manifest(v_release.release_id);
    v_tasks := v_tasks || jsonb_build_array(jsonb_build_object(
      'taskType', 'CORPUS_RELEASE_REVIEW',
      'subjectId', v_release.release_id,
      'subjectState', v_release.release_state,
      'priority', 30,
      'nextAction', case
        when jsonb_array_length(v_envelope->'readinessErrors') > 0
          then 'RESOLVE_RELEASE_EVIDENCE'
        when v_release.release_state = 'DRAFT'
          then 'SUBMIT_RELEASE_FOR_REVIEW'
        when v_release.release_state = 'IN_REVIEW'
          then 'REVIEW_RELEASE'
        else 'PUBLISH_RELEASE'
      end,
      'readinessErrors', v_envelope->'readinessErrors',
      'requiredInputs', case
        when v_release.release_state = 'IN_REVIEW' then jsonb_build_array(
          'outcome', 'reviewerRole', 'reviewerRef',
          'manifestSha256', 'reviewedAt'
        )
        when v_release.release_state = 'REVIEWED' then jsonb_build_array(
          'manifestSha256', 'publishedAt'
        )
        else '[]'::jsonb
      end,
      'command', jsonb_build_object(
        'script', 'legal:corpus:release',
        'args', jsonb_build_array('--release', v_release.release_id)
      )
    ));
  end loop;

  if v_scope.coverage_state = 'IN_PROGRESS' then
    select release.release_id into v_release_id
    from policy.corpus_releases release
    where release.release_state = 'PUBLISHED'
      and exists (
        select 1
        from policy.corpus_release_claims membership
        join policy.legal_claims claim on claim.claim_id = membership.claim_id
        where membership.release_id = release.release_id
          and claim.jurisdiction_code = p_jurisdiction_code
      )
    order by release.published_at desc, release.release_id
    limit 1;
    if v_release_id is not null then
      select checklist_id into v_checklist_id
      from policy.coverage_baseline_checklists
      where jurisdiction_code = p_jurisdiction_code
      order by created_at desc, checklist_id
      limit 1;
      v_tasks := v_tasks || jsonb_build_array(jsonb_build_object(
        'taskType', 'COVERAGE_REVIEW_PREPARATION',
        'subjectId', p_jurisdiction_code,
        'subjectState', v_scope.coverage_state,
        'priority', 40,
        'nextAction', case when v_checklist_id is null
          then 'DEFINE_COVERAGE_CHECKLIST' else 'PREPARE_COVERAGE_REVIEW' end,
        'readinessErrors', case when v_checklist_id is null
          then jsonb_build_array('coverage_checklist_missing')
          else '[]'::jsonb
        end,
        'requiredInputs', case when v_checklist_id is null
          then jsonb_build_array('checklistId', 'versionLabel', 'items')
          else jsonb_build_array('freshnessCutoff', 'publicNote')
        end,
        'relatedIds', jsonb_build_object(
          'releaseId', v_release_id,
          'checklistId', v_checklist_id
        ),
        'command', jsonb_build_object(
          'script', 'legal:coverage:review',
          'args', jsonb_build_array('--jurisdiction', p_jurisdiction_code)
        )
      ));
    end if;
  end if;

  v_total_count := jsonb_array_length(v_tasks);
  select coalesce(jsonb_agg(value order by ordinal), '[]'::jsonb)
  into v_returned_tasks
  from jsonb_array_elements(v_tasks) with ordinality task(value, ordinal)
  where ordinal <= p_limit;

  return jsonb_build_object(
    'schemaVersion', '1.0.0',
    'jurisdictionCode', p_jurisdiction_code,
    'humanReviewRequired', true,
    'automaticApprovalAllowed', false,
    'totalTaskCount', v_total_count,
    'returnedTaskCount', jsonb_array_length(v_returned_tasks),
    'tasks', v_returned_tasks
  );
end;
$$;

revoke all on function policy.get_legal_corpus_review_queue(text, integer)
from public, anon, authenticated;
grant execute on function policy.get_legal_corpus_review_queue(text, integer)
to service_role;

comment on function policy.get_legal_corpus_review_queue is
  'Private read-only human-review work queue derived from canonical corpus state; it cannot transition or approve any subject.';

commit;
