begin;

create table policy.coverage_baseline_checklists (
  checklist_id text primary key
    check (checklist_id ~ '^[a-z0-9][a-z0-9._:-]{2,160}$'),
  jurisdiction_code text not null references policy.coverage_scopes(jurisdiction_code),
  version_label text not null check (nullif(btrim(version_label), '') is not null),
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) > 0),
  checklist_sha256 text not null check (checklist_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);

create table policy.coverage_review_records (
  coverage_review_id text primary key
    check (coverage_review_id ~ '^[a-z0-9][a-z0-9._:-]{2,160}$'),
  jurisdiction_code text not null references policy.coverage_scopes(jurisdiction_code),
  checklist_id text not null references policy.coverage_baseline_checklists(checklist_id),
  release_id text not null references policy.corpus_releases(release_id),
  freshness_cutoff timestamptz not null,
  manifest_sha256 text not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  reviewer_role text not null check (nullif(btrim(reviewer_role), '') is not null),
  reviewer_ref text not null check (nullif(btrim(reviewer_ref), '') is not null),
  reviewed_at timestamptz not null,
  private_notes text,
  created_at timestamptz not null default now()
);

create trigger protect_coverage_baseline_checklist_trigger
before update or delete on policy.coverage_baseline_checklists
for each row execute function regulatory.reject_immutable_row_change();
create trigger protect_coverage_review_record_trigger
before update or delete on policy.coverage_review_records
for each row execute function regulatory.reject_immutable_row_change();

alter table policy.coverage_baseline_checklists enable row level security;
alter table policy.coverage_review_records enable row level security;

