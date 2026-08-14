begin;

do $$
begin
  if exists (select 1 from policy.playbook_packages) then
    raise exception 'migration 0031 requires an explicit dependency backfill for existing playbook packages';
  end if;
end;
$$;

create table policy.playbook_package_claim_dependencies (
  package_id text not null
    references policy.playbook_packages(package_id),
  claim_id text not null references policy.legal_claims(claim_id),
  dependency_basis text not null default 'DECISION_EVIDENCE'
    check (dependency_basis = 'DECISION_EVIDENCE'),
  created_at timestamptz not null default now(),
  primary key (package_id, claim_id)
);

create index playbook_package_claim_dependencies_claim_idx
  on policy.playbook_package_claim_dependencies (claim_id, package_id);

create trigger playbook_package_claim_dependencies_immutable
before update or delete on policy.playbook_package_claim_dependencies
for each row execute function regulatory.reject_immutable_row_change();

alter table policy.playbook_package_claim_dependencies enable row level security;

create function policy.register_playbook_package_with_dependencies(
  p_object_id text,
  p_provider text,
  p_bucket text,
  p_object_key text,
  p_artifact_checksum_sha256 text,
  p_byte_size bigint,
  p_content_type text,
  p_package_id text,
  p_playbook_id text,
  p_profile_fingerprint text,
  p_integrity_sha256 text,
  p_schema_version text,
  p_evaluated_at timestamptz,
  p_assurance_review_status text,
  p_corpus_release_id text,
  p_retrieval_index_release_id text,
  p_dossier_id text,
  p_rules_version text,
  p_template_version text,
  p_idempotency_key_sha256 text,
  p_request_fingerprint_sha256 text,
  p_evidence_claim_ids text[]
)
returns text
language plpgsql
security definer
set search_path = policy, regulatory, public
as $$
declare
  v_package_id text;
  v_claim_ids text[];
  v_existing_claim_ids text[];
begin
  if p_evidence_claim_ids is null then
    raise exception 'playbook evidence claim IDs are required';
  end if;
  if exists (
    select 1 from unnest(p_evidence_claim_ids) claim_id
    where claim_id is null or nullif(btrim(claim_id), '') is null
  ) then
    raise exception 'playbook evidence claim IDs are invalid';
  end if;
  if cardinality(p_evidence_claim_ids) <> (
    select count(distinct claim_id)::integer
    from unnest(p_evidence_claim_ids) claim_id
  ) then
    raise exception 'playbook evidence claim IDs must be unique';
  end if;

  select coalesce(array_agg(claim_id order by claim_id), '{}'::text[])
    into v_claim_ids
  from unnest(p_evidence_claim_ids) claim_id;

  if cardinality(v_claim_ids) > 0 and p_corpus_release_id is null then
    raise exception 'playbook evidence claims require a corpus release';
  end if;
  if p_assurance_review_status = 'PROVISIONAL' and exists (
    select 1 from unnest(v_claim_ids) candidate(claim_id)
    where not exists (
      select 1 from policy.provisional_release_claims member
      where member.release_id = p_corpus_release_id
        and member.claim_id = candidate.claim_id
    )
  ) then
    raise exception 'playbook evidence claim is outside the provisional corpus release';
  end if;
  if p_assurance_review_status = 'HUMAN_REVIEWED' and exists (
    select 1 from unnest(v_claim_ids) candidate(claim_id)
    where not exists (
      select 1 from policy.corpus_release_claims member
      where member.release_id = p_corpus_release_id
        and member.claim_id = candidate.claim_id
    )
  ) then
    raise exception 'playbook evidence claim is outside the reviewed corpus release';
  end if;

  v_package_id := policy.register_playbook_package(
    p_object_id,
    p_provider,
    p_bucket,
    p_object_key,
    p_artifact_checksum_sha256,
    p_byte_size,
    p_content_type,
    p_package_id,
    p_playbook_id,
    p_profile_fingerprint,
    p_integrity_sha256,
    p_schema_version,
    p_evaluated_at,
    p_assurance_review_status,
    p_corpus_release_id,
    p_retrieval_index_release_id,
    p_dossier_id,
    p_rules_version,
    p_template_version,
    p_idempotency_key_sha256,
    p_request_fingerprint_sha256
  );

  select coalesce(array_agg(dependency.claim_id order by dependency.claim_id), '{}'::text[])
    into v_existing_claim_ids
  from policy.playbook_package_claim_dependencies dependency
  where dependency.package_id = p_package_id;

  if cardinality(v_existing_claim_ids) > 0
     and v_existing_claim_ids <> v_claim_ids then
    raise exception 'immutable playbook package claim dependency conflict for %',
      p_package_id;
  end if;

  if cardinality(v_existing_claim_ids) = 0 then
    insert into policy.playbook_package_claim_dependencies (
      package_id, claim_id, dependency_basis
    )
    select p_package_id, claim_id, 'DECISION_EVIDENCE'
    from unnest(v_claim_ids) claim_id;
  end if;

  return v_package_id;
