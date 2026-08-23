begin;

alter table policy.playbook_package_watchlists
  drop constraint playbook_package_watchlists_watchlist_state_check;
alter table policy.playbook_package_watchlists
  add constraint playbook_package_watchlists_watchlist_state_check
  check (watchlist_state in ('ACTIVE', 'SUPERSEDED'));

drop trigger playbook_package_watchlists_immutable
  on policy.playbook_package_watchlists;

create function policy.guard_playbook_package_watchlist_change()
returns trigger
language plpgsql
set search_path = policy, public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'playbook package watchlists cannot be deleted';
  end if;
  if current_user <> 'postgres'
     or old.watchlist_id <> new.watchlist_id
     or old.package_id <> new.package_id
     or old.created_at <> new.created_at
     or old.watchlist_state <> 'ACTIVE'
     or new.watchlist_state <> 'SUPERSEDED' then
    raise exception 'playbook package watchlist transition is not allowed';
  end if;
  return new;
end;
$$;

create trigger playbook_package_watchlists_guard
before update or delete on policy.playbook_package_watchlists
for each row execute function policy.guard_playbook_package_watchlist_change();

create table policy.playbook_package_rerun_attempts (
  rerun_id text primary key
    check (rerun_id ~ '^rerun:[0-9a-f]{32}$'),
  idempotency_key_sha256 text not null unique
    references policy.playbook_package_idempotency(idempotency_key_sha256),
  request_fingerprint_sha256 text not null
    check (request_fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
  base_package_id text not null references policy.playbook_packages(package_id),
  base_watchlist_id text not null
    references policy.playbook_package_watchlists(watchlist_id),
  playbook_id text not null,
  profile_fingerprint text not null
    check (profile_fingerprint ~ '^[0-9a-f]{64}$'),
  delta_ids text[] not null check (cardinality(delta_ids) > 0),
  delta_count integer not null check (delta_count > 0),
  through_sequence bigint not null check (through_sequence > 0),
  rerun_state text not null default 'CLAIMED'
    check (rerun_state in ('CLAIMED', 'STALE', 'COMPLETED')),
  successor_package_id text references policy.playbook_packages(package_id),
  claimed_at timestamptz not null default now(),
  stale_at timestamptz,
  completed_at timestamptz,
  check (delta_count = cardinality(delta_ids)),
  check (
    (rerun_state = 'CLAIMED' and successor_package_id is null
      and stale_at is null and completed_at is null)
    or (rerun_state = 'STALE' and successor_package_id is null
      and stale_at is not null and completed_at is null)
    or (rerun_state = 'COMPLETED' and successor_package_id is not null
      and stale_at is null and completed_at is not null)
  )
);

create table policy.playbook_package_lineage (
  base_package_id text primary key references policy.playbook_packages(package_id),
  successor_package_id text not null unique
    references policy.playbook_packages(package_id),
  rerun_id text not null unique
    references policy.playbook_package_rerun_attempts(rerun_id),
  created_at timestamptz not null default now(),
  check (base_package_id <> successor_package_id)
);

create table policy.playbook_package_delta_coverage (
  delta_id text primary key
    references policy.playbook_watchlist_change_deltas(delta_id),
  rerun_id text not null references policy.playbook_package_rerun_attempts(rerun_id),
  base_package_id text not null references policy.playbook_packages(package_id),
  successor_package_id text not null references policy.playbook_packages(package_id),
  covered_at timestamptz not null default now()
);

create index playbook_package_rerun_attempts_base_idx
  on policy.playbook_package_rerun_attempts (base_package_id, claimed_at);
create index playbook_package_delta_coverage_successor_idx
  on policy.playbook_package_delta_coverage (successor_package_id, delta_id);

create function policy.guard_playbook_package_rerun_attempt_change()
returns trigger
language plpgsql
set search_path = policy, public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'playbook package rerun attempts cannot be deleted';
  end if;
  if current_user <> 'postgres'
     or old.rerun_id <> new.rerun_id
     or old.idempotency_key_sha256 <> new.idempotency_key_sha256
     or old.request_fingerprint_sha256 <> new.request_fingerprint_sha256
     or old.base_package_id <> new.base_package_id
     or old.base_watchlist_id <> new.base_watchlist_id
     or old.playbook_id <> new.playbook_id
     or old.profile_fingerprint <> new.profile_fingerprint
     or old.delta_ids <> new.delta_ids
     or old.delta_count <> new.delta_count
     or old.through_sequence <> new.through_sequence
     or old.claimed_at <> new.claimed_at
     or old.rerun_state <> 'CLAIMED'
     or new.rerun_state not in ('STALE', 'COMPLETED') then
    raise exception 'playbook package rerun transition is not allowed';
  end if;
  return new;
end;
$$;

create trigger playbook_package_rerun_attempts_guard
before update or delete on policy.playbook_package_rerun_attempts
for each row execute function policy.guard_playbook_package_rerun_attempt_change();

create trigger playbook_package_lineage_immutable
before update or delete on policy.playbook_package_lineage
for each row execute function regulatory.reject_immutable_row_change();

create trigger playbook_package_delta_coverage_immutable
before update or delete on policy.playbook_package_delta_coverage
for each row execute function regulatory.reject_immutable_row_change();

alter table policy.playbook_package_rerun_attempts enable row level security;
alter table policy.playbook_package_lineage enable row level security;
alter table policy.playbook_package_delta_coverage enable row level security;

create function policy.claim_superseding_playbook_evaluation(
  p_base_package_id text,
  p_playbook_id text,
  p_profile_fingerprint text,
  p_delta_ids text[],
  p_idempotency_key_sha256 text,
  p_request_fingerprint_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = policy, regulatory, public, extensions
as $$
declare
  v_attempt policy.playbook_package_rerun_attempts%rowtype;
  v_base_package policy.playbook_packages%rowtype;
  v_watchlist policy.playbook_package_watchlists%rowtype;
  v_delta_ids text[];
  v_current_delta_ids text[];
  v_through_sequence bigint;
  v_claim jsonb;
  v_rerun_id text;
begin
  if p_delta_ids is null
     or cardinality(p_delta_ids) = 0
     or exists (
       select 1 from unnest(p_delta_ids) delta_id
       where delta_id is null or delta_id !~ '^delta:[0-9a-f]{32}$'
     )
     or cardinality(p_delta_ids) <> (
       select count(distinct delta_id)::integer from unnest(p_delta_ids) delta_id
     ) then
    return jsonb_build_object('status', 'INVALID_DELTA_SET');
  end if;

  select array_agg(delta_id order by delta_id)
    into v_delta_ids
  from unnest(p_delta_ids) delta_id;

  select * into v_attempt
  from policy.playbook_package_rerun_attempts attempt
  where attempt.idempotency_key_sha256 = p_idempotency_key_sha256
  for update;

  if found then
    if v_attempt.request_fingerprint_sha256 <> p_request_fingerprint_sha256
       or v_attempt.base_package_id <> p_base_package_id
       or v_attempt.playbook_id <> p_playbook_id
       or v_attempt.profile_fingerprint <> p_profile_fingerprint
       or v_attempt.delta_ids <> v_delta_ids then
      raise exception 'playbook idempotency key conflict';
    end if;
    if v_attempt.rerun_state = 'COMPLETED' then
      return jsonb_build_object(
        'status', 'COMPLETED',
        'packageId', v_attempt.successor_package_id
      );
    end if;
    if v_attempt.rerun_state = 'STALE' then
      return jsonb_build_object('status', 'STALE');
    end if;
    v_claim := policy.claim_playbook_package_idempotency(
      p_idempotency_key_sha256,
      p_request_fingerprint_sha256
    );
    return v_claim || jsonb_build_object('rerunId', v_attempt.rerun_id);
  end if;

  select * into v_base_package
  from policy.playbook_packages package
  where package.package_id = p_base_package_id
  for update;
  if not found then
    return jsonb_build_object('status', 'NOT_FOUND');
  end if;
  if v_base_package.playbook_id <> p_playbook_id then
    return jsonb_build_object('status', 'PLAYBOOK_MISMATCH');
  end if;
  if v_base_package.profile_fingerprint <> p_profile_fingerprint then
    return jsonb_build_object('status', 'PROFILE_MISMATCH');
  end if;
  if exists (
    select 1 from policy.playbook_package_lineage lineage
    where lineage.base_package_id = p_base_package_id
  ) then
    return jsonb_build_object('status', 'ALREADY_SUPERSEDED');
  end if;

  select * into v_watchlist
  from policy.playbook_package_watchlists watchlist
  where watchlist.package_id = p_base_package_id
  for update;
  if not found or v_watchlist.watchlist_state <> 'ACTIVE' then
    return jsonb_build_object('status', 'WATCHLIST_NOT_ACTIVE');
  end if;

  perform 1
  from policy.playbook_watchlist_change_deltas delta
  where delta.watchlist_id = v_watchlist.watchlist_id
  order by delta.delta_sequence
  for update;

  select
    coalesce(array_agg(delta.delta_id order by delta.delta_id), '{}'::text[]),
    max(delta.delta_sequence)
    into v_current_delta_ids, v_through_sequence
  from policy.playbook_watchlist_change_deltas delta
  left join policy.playbook_package_delta_coverage coverage
    on coverage.delta_id = delta.delta_id
  where delta.watchlist_id = v_watchlist.watchlist_id
    and coverage.delta_id is null;

  if v_current_delta_ids <> v_delta_ids then
    return jsonb_build_object('status', 'DELTA_SNAPSHOT_MISMATCH');
  end if;

  v_claim := policy.claim_playbook_package_idempotency(
    p_idempotency_key_sha256,
    p_request_fingerprint_sha256
  );
  if v_claim->>'status' = 'COMPLETED' then
    raise exception 'playbook idempotency key conflict';
  end if;
  if v_claim->>'status' <> 'CLAIMED' then
    return v_claim;
  end if;

  v_rerun_id := 'rerun:' || substr(encode(extensions.digest(convert_to(
    'superseding-playbook-evaluation-v1:' || p_idempotency_key_sha256,
    'UTF8'
  ), 'sha256'), 'hex'), 1, 32);

  insert into policy.playbook_package_rerun_attempts (
    rerun_id, idempotency_key_sha256, request_fingerprint_sha256,
    base_package_id, base_watchlist_id, playbook_id, profile_fingerprint,
    delta_ids, delta_count, through_sequence
  ) values (
    v_rerun_id, p_idempotency_key_sha256, p_request_fingerprint_sha256,
    p_base_package_id, v_watchlist.watchlist_id, p_playbook_id,
    p_profile_fingerprint, v_delta_ids, cardinality(v_delta_ids),
    v_through_sequence
  );

  return v_claim || jsonb_build_object('rerunId', v_rerun_id);
end;
$$;

create function policy.complete_superseding_playbook_evaluation(
  p_rerun_id text,
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
returns jsonb
language plpgsql
security definer
set search_path = policy, regulatory, public, extensions
as $$
declare
  v_attempt policy.playbook_package_rerun_attempts%rowtype;
  v_watchlist policy.playbook_package_watchlists%rowtype;
  v_current_delta_ids text[];
  v_successor_watchlist jsonb;
begin
  select * into v_attempt
  from policy.playbook_package_rerun_attempts attempt
  where attempt.rerun_id = p_rerun_id
  for update;
  if not found then
    return jsonb_build_object('status', 'NOT_FOUND');
  end if;
  if v_attempt.idempotency_key_sha256 <> p_idempotency_key_sha256
     or v_attempt.request_fingerprint_sha256 <> p_request_fingerprint_sha256
     or v_attempt.playbook_id <> p_playbook_id
     or v_attempt.profile_fingerprint <> p_profile_fingerprint then
    raise exception 'playbook idempotency key conflict';
  end if;
  if v_attempt.rerun_state = 'COMPLETED' then
    return jsonb_build_object(
      'status', 'COMPLETED',
      'packageId', v_attempt.successor_package_id
    );
  end if;
  if v_attempt.rerun_state = 'STALE' then
    return jsonb_build_object('status', 'STALE');
  end if;
  if p_package_id = v_attempt.base_package_id then
    raise exception 'successor package must not equal base package';
  end if;

  select * into v_watchlist
  from policy.playbook_package_watchlists watchlist
  where watchlist.watchlist_id = v_attempt.base_watchlist_id
  for update;
  if not found or v_watchlist.watchlist_state <> 'ACTIVE' then
    update policy.playbook_package_rerun_attempts
    set rerun_state = 'STALE', stale_at = clock_timestamp()
    where rerun_id = p_rerun_id;
    return jsonb_build_object('status', 'STALE');
  end if;

  perform 1
  from policy.playbook_watchlist_change_deltas delta
  where delta.watchlist_id = v_attempt.base_watchlist_id
  order by delta.delta_sequence
  for update;

  select coalesce(array_agg(delta.delta_id order by delta.delta_id), '{}'::text[])
    into v_current_delta_ids
  from policy.playbook_watchlist_change_deltas delta
  left join policy.playbook_package_delta_coverage coverage
    on coverage.delta_id = delta.delta_id
  where delta.watchlist_id = v_attempt.base_watchlist_id
    and coverage.delta_id is null;

  if v_current_delta_ids <> v_attempt.delta_ids then
    update policy.playbook_package_rerun_attempts
    set rerun_state = 'STALE', stale_at = clock_timestamp()
    where rerun_id = p_rerun_id;
    return jsonb_build_object('status', 'STALE');
  end if;

  perform policy.register_playbook_package_with_dependencies(
    p_object_id, p_provider, p_bucket, p_object_key,
    p_artifact_checksum_sha256, p_byte_size, p_content_type, p_package_id,
    p_playbook_id, p_profile_fingerprint, p_integrity_sha256,
    p_schema_version, p_evaluated_at, p_assurance_review_status,
    p_corpus_release_id, p_retrieval_index_release_id, p_dossier_id,
    p_rules_version, p_template_version, p_idempotency_key_sha256,
    p_request_fingerprint_sha256, p_evidence_claim_ids
  );

  insert into policy.playbook_package_lineage (
    base_package_id, successor_package_id, rerun_id
  ) values (
    v_attempt.base_package_id, p_package_id, p_rerun_id
  );

  insert into policy.playbook_package_delta_coverage (
    delta_id, rerun_id, base_package_id, successor_package_id
  )
  select delta_id, p_rerun_id, v_attempt.base_package_id, p_package_id
  from unnest(v_attempt.delta_ids) delta_id;

  update policy.playbook_package_watchlists
  set watchlist_state = 'SUPERSEDED'
  where watchlist_id = v_attempt.base_watchlist_id;

  v_successor_watchlist := policy.create_playbook_package_watchlist(p_package_id);
  if v_successor_watchlist->>'status' not in ('CREATED', 'REPLAYED') then
    raise exception 'successor package watchlist creation failed';
  end if;

  update policy.playbook_package_rerun_attempts
  set rerun_state = 'COMPLETED',
      successor_package_id = p_package_id,
      completed_at = clock_timestamp()
  where rerun_id = p_rerun_id;

  return jsonb_build_object(
    'status', 'COMPLETED',
    'packageId', p_package_id,
    'baseWatchlistId', v_attempt.base_watchlist_id,
    'successorWatchlistId', v_successor_watchlist#>>'{watchlist,watchlistId}'
  );
end;
$$;

-- Serialize delta materialization with rerun completion. A completion holding
-- the watchlist row lock wins before the trigger can observe it as ACTIVE; a
-- materialization already holding the lock commits first and is included in
-- the completion snapshot check.
create or replace function policy.materialize_playbook_watchlist_change_deltas()
returns trigger
language plpgsql
security definer
set search_path = policy, regulatory, public, extensions
as $$
begin
  if new.event_state <> 'PUBLISHED'
     or old.event_state = 'PUBLISHED' then
    return new;
  end if;

  perform 1
  from policy.playbook_package_watchlists watchlist
  join policy.playbook_package_claim_dependencies dependency
    on dependency.package_id = watchlist.package_id
  join policy.event_claim_impacts impact
    on impact.claim_id = dependency.claim_id
   and impact.event_id = new.event_id
   and impact.review_state = 'REVIEWED'
  where watchlist.watchlist_state = 'ACTIVE'
  order by watchlist.watchlist_id
  for update of watchlist;

  insert into policy.playbook_watchlist_change_deltas (
    delta_id, watchlist_id, package_id, event_id, event_type, event_title,
    event_published_at, event_effective_at, before_version_id,
    after_version_id, delta_status, package_assurance_review_status,
    actions, required_customer_response
  )
  select distinct
    'delta:' || substr(encode(extensions.digest(convert_to(
      'playbook-change-delta-v1:' || watchlist.watchlist_id || ':' || new.event_id,
      'UTF8'
    ), 'sha256'), 'hex'), 1, 32),
    watchlist.watchlist_id, package.package_id, new.event_id, new.event_type,
    new.title, new.published_at, new.effective_at, new.before_version_id,
    new.after_version_id, 'REVIEW_REQUIRED', package.assurance_review_status,
    array['REVIEW_EVIDENCE_CHANGE', 'REQUEST_PLAYBOOK_RERUN']::text[],
    'ACKNOWLEDGE_AND_RERUN'
  from policy.event_claim_impacts impact
  join policy.playbook_package_claim_dependencies dependency
    on dependency.claim_id = impact.claim_id
  join policy.playbook_packages package
    on package.package_id = dependency.package_id
  join policy.playbook_package_watchlists watchlist
    on watchlist.package_id = package.package_id
   and watchlist.watchlist_state = 'ACTIVE'
  where impact.event_id = new.event_id
    and impact.review_state = 'REVIEWED'
  on conflict (watchlist_id, event_id) do nothing;

  insert into policy.playbook_watchlist_delta_claim_impacts (
    delta_id, claim_id, impact_type
  )
  select delta.delta_id, impact.claim_id, impact.impact_type
  from policy.playbook_watchlist_change_deltas delta
  join policy.playbook_package_claim_dependencies dependency
    on dependency.package_id = delta.package_id
  join policy.event_claim_impacts impact
    on impact.event_id = delta.event_id
   and impact.claim_id = dependency.claim_id
   and impact.review_state = 'REVIEWED'
  where delta.event_id = new.event_id
  on conflict (delta_id, claim_id) do nothing;

  return new;
end;
$$;

create function policy.get_playbook_monitoring_backup_metadata()
returns jsonb
language sql
stable
security definer
set search_path = policy, public
as $$
  select jsonb_build_object(
    'playbookPackages', (
      select coalesce(jsonb_agg(to_jsonb(item) order by item.package_id), '[]'::jsonb)
      from policy.playbook_packages item
    ),
    'playbookPackageIdempotency', (
      select coalesce(jsonb_agg(to_jsonb(item) order by item.idempotency_key_sha256), '[]'::jsonb)
      from policy.playbook_package_idempotency item
    ),
    'playbookPackageClaimDependencies', (
      select coalesce(jsonb_agg(to_jsonb(item) order by item.package_id, item.claim_id), '[]'::jsonb)
      from policy.playbook_package_claim_dependencies item
    ),
    'playbookPackageWatchlists', (
      select coalesce(jsonb_agg(to_jsonb(item) order by item.watchlist_id), '[]'::jsonb)
      from policy.playbook_package_watchlists item
    ),
    'playbookWatchlistChangeDeltas', (
      select coalesce(jsonb_agg(to_jsonb(item) order by item.delta_sequence), '[]'::jsonb)
      from policy.playbook_watchlist_change_deltas item
    ),
    'playbookWatchlistDeltaClaimImpacts', (
      select coalesce(jsonb_agg(to_jsonb(item) order by item.delta_id, item.claim_id), '[]'::jsonb)
      from policy.playbook_watchlist_delta_claim_impacts item
    ),
    'playbookWebhookDeliveries', (
      select coalesce(jsonb_agg(to_jsonb(item) order by item.delta_id), '[]'::jsonb)
      from policy.playbook_webhook_deliveries item
    ),
    'playbookWebhookDeliveryAttempts', (
      select coalesce(jsonb_agg(to_jsonb(item) order by item.attempt_sequence), '[]'::jsonb)
      from policy.playbook_webhook_delivery_attempts item
    ),
    'playbookWebhookDeliveryReplays', (
      select coalesce(jsonb_agg(to_jsonb(item) order by item.replay_sequence), '[]'::jsonb)
      from policy.playbook_webhook_delivery_replays item
    ),
    'playbookPackageRerunAttempts', (
      select coalesce(jsonb_agg(to_jsonb(item) order by item.rerun_id), '[]'::jsonb)
      from policy.playbook_package_rerun_attempts item
    ),
    'playbookPackageLineage', (
      select coalesce(jsonb_agg(to_jsonb(item) order by item.base_package_id), '[]'::jsonb)
      from policy.playbook_package_lineage item
    ),
    'playbookPackageDeltaCoverage', (
      select coalesce(jsonb_agg(to_jsonb(item) order by item.delta_id), '[]'::jsonb)
      from policy.playbook_package_delta_coverage item
    )
  );
$$;

revoke all on table policy.playbook_package_rerun_attempts,
  policy.playbook_package_lineage,
  policy.playbook_package_delta_coverage
from public, anon, authenticated, service_role;

revoke all on function policy.claim_superseding_playbook_evaluation(
  text,text,text,text[],text,text
), policy.complete_superseding_playbook_evaluation(
  text,text,text,text,text,text,bigint,text,text,text,text,text,text,timestamptz,
  text,text,text,text,text,text,text,text,text[]
), policy.guard_playbook_package_watchlist_change(),
  policy.guard_playbook_package_rerun_attempt_change(),
  policy.get_playbook_monitoring_backup_metadata()
from public, anon, authenticated, service_role;

grant execute on function policy.claim_superseding_playbook_evaluation(
  text,text,text,text[],text,text
), policy.complete_superseding_playbook_evaluation(
  text,text,text,text,text,text,bigint,text,text,text,text,text,text,timestamptz,
  text,text,text,text,text,text,text,text,text[]
), policy.get_playbook_monitoring_backup_metadata()
to service_role;

comment on table policy.playbook_package_rerun_attempts is
  'Private explicit rerun claims bound to one immutable base package, profile fingerprint, exact pending delta snapshot, and hashed idempotency key. Stores no raw profile or customer identity.';
comment on table policy.playbook_package_lineage is
  'Immutable one-successor lineage for superseding paid PlaybookPackages.';
comment on table policy.playbook_package_delta_coverage is
  'Immutable proof that one pending Change-to-Action Delta was covered by one successor package.';
comment on function policy.claim_superseding_playbook_evaluation is
  'Claims an explicit exact-package rerun only for a matching profile and the complete current pending delta snapshot.';
comment on function policy.complete_superseding_playbook_evaluation is
  'Atomically registers one successor package, lineage and delta coverage, supersedes the base watchlist, and activates the successor watchlist; stale snapshots do not complete.';
comment on function policy.get_playbook_monitoring_backup_metadata is
  'Returns private Phase 5/6 package, monitoring, delivery, rerun, lineage, and coverage metadata for operator backup without artifact bodies or raw profiles.';

commit;