create function policy.create_coverage_baseline_checklist(
  p_checklist_id text,
  p_jurisdiction_code text,
  p_version_label text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = policy, regulatory, public, extensions
as $$
declare
  v_manifest jsonb;
  v_checksum text;
  v_item_count integer;
  v_distinct_item_count integer;
  v_item jsonb;
begin
  if p_checklist_id !~ '^[a-z0-9][a-z0-9._:-]{2,160}$' then
    raise exception 'invalid coverage checklist id';
  end if;
  if not exists (
    select 1 from policy.coverage_scopes where jurisdiction_code = p_jurisdiction_code
  ) then
    raise exception 'unknown coverage jurisdiction';
  end if;
  if nullif(btrim(p_version_label), '') is null
     or jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'coverage checklist requires a version and items';
  end if;
  if jsonb_array_length(p_items) = 0 then
    raise exception 'coverage checklist requires a version and items';
  end if;
  select count(*), count(distinct item->>'itemId')
  into v_item_count, v_distinct_item_count
  from jsonb_array_elements(p_items) item;
  if v_item_count <> v_distinct_item_count then
    raise exception 'coverage checklist items are invalid or duplicated';
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if nullif(btrim(v_item->>'itemId'), '') is null
       or nullif(btrim(v_item->>'title'), '') is null
       or jsonb_typeof(v_item->'supportingClaimIds') is distinct from 'array' then
      raise exception 'coverage checklist items are invalid or duplicated';
    end if;
    if jsonb_array_length(v_item->'supportingClaimIds') = 0 then
      raise exception 'coverage checklist items are invalid or duplicated';
    end if;
  end loop;
  v_manifest := jsonb_build_object(
    'schemaVersion', '1.0.0',
    'checklistId', p_checklist_id,
    'jurisdictionCode', p_jurisdiction_code,
    'versionLabel', btrim(p_version_label),
    'items', p_items
  );
  v_checksum := encode(
    extensions.digest(convert_to(v_manifest::text, 'UTF8'), 'sha256'), 'hex'
  );
  insert into policy.coverage_baseline_checklists (
    checklist_id, jurisdiction_code, version_label, items, checklist_sha256
  ) values (
    p_checklist_id, p_jurisdiction_code, btrim(p_version_label), p_items, v_checksum
  );
  return jsonb_build_object(
    'checklistId', p_checklist_id,
    'jurisdictionCode', p_jurisdiction_code,
    'checklistSha256', v_checksum
  );
end;
$$;

create function policy.get_coverage_review_manifest(
  p_jurisdiction_code text,
  p_checklist_id text,
  p_release_id text,
  p_freshness_cutoff timestamptz,
  p_public_note text
)
returns jsonb
language plpgsql
stable
set search_path = policy, regulatory, public, extensions
as $$
declare
  v_scope policy.coverage_scopes%rowtype;
  v_checklist policy.coverage_baseline_checklists%rowtype;
  v_release policy.corpus_releases%rowtype;
  v_manifest jsonb;
  v_readiness_errors text[];
begin
  select * into strict v_scope
  from policy.coverage_scopes where jurisdiction_code = p_jurisdiction_code;
  select * into strict v_checklist
  from policy.coverage_baseline_checklists where checklist_id = p_checklist_id;
  select * into strict v_release
  from policy.corpus_releases where release_id = p_release_id;

  select array_remove(array[
    case when v_scope.coverage_state <> 'IN_PROGRESS' then 'coverage_not_in_progress' end,
    case when v_checklist.jurisdiction_code <> p_jurisdiction_code
      then 'checklist_jurisdiction_mismatch' end,
    case when v_release.release_state <> 'PUBLISHED' then 'corpus_not_published' end,
    case when p_freshness_cutoff is null
      or p_freshness_cutoff > v_release.knowledge_cutoff
      then 'invalid_freshness_cutoff' end,
    case when not exists (
      select 1
      from policy.corpus_release_claims membership
      join policy.legal_claims claim on claim.claim_id = membership.claim_id
      where membership.release_id = p_release_id
        and claim.jurisdiction_code = p_jurisdiction_code
        and claim.review_state in ('REVIEWED', 'PUBLISHED')
    ) then 'jurisdiction_claims_missing' end,
    case when exists (
      select 1
      from jsonb_array_elements(v_checklist.items) item
      where not exists (
        select 1
        from jsonb_array_elements_text(item->'supportingClaimIds') supported(claim_id)
        join policy.corpus_release_claims membership
          on membership.release_id = p_release_id
         and membership.claim_id = supported.claim_id
        join policy.legal_claims claim on claim.claim_id = membership.claim_id
        where claim.jurisdiction_code = p_jurisdiction_code
          and claim.review_state in ('REVIEWED', 'PUBLISHED')
      )
    ) then 'checklist_item_unsupported' end,
    case when exists (
      select 1
      from policy.corpus_release_claims membership
      join policy.legal_claims claim on claim.claim_id = membership.claim_id
      join policy.citations citation on citation.claim_id = claim.claim_id
      join regulatory.provisions provision on provision.provision_id = citation.provision_id
      join regulatory.source_versions version on version.version_id = provision.version_id
      where membership.release_id = p_release_id
        and claim.jurisdiction_code = p_jurisdiction_code
        and version.retrieved_at < p_freshness_cutoff
    ) then 'source_freshness_failed' end
  ], null)
  into v_readiness_errors;

  v_manifest := jsonb_build_object(
    'schemaVersion', '1.0.0',
    'jurisdictionCode', p_jurisdiction_code,
    'targetCoverageState', 'REVIEWED',
    'targetCompletenessPercent', 100,
    'targetFreshnessState', 'CURRENT',
    'publicNote', nullif(btrim(p_public_note), ''),
    'freshnessCutoff', p_freshness_cutoff,
    'checklist', jsonb_build_object(
      'checklistId', v_checklist.checklist_id,
      'versionLabel', v_checklist.version_label,
      'checklistSha256', v_checklist.checklist_sha256,
      'items', v_checklist.items
    ),
    'corpusRelease', policy.build_corpus_release_manifest(p_release_id),
    'corpusManifestSha256', v_release.manifest_checksum_sha256
  );
  return jsonb_build_object(
    'manifest', v_manifest,
    'manifestSha256', encode(
      extensions.digest(convert_to(v_manifest::text, 'UTF8'), 'sha256'), 'hex'
    ),
    'readinessErrors', to_jsonb(v_readiness_errors)
  );
end;
$$;

create function policy.review_coverage_scope(
  p_coverage_review_id text,
  p_jurisdiction_code text,
  p_checklist_id text,
  p_release_id text,
  p_freshness_cutoff timestamptz,
  p_public_note text,
  p_manifest_sha256 text,
  p_reviewer_role text,
  p_reviewer_ref text,
  p_reviewed_at timestamptz,
  p_private_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = policy, regulatory, public, extensions
as $$
declare
  v_scope policy.coverage_scopes%rowtype;
  v_envelope jsonb;
begin
  if p_coverage_review_id !~ '^[a-z0-9][a-z0-9._:-]{2,160}$' then
    raise exception 'invalid coverage review id';
  end if;
  if nullif(btrim(p_reviewer_role), '') is null
     or nullif(btrim(p_reviewer_ref), '') is null
     or lower(btrim(p_reviewer_ref)) in ('ai', 'llm', 'system', 'automation', 'unknown') then
    raise exception 'coverage review requires an identified human reviewer';
  end if;
  if p_manifest_sha256 !~ '^[0-9a-f]{64}$'
     or p_reviewed_at is null
     or p_reviewed_at < p_freshness_cutoff
     or p_reviewed_at > now() + interval '5 minutes' then
    raise exception 'invalid coverage review evidence or time';
  end if;
  select * into strict v_scope
  from policy.coverage_scopes
  where jurisdiction_code = p_jurisdiction_code
  for update;
  if v_scope.coverage_state <> 'IN_PROGRESS' then
    raise exception 'only IN_PROGRESS coverage may be reviewed';
  end if;
  v_envelope := policy.get_coverage_review_manifest(
    p_jurisdiction_code, p_checklist_id, p_release_id,
    p_freshness_cutoff, p_public_note
  );
  if v_envelope->>'manifestSha256' is distinct from p_manifest_sha256 then
    raise exception 'coverage review manifest checksum mismatch';
  end if;
  if jsonb_array_length(v_envelope->'readinessErrors') > 0 then
    raise exception 'coverage scope is not ready for review';
  end if;

  insert into policy.coverage_review_records (
    coverage_review_id, jurisdiction_code, checklist_id, release_id,
    freshness_cutoff, manifest_sha256, reviewer_role, reviewer_ref,
    reviewed_at, private_notes
  ) values (
    p_coverage_review_id, p_jurisdiction_code, p_checklist_id, p_release_id,
    p_freshness_cutoff, p_manifest_sha256, btrim(p_reviewer_role),
    btrim(p_reviewer_ref), p_reviewed_at, nullif(btrim(p_private_notes), '')
  );
  update policy.coverage_scopes
  set coverage_state = 'REVIEWED',
      completeness_percent = 100,
      freshness_state = 'CURRENT',
      reviewed_at = p_reviewed_at,
      public_note = nullif(btrim(p_public_note), ''),
      updated_at = now()
  where jurisdiction_code = p_jurisdiction_code;
  return jsonb_build_object(
    'coverageReviewId', p_coverage_review_id,
    'jurisdictionCode', p_jurisdiction_code,
    'coverageState', 'REVIEWED',
    'completenessPercent', 100,
    'freshnessState', 'CURRENT',
    'manifestSha256', p_manifest_sha256,
    'reviewedAt', p_reviewed_at
  );
end;
$$;

revoke update, delete on table policy.coverage_scopes from service_role;
grant select on table policy.coverage_scopes to service_role;
revoke all on table policy.coverage_baseline_checklists, policy.coverage_review_records
from public, anon, authenticated;
grant select on table policy.coverage_baseline_checklists, policy.coverage_review_records
to service_role;

revoke all on function policy.create_coverage_baseline_checklist(text, text, text, jsonb)
from public, anon, authenticated;
grant execute on function policy.create_coverage_baseline_checklist(text, text, text, jsonb)
to service_role;
revoke all on function policy.get_coverage_review_manifest(
  text, text, text, timestamptz, text
) from public, anon, authenticated;
grant execute on function policy.get_coverage_review_manifest(
  text, text, text, timestamptz, text
) to service_role;
revoke all on function policy.review_coverage_scope(
  text, text, text, text, timestamptz, text, text, text, text, timestamptz, text
) from public, anon, authenticated;
grant execute on function policy.review_coverage_scope(
  text, text, text, text, timestamptz, text, text, text, text, timestamptz, text
) to service_role;

comment on table policy.coverage_baseline_checklists is
  'Immutable versioned jurisdiction baseline definitions with explicit supporting claim IDs.';
comment on function policy.review_coverage_scope is
  'Atomically records named-human baseline and freshness review before setting coverage to REVIEWED.';

commit;
