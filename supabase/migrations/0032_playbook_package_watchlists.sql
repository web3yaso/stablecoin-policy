begin;

create table policy.playbook_package_watchlists (
  watchlist_id text primary key
    check (watchlist_id ~ '^watchlist:[0-9a-f]{32}$'),
  package_id text not null unique
    references policy.playbook_packages(package_id),
  watchlist_state text not null default 'ACTIVE'
    check (watchlist_state = 'ACTIVE'),
  created_at timestamptz not null default now()
);

create index playbook_package_watchlists_created_idx
  on policy.playbook_package_watchlists (created_at, watchlist_id);

create trigger playbook_package_watchlists_immutable
before update or delete on policy.playbook_package_watchlists
for each row execute function regulatory.reject_immutable_row_change();

alter table policy.playbook_package_watchlists enable row level security;

create function policy.create_playbook_package_watchlist(p_package_id text)
returns jsonb
language plpgsql
security definer
set search_path = policy, regulatory, public, extensions
as $$
declare
  v_dependency_count integer;
  v_watchlist_id text;
  v_watchlist policy.playbook_package_watchlists%rowtype;
  v_inserted_count integer;
begin
  if not exists (
    select 1 from policy.playbook_packages package
    where package.package_id = p_package_id
  ) then
    return jsonb_build_object('status', 'NOT_FOUND');
  end if;

  select count(*)::integer into v_dependency_count
  from policy.playbook_package_claim_dependencies dependency
  where dependency.package_id = p_package_id;

  if v_dependency_count = 0 then
    return jsonb_build_object(
      'status', 'NOT_WATCHLISTABLE',
      'reason', 'EMPTY_DEPENDENCIES'
    );
  end if;

  v_watchlist_id := 'watchlist:' || substr(encode(
    extensions.digest(
      convert_to('playbook-watchlist-v1:' || p_package_id, 'UTF8'),
      'sha256'
    ),
    'hex'
  ), 1, 32);

  insert into policy.playbook_package_watchlists (
    watchlist_id, package_id, watchlist_state
  ) values (
    v_watchlist_id, p_package_id, 'ACTIVE'
  ) on conflict do nothing;
  get diagnostics v_inserted_count = row_count;

  select * into strict v_watchlist
  from policy.playbook_package_watchlists watchlist
  where watchlist.package_id = p_package_id;

  if v_watchlist.watchlist_id <> v_watchlist_id
     or v_watchlist.watchlist_state <> 'ACTIVE' then
    raise exception 'immutable playbook watchlist identity conflict for %',
      p_package_id;
  end if;

  return jsonb_build_object(
    'status', case when v_inserted_count = 1 then 'CREATED' else 'REPLAYED' end,
    'watchlist', jsonb_build_object(
      'schemaVersion', '1.0.0',
      'watchlistId', v_watchlist.watchlist_id,
      'packageId', v_watchlist.package_id,
      'state', v_watchlist.watchlist_state,
      'createdAt', v_watchlist.created_at
    )
  );
end;
$$;

create function policy.get_affected_playbook_watchlists(p_event_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = policy, regulatory, public
as $$
declare
  v_event_state text;
  v_watchlists jsonb;
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
      watchlist.watchlist_id,
      watchlist.created_at,
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
    join policy.playbook_package_watchlists watchlist
      on watchlist.package_id = package.package_id
     and watchlist.watchlist_state = 'ACTIVE'
    where impact.event_id = p_event_id
      and impact.review_state = 'REVIEWED'
  ), grouped as (
    select
      affected.watchlist_id,
      affected.created_at,
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
      affected.watchlist_id,
      affected.created_at,
      affected.package_id,
      affected.playbook_id,
      affected.evaluated_at,
      affected.assurance_review_status
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'watchlistId', grouped.watchlist_id,
    'createdAt', grouped.created_at,
    'packageId', grouped.package_id,
    'playbookId', grouped.playbook_id,
    'evaluatedAt', grouped.evaluated_at,
    'assuranceReviewStatus', grouped.assurance_review_status,
    'claimImpacts', grouped.claim_impacts
  ) order by grouped.watchlist_id), '[]'::jsonb)
  into v_watchlists
  from grouped;

  return jsonb_build_object(
    'schemaVersion', '1.0.0',
    'eventId', p_event_id,
    'eventState', v_event_state,
    'watchlists', v_watchlists
  );
end;
$$;

revoke all on table policy.playbook_package_watchlists
from public, anon, authenticated, service_role;

revoke all on function policy.create_playbook_package_watchlist(text),
  policy.get_affected_playbook_watchlists(text)
from public, anon, authenticated, service_role;

grant execute on function policy.create_playbook_package_watchlist(text),
  policy.get_affected_playbook_watchlists(text)
to service_role;

comment on table policy.playbook_package_watchlists is
  'Immutable ACTIVE watchlists derived one-to-one from completed paid packages. Stores no customer, subscription, entitlement, profile, or delivery data.';

comment on function policy.create_playbook_package_watchlist is
  'Creates or replays one deterministic immutable watchlist for a package with non-empty decision-evidence dependencies.';

comment on function policy.get_affected_playbook_watchlists is
  'Returns active watchlists linked to REVIEWED exact claim impacts only after the regulatory event is PUBLISHED.';

commit;
