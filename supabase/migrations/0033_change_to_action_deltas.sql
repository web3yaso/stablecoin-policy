begin;

create table policy.playbook_watchlist_change_deltas (
  delta_sequence bigint generated always as identity primary key,
  delta_id text not null unique
    check (delta_id ~ '^delta:[0-9a-f]{32}$'),
  watchlist_id text not null
    references policy.playbook_package_watchlists(watchlist_id),
  package_id text not null references policy.playbook_packages(package_id),
  event_id text not null references regulatory.regulatory_events(event_id),
  event_type text not null,
  event_title text not null check (nullif(btrim(event_title), '') is not null),
  event_published_at timestamptz not null,
  event_effective_at timestamptz,
  before_version_id text,
  after_version_id text,
  delta_status text not null default 'REVIEW_REQUIRED'
    check (delta_status = 'REVIEW_REQUIRED'),
  package_assurance_review_status text not null
    check (package_assurance_review_status in ('PROVISIONAL', 'HUMAN_REVIEWED')),
  actions text[] not null default array[
    'REVIEW_EVIDENCE_CHANGE', 'REQUEST_PLAYBOOK_RERUN'
  ]::text[] check (
    actions = array[
      'REVIEW_EVIDENCE_CHANGE', 'REQUEST_PLAYBOOK_RERUN'
    ]::text[]
  ),
  required_customer_response text not null default 'ACKNOWLEDGE_AND_RERUN'
    check (required_customer_response = 'ACKNOWLEDGE_AND_RERUN'),
  created_at timestamptz not null default now(),
  unique (watchlist_id, event_id),
  unique (watchlist_id, delta_sequence)
);

create index playbook_watchlist_change_deltas_package_cursor_idx
  on policy.playbook_watchlist_change_deltas (
    package_id, watchlist_id, delta_sequence
  );

create table policy.playbook_watchlist_delta_claim_impacts (
  delta_id text not null
    references policy.playbook_watchlist_change_deltas(delta_id),
  claim_id text not null references policy.legal_claims(claim_id),
  impact_type text not null
    check (impact_type in ('MAY_AFFECT', 'INVALIDATES', 'SUPERSEDES', 'DEADLINE')),
  created_at timestamptz not null default now(),
  primary key (delta_id, claim_id)
);

create index playbook_watchlist_delta_claim_impacts_claim_idx
  on policy.playbook_watchlist_delta_claim_impacts (claim_id, delta_id);

create trigger playbook_watchlist_change_deltas_immutable
before update or delete on policy.playbook_watchlist_change_deltas
for each row execute function regulatory.reject_immutable_row_change();

create trigger playbook_watchlist_delta_claim_impacts_immutable
before update or delete on policy.playbook_watchlist_delta_claim_impacts
for each row execute function regulatory.reject_immutable_row_change();

alter table policy.playbook_watchlist_change_deltas enable row level security;
alter table policy.playbook_watchlist_delta_claim_impacts enable row level security;

create function policy.materialize_playbook_watchlist_change_deltas()
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
    watchlist.watchlist_id,
    package.package_id,
    new.event_id,
    new.event_type,
    new.title,
    new.published_at,
    new.effective_at,
    new.before_version_id,
    new.after_version_id,
    'REVIEW_REQUIRED',
    package.assurance_review_status,
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
  select
    delta.delta_id,
    impact.claim_id,
    impact.impact_type
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

create trigger regulatory_events_materialize_playbook_deltas
after update of event_state on regulatory.regulatory_events
for each row execute function policy.materialize_playbook_watchlist_change_deltas();

-- Backfill only events published after the immutable watchlist started. This
-- preserves the subscription boundary and makes a migration replay harmless.
insert into policy.playbook_watchlist_change_deltas (
  delta_id, watchlist_id, package_id, event_id, event_type, event_title,
  event_published_at, event_effective_at, before_version_id,
  after_version_id, delta_status, package_assurance_review_status,
  actions, required_customer_response
)
select distinct
  'delta:' || substr(encode(extensions.digest(convert_to(
    'playbook-change-delta-v1:' || watchlist.watchlist_id || ':' || event.event_id,
    'UTF8'
  ), 'sha256'), 'hex'), 1, 32),
  watchlist.watchlist_id,
  package.package_id,
  event.event_id,
  event.event_type,
  event.title,
  event.published_at,
  event.effective_at,
  event.before_version_id,
  event.after_version_id,
  'REVIEW_REQUIRED',
  package.assurance_review_status,
  array['REVIEW_EVIDENCE_CHANGE', 'REQUEST_PLAYBOOK_RERUN']::text[],
  'ACKNOWLEDGE_AND_RERUN'
from regulatory.regulatory_events event
join policy.event_claim_impacts impact
  on impact.event_id = event.event_id
 and impact.review_state = 'REVIEWED'
join policy.playbook_package_claim_dependencies dependency
  on dependency.claim_id = impact.claim_id
join policy.playbook_packages package
  on package.package_id = dependency.package_id
join policy.playbook_package_watchlists watchlist
  on watchlist.package_id = package.package_id
 and watchlist.watchlist_state = 'ACTIVE'
where event.event_state = 'PUBLISHED'
  and event.published_at >= watchlist.created_at
order by event.published_at, event.event_id, watchlist.watchlist_id
on conflict (watchlist_id, event_id) do nothing;