end;
$$;

create function policy.get_affected_playbook_packages(p_event_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = policy, regulatory, public
as $$
declare
  v_event_state text;
  v_packages jsonb;
begin
  select event.event_state into v_event_state
  from regulatory.regulatory_events event
  where event.event_id = p_event_id;

  if not found then
    raise exception 'unknown regulatory event %', p_event_id;
  end if;
  if v_event_state <> 'PUBLISHED' then
    raise exception 'regulatory event is not published';
  end if;

  with affected as (
    select
      package.package_id,
      package.playbook_id,
      package.evaluated_at,
      package.assurance_review_status,
      dependency.claim_id,
      impact.impact_type
    from policy.event_claim_impacts impact
    join policy.playbook_package_claim_dependencies dependency
      on dependency.claim_id = impact.claim_id
    join policy.playbook_packages package
      on package.package_id = dependency.package_id
    where impact.event_id = p_event_id
      and impact.review_state = 'REVIEWED'
  ), grouped as (
    select
      affected.package_id,
      affected.playbook_id,
      affected.evaluated_at,
      affected.assurance_review_status,
      jsonb_agg(jsonb_build_object(
        'claimId', affected.claim_id,
        'impactType', affected.impact_type
      ) order by affected.claim_id) as claim_impacts
    from affected
    group by
      affected.package_id,
      affected.playbook_id,
      affected.evaluated_at,
      affected.assurance_review_status
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'packageId', grouped.package_id,
    'playbookId', grouped.playbook_id,
    'evaluatedAt', grouped.evaluated_at,
    'assuranceReviewStatus', grouped.assurance_review_status,
    'claimImpacts', grouped.claim_impacts
  ) order by grouped.package_id), '[]'::jsonb)
  into v_packages
  from grouped;

  return jsonb_build_object(
    'schemaVersion', '1.0.0',
    'eventId', p_event_id,
    'eventState', v_event_state,
    'packages', v_packages
  );
end;
$$;

revoke all on table policy.playbook_package_claim_dependencies
from public, anon, authenticated, service_role;

grant select on table policy.playbook_package_claim_dependencies
to service_role;

revoke execute on function policy.register_playbook_package(
  text,text,text,text,text,bigint,text,text,text,text,text,text,timestamptz,
  text,text,text,text,text,text,text,text
) from service_role;

revoke all on function policy.register_playbook_package_with_dependencies(
  text,text,text,text,text,bigint,text,text,text,text,text,text,timestamptz,
  text,text,text,text,text,text,text,text,text[]
), policy.get_affected_playbook_packages(text)
from public, anon, authenticated, service_role;

grant execute on function policy.register_playbook_package_with_dependencies(
  text,text,text,text,text,bigint,text,text,text,text,text,text,timestamptz,
  text,text,text,text,text,text,text,text,text[]
), policy.get_affected_playbook_packages(text)
to service_role;

comment on table policy.playbook_package_claim_dependencies is
  'Immutable decision-evidence claim dependencies for paid packages. This index stores no customer profile, rule, prompt, action, or artifact body.';

comment on function policy.register_playbook_package_with_dependencies is
  'Atomically registers immutable package metadata, idempotency completion, and the exact decision-evidence claim dependency set.';

comment on function policy.get_affected_playbook_packages is
  'Returns packages linked to REVIEWED claim impacts only after the regulatory event is PUBLISHED; service-only foundation for Phase 6 watchlists.';

commit;
