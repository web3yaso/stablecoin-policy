begin;

alter table regulatory.regulatory_events
  add column candidate_manifest_sha256 text
    check (candidate_manifest_sha256 is null or candidate_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  add column reviewed_at timestamptz,
  add column published_at timestamptz,
  add constraint regulatory_events_review_times_check check (
    (event_state not in ('REVIEWED', 'PUBLISHED') or reviewed_at is not null)
    and (event_state <> 'PUBLISHED' or published_at is not null)
  );

create table regulatory.regulatory_event_review_records (
  event_review_id text primary key
    check (event_review_id ~ '^[a-z0-9][a-z0-9._:-]{2,160}$'),
  event_id text not null references regulatory.regulatory_events(event_id),
  outcome text not null check (outcome in ('APPROVED', 'REJECTED')),
  reviewer_role text not null check (length(btrim(reviewer_role)) > 0),
  reviewer_ref text not null check (length(btrim(reviewer_ref)) > 0),
  manifest_sha256 text not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  reviewed_at timestamptz not null,
  private_notes text,
  created_at timestamptz not null default now()
);

create table policy.event_claim_impact_review_records (
  impact_review_id text primary key
    check (impact_review_id ~ '^[a-z0-9][a-z0-9._:-]{2,160}$'),
  event_id text not null,
  claim_id text not null,
  outcome text not null check (outcome in ('REVIEWED', 'DISMISSED')),
  impact_type text not null
    check (impact_type in ('MAY_AFFECT', 'INVALIDATES', 'SUPERSEDES', 'DEADLINE')),
  reviewer_role text not null check (length(btrim(reviewer_role)) > 0),
  reviewer_ref text not null check (length(btrim(reviewer_ref)) > 0),
  manifest_sha256 text not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  reviewed_at timestamptz not null,
  private_notes text,
  created_at timestamptz not null default now(),
  foreign key (event_id, claim_id)
    references policy.event_claim_impacts(event_id, claim_id)
);

create trigger protect_regulatory_event_review_record_trigger
before update or delete on regulatory.regulatory_event_review_records
for each row execute function regulatory.reject_immutable_row_change();

create trigger protect_event_claim_impact_review_record_trigger
before update or delete on policy.event_claim_impact_review_records
for each row execute function regulatory.reject_immutable_row_change();

alter table regulatory.regulatory_event_review_records enable row level security;
alter table policy.event_claim_impact_review_records enable row level security;

create function policy.build_regulatory_change_candidate_manifest(
  p_before_version_id text,
  p_after_version_id text
)
returns jsonb
language sql
stable
set search_path = policy, regulatory, public
as $$
  with version_context as (
    select
      before_version.version_id as before_version_id,
      before_version.checksum_sha256 as before_checksum_sha256,
      before_version.document_id,
      after_version.version_id as after_version_id,
      after_version.checksum_sha256 as after_checksum_sha256,
      document.authority_id
    from regulatory.source_versions before_version
    join regulatory.source_versions after_version
      on after_version.version_id = p_after_version_id
    join regulatory.source_documents document
      on document.document_id = before_version.document_id
    where before_version.version_id = p_before_version_id
  ),
  before_provisions as (
    select locator, language_code, provision_id, text_checksum_sha256
    from regulatory.provisions where version_id = p_before_version_id
  ),
  after_provisions as (
    select locator, language_code, provision_id, text_checksum_sha256
    from regulatory.provisions where version_id = p_after_version_id
  ),
  provision_changes as (
    select
      coalesce(before_provision.locator, after_provision.locator) as locator,
      coalesce(before_provision.language_code, after_provision.language_code) as language_code,
      before_provision.provision_id as before_provision_id,
      after_provision.provision_id as after_provision_id,
      before_provision.text_checksum_sha256 as before_text_checksum_sha256,
      after_provision.text_checksum_sha256 as after_text_checksum_sha256,
      case
        when before_provision.provision_id is null then 'ADDED'
        when after_provision.provision_id is null then 'REMOVED'
        else 'MODIFIED'
      end as change_type
    from before_provisions before_provision
    full join after_provisions after_provision
      using (locator, language_code)
    where before_provision.text_checksum_sha256 is distinct from
      after_provision.text_checksum_sha256
  ),
  claim_candidates as (
    select distinct claim.claim_id, claim.jurisdiction_code, claim.topic
    from policy.legal_claims claim
    join policy.citations citation on citation.claim_id = claim.claim_id
    join regulatory.provisions provision
      on provision.provision_id = citation.provision_id
    where provision.version_id = p_before_version_id
      and claim.review_state in ('REVIEWED', 'PUBLISHED')
  )
  select jsonb_build_object(
    'schemaVersion', '1.0.0',
    'documentId', context.document_id,
    'authorityId', context.authority_id,
    'beforeVersionId', context.before_version_id,
    'beforeVersionChecksumSha256', context.before_checksum_sha256,
    'afterVersionId', context.after_version_id,
    'afterVersionChecksumSha256', context.after_checksum_sha256,
    'provisionChanges', coalesce((
      select jsonb_agg(jsonb_build_object(
        'changeType', change.change_type,
        'locator', change.locator,
        'languageCode', change.language_code,
        'beforeProvisionId', change.before_provision_id,
        'beforeTextChecksumSha256', change.before_text_checksum_sha256,
        'afterProvisionId', change.after_provision_id,
        'afterTextChecksumSha256', change.after_text_checksum_sha256
      ) order by change.locator, change.language_code)
      from provision_changes change
    ), '[]'::jsonb),
    'claimCandidates', coalesce((
      select jsonb_agg(jsonb_build_object(
        'claimId', candidate.claim_id,
        'jurisdictionCode', candidate.jurisdiction_code,
        'topic', candidate.topic
      ) order by candidate.claim_id)
      from claim_candidates candidate
    ), '[]'::jsonb)
  )
  from version_context context;
$$;

create function policy.get_regulatory_change_candidate_manifest(
  p_before_version_id text,
  p_after_version_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = policy, regulatory, public, extensions
as $$
declare
  v_before regulatory.source_versions%rowtype;
  v_after regulatory.source_versions%rowtype;
  v_manifest jsonb;
  v_errors text[];
begin
  if p_before_version_id = p_after_version_id then
    raise exception 'regulatory change requires two distinct source versions';
  end if;
  select * into strict v_before from regulatory.source_versions
  where version_id = p_before_version_id;
  select * into strict v_after from regulatory.source_versions
  where version_id = p_after_version_id;
  v_manifest := policy.build_regulatory_change_candidate_manifest(
    p_before_version_id, p_after_version_id
  );
  select array_remove(array[
    case when v_before.document_id <> v_after.document_id
      then 'source_document_mismatch' end,
    case when v_before.lifecycle_state not in ('VERIFIED', 'SUPERSEDED', 'CORRECTED')
      or not exists (
        select 1 from regulatory.source_verification_records record
        where record.version_id = v_before.version_id and record.outcome = 'APPROVED'
      ) then 'before_version_unverified' end,
    case when v_after.lifecycle_state not in ('VERIFIED', 'SUPERSEDED', 'CORRECTED')
      or not exists (
        select 1 from regulatory.source_verification_records record
        where record.version_id = v_after.version_id and record.outcome = 'APPROVED'
      ) then 'after_version_unverified' end,
    case when jsonb_array_length(v_manifest->'provisionChanges') = 0
      then 'provision_diff_empty' end,
    case when jsonb_array_length(v_manifest->'claimCandidates') = 0
      then 'claim_candidates_missing' end
  ], null) into v_errors;
  return jsonb_build_object(
    'manifest', v_manifest,
    'manifestSha256', encode(
      extensions.digest(convert_to(v_manifest::text, 'UTF8'), 'sha256'), 'hex'
    ),
    'readinessErrors', to_jsonb(v_errors),
    'legalImpactAssessed', false,
    'humanReviewRequired', true
  );
end;
$$;

create function policy.create_regulatory_event_candidate(
  p_event_id text,
  p_before_version_id text,
  p_after_version_id text,
  p_event_type text,
  p_title text,
  p_observed_at timestamptz,
  p_effective_at timestamptz,
  p_manifest_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = policy, regulatory, public
as $$
declare
  v_envelope jsonb;
  v_manifest jsonb;
  v_existing regulatory.regulatory_events%rowtype;
  v_impact_count integer;
begin
  if p_event_type not in ('PUBLICATION', 'AMENDMENT', 'EFFECTIVE_DATE', 'DEADLINE', 'CORRECTION', 'REPEAL') then
    raise exception 'invalid regulatory event type';
  end if;
  if nullif(btrim(p_title), '') is null then
    raise exception 'regulatory event title is required';
  end if;
  if p_observed_at is null or p_observed_at > now() + interval '5 minutes' then
    raise exception 'regulatory event observed_at is invalid';
  end if;
  v_envelope := policy.get_regulatory_change_candidate_manifest(
    p_before_version_id, p_after_version_id
  );
  if p_manifest_sha256 is distinct from v_envelope->>'manifestSha256' then
    raise exception 'regulatory change manifest checksum mismatch';
  end if;
  if jsonb_array_length(v_envelope->'readinessErrors') > 0 then
    raise exception 'regulatory change candidate is not ready: %',
      v_envelope->'readinessErrors';
  end if;
  select * into v_existing from regulatory.regulatory_events
  where event_id = p_event_id;
  if found then
    if v_existing.before_version_id = p_before_version_id
      and v_existing.after_version_id = p_after_version_id
      and v_existing.event_type = p_event_type
      and v_existing.title = btrim(p_title)
      and v_existing.observed_at = p_observed_at
      and v_existing.effective_at is not distinct from p_effective_at
      and v_existing.candidate_manifest_sha256 = p_manifest_sha256 then
      select count(*)::integer into v_impact_count
      from policy.event_claim_impacts where event_id = p_event_id;
      return jsonb_build_object(
        'eventId', p_event_id, 'eventState', v_existing.event_state,
        'impactCount', v_impact_count, 'replayed', true
      );
    end if;
    raise exception 'regulatory event ID already exists with different content';
  end if;
  v_manifest := v_envelope->'manifest';
  insert into regulatory.regulatory_events (
    event_id, authority_id, before_version_id, after_version_id,
    event_type, title, observed_at, effective_at, event_state,
    candidate_manifest_sha256
  ) values (
    p_event_id, v_manifest->>'authorityId', p_before_version_id,
    p_after_version_id, p_event_type, btrim(p_title), p_observed_at,
    p_effective_at, 'CANDIDATE', p_manifest_sha256
  );
  insert into policy.event_claim_impacts (
    event_id, claim_id, impact_type, review_state
  )
  select p_event_id, candidate->>'claimId', 'MAY_AFFECT', 'PENDING'
  from jsonb_array_elements(v_manifest->'claimCandidates') candidate;
  get diagnostics v_impact_count = row_count;
  return jsonb_build_object(
    'eventId', p_event_id, 'eventState', 'CANDIDATE',
    'impactCount', v_impact_count, 'replayed', false,
    'legalImpactAssessed', false
  );
end;
$$;

create function policy.get_regulatory_event_review_manifest(p_event_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = policy, regulatory, public
as $$
declare
  v_event regulatory.regulatory_events%rowtype;
  v_envelope jsonb;
  v_impacts jsonb;
begin
  select * into strict v_event from regulatory.regulatory_events
  where event_id = p_event_id;
  v_envelope := policy.get_regulatory_change_candidate_manifest(
    v_event.before_version_id, v_event.after_version_id
  );
  select coalesce(jsonb_agg(jsonb_build_object(
    'claimId', impact.claim_id,
    'impactType', impact.impact_type,
    'reviewState', impact.review_state,
    'jurisdictionCode', claim.jurisdiction_code,
    'topic', claim.topic
  ) order by impact.claim_id), '[]'::jsonb)
  into v_impacts
  from policy.event_claim_impacts impact
  join policy.legal_claims claim on claim.claim_id = impact.claim_id
  where impact.event_id = p_event_id;
  return jsonb_build_object(
    'eventId', v_event.event_id,
    'eventType', v_event.event_type,
    'title', v_event.title,
    'observedAt', v_event.observed_at,
    'effectiveAt', v_event.effective_at,
    'eventState', v_event.event_state,
    'candidateManifestSha256', v_event.candidate_manifest_sha256,
    'currentManifestSha256', v_envelope->>'manifestSha256',
    'readinessErrors', v_envelope->'readinessErrors',
    'impacts', v_impacts,
    'humanReviewRequired', true,
    'automaticPublicationAllowed', false
  );
end;
$$;

create function policy.review_regulatory_event(
  p_event_review_id text,
  p_event_id text,
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
set search_path = policy, regulatory, public
as $$
declare
  v_event regulatory.regulatory_events%rowtype;
  v_envelope jsonb;
  v_state text;
begin
  select * into strict v_event from regulatory.regulatory_events
  where event_id = p_event_id for update;
  if v_event.event_state <> 'CANDIDATE' then
    raise exception 'only CANDIDATE regulatory events may be reviewed';
  end if;
  if p_outcome not in ('APPROVED', 'REJECTED') then
    raise exception 'invalid regulatory event review outcome';
  end if;
  if nullif(btrim(p_reviewer_role), '') is null
    or nullif(btrim(p_reviewer_ref), '') is null
    or lower(btrim(p_reviewer_ref)) in ('ai', 'llm', 'system', 'automation', 'unknown') then
    raise exception 'regulatory event review requires an identified human reviewer';
  end if;
  if p_reviewed_at is null or p_reviewed_at < v_event.observed_at
    or p_reviewed_at > now() + interval '5 minutes' then
    raise exception 'regulatory event reviewed_at is invalid';
  end if;
  v_envelope := policy.get_regulatory_change_candidate_manifest(
    v_event.before_version_id, v_event.after_version_id
  );
  if p_manifest_sha256 is distinct from v_event.candidate_manifest_sha256
    or p_manifest_sha256 is distinct from v_envelope->>'manifestSha256' then
    raise exception 'regulatory change manifest checksum mismatch';
  end if;
  if p_outcome = 'APPROVED' and jsonb_array_length(v_envelope->'readinessErrors') > 0 then
    raise exception 'regulatory event is not ready for approval';
  end if;
  insert into regulatory.regulatory_event_review_records (
    event_review_id, event_id, outcome, reviewer_role, reviewer_ref,
    manifest_sha256, reviewed_at, private_notes
  ) values (
    p_event_review_id, p_event_id, p_outcome, btrim(p_reviewer_role),
    btrim(p_reviewer_ref), p_manifest_sha256, p_reviewed_at,
    nullif(btrim(p_private_notes), '')
  );
  v_state := case when p_outcome = 'APPROVED' then 'REVIEWED' else 'RETRACTED' end;
  update regulatory.regulatory_events set
    event_state = v_state,
    reviewed_at = case when p_outcome = 'APPROVED' then p_reviewed_at else null end
  where event_id = p_event_id;
  return jsonb_build_object(
    'eventId', p_event_id, 'eventState', v_state,
    'manifestSha256', p_manifest_sha256
  );
end;
$$;

create function policy.review_regulatory_event_impact(
  p_impact_review_id text,
  p_event_id text,
  p_claim_id text,
  p_outcome text,
  p_impact_type text,
  p_reviewer_role text,
  p_reviewer_ref text,
  p_manifest_sha256 text,
  p_reviewed_at timestamptz,
  p_private_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = policy, regulatory, public
as $$
declare
  v_event regulatory.regulatory_events%rowtype;
  v_impact policy.event_claim_impacts%rowtype;
  v_envelope jsonb;
begin
  select * into strict v_event from regulatory.regulatory_events
  where event_id = p_event_id for update;
  select * into strict v_impact from policy.event_claim_impacts
  where event_id = p_event_id and claim_id = p_claim_id for update;
  if v_event.event_state <> 'REVIEWED' then
    raise exception 'impact review requires a REVIEWED regulatory event';
  end if;
  if v_impact.review_state <> 'PENDING' then
    raise exception 'only PENDING regulatory event impacts may be reviewed';
  end if;
  if p_outcome not in ('REVIEWED', 'DISMISSED') then
    raise exception 'invalid regulatory event impact outcome';
  end if;
  if p_impact_type not in ('MAY_AFFECT', 'INVALIDATES', 'SUPERSEDES', 'DEADLINE') then
    raise exception 'invalid regulatory event impact type';
  end if;
  if nullif(btrim(p_reviewer_role), '') is null
    or nullif(btrim(p_reviewer_ref), '') is null
    or lower(btrim(p_reviewer_ref)) in ('ai', 'llm', 'system', 'automation', 'unknown') then
    raise exception 'regulatory event impact review requires an identified human reviewer';
  end if;
  if p_reviewed_at is null or p_reviewed_at < v_event.reviewed_at
    or p_reviewed_at > now() + interval '5 minutes' then
    raise exception 'regulatory event impact reviewed_at is invalid';
  end if;
  v_envelope := policy.get_regulatory_change_candidate_manifest(
    v_event.before_version_id, v_event.after_version_id
  );
  if p_manifest_sha256 is distinct from v_event.candidate_manifest_sha256
    or p_manifest_sha256 is distinct from v_envelope->>'manifestSha256' then
    raise exception 'regulatory change manifest checksum mismatch';
  end if;
  insert into policy.event_claim_impact_review_records (
    impact_review_id, event_id, claim_id, outcome, impact_type,
    reviewer_role, reviewer_ref, manifest_sha256, reviewed_at, private_notes
  ) values (
    p_impact_review_id, p_event_id, p_claim_id, p_outcome, p_impact_type,
    btrim(p_reviewer_role), btrim(p_reviewer_ref), p_manifest_sha256,
    p_reviewed_at, nullif(btrim(p_private_notes), '')
  );
  update policy.event_claim_impacts set
    impact_type = p_impact_type,
    review_state = p_outcome
  where event_id = p_event_id and claim_id = p_claim_id;
  return jsonb_build_object(
    'eventId', p_event_id, 'claimId', p_claim_id,
    'impactType', p_impact_type, 'reviewState', p_outcome
  );
end;
$$;

create function policy.publish_regulatory_event(
  p_event_id text,
  p_manifest_sha256 text,
  p_published_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = policy, regulatory, public
as $$
declare
  v_event regulatory.regulatory_events%rowtype;
  v_envelope jsonb;
  v_pending_count integer;
  v_reviewed_count integer;
begin
  select * into strict v_event from regulatory.regulatory_events
  where event_id = p_event_id for update;
  if v_event.event_state <> 'REVIEWED' then
    raise exception 'only REVIEWED regulatory events may be published';
  end if;
  if p_published_at is null or p_published_at < v_event.reviewed_at
    or p_published_at > now() + interval '5 minutes' then
    raise exception 'regulatory event published_at is invalid';
  end if;
  v_envelope := policy.get_regulatory_change_candidate_manifest(
    v_event.before_version_id, v_event.after_version_id
  );
  if p_manifest_sha256 is distinct from v_event.candidate_manifest_sha256
    or p_manifest_sha256 is distinct from v_envelope->>'manifestSha256' then
    raise exception 'regulatory change manifest checksum mismatch';
  end if;
  if jsonb_array_length(v_envelope->'readinessErrors') > 0 then
    raise exception 'regulatory event is not ready for publication';
  end if;
  if not exists (
    select 1 from regulatory.regulatory_event_review_records review
    where review.event_id = p_event_id and review.outcome = 'APPROVED'
      and review.manifest_sha256 = p_manifest_sha256
  ) then
    raise exception 'regulatory event has no current human approval';
  end if;
  select
    count(*) filter (where impact.review_state = 'PENDING')::integer,
    count(*) filter (where impact.review_state = 'REVIEWED')::integer
  into v_pending_count, v_reviewed_count
  from policy.event_claim_impacts impact where impact.event_id = p_event_id;
  if v_pending_count > 0 then
    raise exception 'all regulatory event impacts require human disposition';
  end if;
  if v_reviewed_count = 0 then
    raise exception 'regulatory event publication requires a reviewed claim impact';
  end if;
  if exists (
    select 1 from policy.event_claim_impacts impact
    where impact.event_id = p_event_id and impact.review_state = 'REVIEWED'
      and not exists (
        select 1 from policy.event_claim_impact_review_records review
        where review.event_id = impact.event_id and review.claim_id = impact.claim_id
          and review.outcome = 'REVIEWED'
          and review.manifest_sha256 = p_manifest_sha256
      )
  ) then
    raise exception 'regulatory event impact has no current human approval';
  end if;
  update regulatory.regulatory_events set
    event_state = 'PUBLISHED', published_at = p_published_at
  where event_id = p_event_id;
  return jsonb_build_object(
    'eventId', p_event_id, 'eventState', 'PUBLISHED',
    'manifestSha256', p_manifest_sha256, 'publishedAt', p_published_at
  );
end;
$$;

create function policy.get_regulatory_change_backup_metadata()
returns jsonb
language sql
stable
security definer
set search_path = policy, regulatory, public
as $$
  select jsonb_build_object(
    'regulatoryEvents', coalesce((
      select jsonb_agg(to_jsonb(event) order by event.event_id)
      from regulatory.regulatory_events event
    ), '[]'::jsonb),
    'regulatoryEventReviewRecords', coalesce((
      select jsonb_agg(to_jsonb(review) order by review.event_review_id)
      from regulatory.regulatory_event_review_records review
    ), '[]'::jsonb)
  );
$$;

revoke insert, update, delete on regulatory.regulatory_events from service_role;
revoke insert, update, delete on policy.event_claim_impacts from service_role;
revoke all on regulatory.regulatory_event_review_records from public, anon, authenticated, service_role;
revoke all on policy.event_claim_impact_review_records from public, anon, authenticated, service_role;
grant select on regulatory.regulatory_events,
  regulatory.regulatory_event_review_records to service_role;
grant select on policy.event_claim_impacts,
  policy.event_claim_impact_review_records to service_role;

revoke all on function policy.build_regulatory_change_candidate_manifest(text, text)
from public, anon, authenticated, service_role;
revoke all on function policy.get_regulatory_change_candidate_manifest(text, text)
from public, anon, authenticated;
revoke all on function policy.create_regulatory_event_candidate(
  text, text, text, text, text, timestamptz, timestamptz, text
) from public, anon, authenticated;
revoke all on function policy.get_regulatory_event_review_manifest(text)
from public, anon, authenticated;
revoke all on function policy.review_regulatory_event(
  text, text, text, text, text, text, timestamptz, text
) from public, anon, authenticated;
revoke all on function policy.review_regulatory_event_impact(
  text, text, text, text, text, text, text, text, timestamptz, text
) from public, anon, authenticated;
revoke all on function policy.publish_regulatory_event(text, text, timestamptz)
from public, anon, authenticated;
revoke all on function policy.get_regulatory_change_backup_metadata()
from public, anon, authenticated;

grant execute on function policy.get_regulatory_change_candidate_manifest(text, text),
  policy.create_regulatory_event_candidate(
    text, text, text, text, text, timestamptz, timestamptz, text
  ),
  policy.get_regulatory_event_review_manifest(text),
  policy.review_regulatory_event(
    text, text, text, text, text, text, timestamptz, text
  ),
  policy.review_regulatory_event_impact(
    text, text, text, text, text, text, text, text, timestamptz, text
  ),
  policy.publish_regulatory_event(text, text, timestamptz),
  policy.get_regulatory_change_backup_metadata()
to service_role;

comment on function policy.create_regulatory_event_candidate is
  'Creates only CANDIDATE/PENDING change state from a current deterministic version diff; it cannot publish or alter claims.';
comment on table regulatory.regulatory_event_review_records is
  'Immutable private named-human review audit for regulatory events.';
comment on table policy.event_claim_impact_review_records is
  'Immutable private named-human review audit for Stablecoin claim impacts.';

commit;