insert into policy.playbook_watchlist_delta_claim_impacts (
  delta_id, claim_id, impact_type
)
select
  delta.delta_id,
  impact.claim_id,
  impact.impact_type
from policy.playbook_watchlist_change_deltas delta
join policy.playbook_package_claim_dependencies dependency
  on dependency.package_id = delta.package_id
join policy.event_claim_impacts impact
  on impact.event_id = delta.event_id
 and impact.claim_id = dependency.claim_id
 and impact.review_state = 'REVIEWED'
on conflict (delta_id, claim_id) do nothing;

create function policy.get_playbook_watchlist_change_deltas(
  p_package_id text,
  p_after_sequence bigint,
  p_cursor_watchlist_id text,
  p_limit integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = policy, regulatory, public
as $$
declare
  v_watchlist policy.playbook_package_watchlists%rowtype;
  v_items jsonb;
  v_last_sequence bigint;
  v_has_more boolean;
begin
  if p_after_sequence is null or p_after_sequence < 0 then
    raise exception 'change delta cursor sequence is invalid';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'change delta page limit is invalid';
  end if;

  select * into v_watchlist
  from policy.playbook_package_watchlists watchlist
  where watchlist.package_id = p_package_id;

  if not found then
    return jsonb_build_object('status', 'NOT_FOUND');
  end if;

  if (p_cursor_watchlist_id is not null
      and p_cursor_watchlist_id is distinct from v_watchlist.watchlist_id)
     or (p_after_sequence > 0 and p_cursor_watchlist_id is null)
     or (p_after_sequence > 0 and not exists (
       select 1 from policy.playbook_watchlist_change_deltas delta
       where delta.watchlist_id = v_watchlist.watchlist_id
         and delta.delta_sequence = p_after_sequence
     )) then
    return jsonb_build_object('status', 'INVALID_CURSOR');
  end if;

  select
    coalesce(jsonb_agg(jsonb_build_object(
      'deltaId', page.delta_id,
      'deltaSequence', page.delta_sequence,
      'watchlistId', page.watchlist_id,
      'packageId', page.package_id,
      'event', jsonb_build_object(
        'eventId', page.event_id,
        'eventType', page.event_type,
        'title', page.event_title,
        'publishedAt', page.event_published_at,
        'effectiveAt', page.event_effective_at,
        'beforeVersionId', page.before_version_id,
        'afterVersionId', page.after_version_id
      ),
      'evidenceChanges', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'claimId', impact.claim_id,
          'impactType', impact.impact_type
        ) order by impact.claim_id), '[]'::jsonb)
        from policy.playbook_watchlist_delta_claim_impacts impact
        where impact.delta_id = page.delta_id
      ),
      'status', page.delta_status,
      'packageAssuranceReviewStatus', page.package_assurance_review_status,
      'actions', to_jsonb(page.actions),
      'requiredCustomerResponse', page.required_customer_response,
      'createdAt', page.created_at
    ) order by page.delta_sequence), '[]'::jsonb),
    max(page.delta_sequence)
  into v_items, v_last_sequence
  from (
    select delta.*
    from policy.playbook_watchlist_change_deltas delta
    where delta.watchlist_id = v_watchlist.watchlist_id
      and delta.delta_sequence > p_after_sequence
    order by delta.delta_sequence
    limit p_limit
  ) page;

  select exists (
    select 1 from policy.playbook_watchlist_change_deltas delta
    where delta.watchlist_id = v_watchlist.watchlist_id
      and delta.delta_sequence > coalesce(v_last_sequence, p_after_sequence)
  ) into v_has_more;

  return jsonb_build_object(
    'status', 'OK',
    'schemaVersion', '1.0.0',
    'watchlistId', v_watchlist.watchlist_id,
    'packageId', v_watchlist.package_id,
    'items', v_items,
    'nextSequence', coalesce(v_last_sequence, p_after_sequence),
    'hasMore', v_has_more
  );
end;
$$;

revoke all on table
  policy.playbook_watchlist_change_deltas,
  policy.playbook_watchlist_delta_claim_impacts
from public, anon, authenticated, service_role;

revoke all on function
  policy.materialize_playbook_watchlist_change_deltas(),
  policy.get_playbook_watchlist_change_deltas(text,bigint,text,integer)
from public, anon, authenticated, service_role;

grant execute on function
  policy.get_playbook_watchlist_change_deltas(text,bigint,text,integer)
to service_role;

comment on table policy.playbook_watchlist_change_deltas is
  'Immutable, cursor-ordered REVIEW_REQUIRED deltas for exact package-derived watchlists. Stores no customer, entitlement, profile, webhook, prompt, raw rule, or package artifact body.';

comment on table policy.playbook_watchlist_delta_claim_impacts is
  'Immutable reviewed claim-impact snapshots bound to one Change-to-Action Delta.';

comment on function policy.materialize_playbook_watchlist_change_deltas is
  'Atomically materializes one idempotent delta per active watchlist and newly PUBLISHED event when a REVIEWED exact decision-evidence impact exists.';

comment on function policy.get_playbook_watchlist_change_deltas is
  'Returns one exact package watchlist delta page after a watchlist-bound cursor; rejects foreign, future, or nonexistent cursors.';

commit;
