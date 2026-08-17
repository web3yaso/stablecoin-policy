begin;

create table policy.playbook_webhook_deliveries (
  delivery_id text primary key
    check (delivery_id ~ '^webhook-delivery:[0-9a-f]{32}$'),
  delta_id text not null unique
    references policy.playbook_watchlist_change_deltas(delta_id),
  delivery_state text not null default 'PENDING'
    check (delivery_state in ('PENDING', 'LEASED', 'DELIVERED', 'DEAD_LETTER')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  cycle_attempt_count integer not null default 0
    check (cycle_attempt_count between 0 and 3),
  replay_count integer not null default 0 check (replay_count >= 0),
  next_attempt_at timestamptz not null default now(),
  lease_token text check (
    lease_token is null or lease_token ~ '^lease:[0-9a-f]{32}$'
  ),
  lease_expires_at timestamptz,
  delivered_at timestamptz,
  dead_lettered_at timestamptz,
  last_outcome text check (
    last_outcome is null or last_outcome in (
      'SUCCEEDED', 'RETRYABLE_FAILURE', 'PERMANENT_FAILURE', 'LEASE_EXPIRED'
    )
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (delivery_state = 'PENDING'
      and lease_token is null and lease_expires_at is null
      and delivered_at is null and dead_lettered_at is null)
    or (delivery_state = 'LEASED'
      and lease_token is not null and lease_expires_at is not null
      and delivered_at is null and dead_lettered_at is null)
    or (delivery_state = 'DELIVERED'
      and lease_token is null and lease_expires_at is null
      and delivered_at is not null and dead_lettered_at is null
      and last_outcome = 'SUCCEEDED')
    or (delivery_state = 'DEAD_LETTER'
      and lease_token is null and lease_expires_at is null
      and delivered_at is null and dead_lettered_at is not null
      and last_outcome in (
        'RETRYABLE_FAILURE', 'PERMANENT_FAILURE', 'LEASE_EXPIRED'
      ))
  )
);

create index playbook_webhook_deliveries_claim_idx
  on policy.playbook_webhook_deliveries (
    next_attempt_at, created_at, delivery_id
  ) where delivery_state = 'PENDING';

create index playbook_webhook_deliveries_lease_idx
  on policy.playbook_webhook_deliveries (lease_expires_at, delivery_id)
  where delivery_state = 'LEASED';

create table policy.playbook_webhook_delivery_attempts (
  attempt_sequence bigint generated always as identity primary key,
  delivery_id text not null
    references policy.playbook_webhook_deliveries(delivery_id),
  attempt_number integer not null check (attempt_number > 0),
  replay_number integer not null check (replay_number >= 0),
  outcome text not null check (outcome in (
    'SUCCEEDED', 'RETRYABLE_FAILURE', 'PERMANENT_FAILURE', 'LEASE_EXPIRED'
  )),
  response_status integer check (
    response_status is null or response_status between 100 and 599
  ),
  error_code text check (
    error_code is null or error_code ~ '^[A-Z][A-Z0-9_]{2,63}$'
  ),
  completed_at timestamptz not null default now(),
  unique (delivery_id, attempt_number),
  check (
    (outcome = 'SUCCEEDED'
      and response_status between 200 and 299 and error_code is null)
    or (outcome <> 'SUCCEEDED' and error_code is not null)
  )
);

create index playbook_webhook_delivery_attempts_delivery_idx
  on policy.playbook_webhook_delivery_attempts (
    delivery_id, attempt_number
  );

create table policy.playbook_webhook_delivery_replays (
  replay_sequence bigint generated always as identity primary key,
  delivery_id text not null
    references policy.playbook_webhook_deliveries(delivery_id),
  replay_number integer not null check (replay_number > 0),
  previous_state text not null
    check (previous_state in ('DELIVERED', 'DEAD_LETTER')),
  requested_at timestamptz not null default now(),
  unique (delivery_id, replay_number)
);

create trigger playbook_webhook_delivery_attempts_immutable
before update or delete on policy.playbook_webhook_delivery_attempts
for each row execute function regulatory.reject_immutable_row_change();

create trigger playbook_webhook_delivery_replays_immutable
before update or delete on policy.playbook_webhook_delivery_replays
for each row execute function regulatory.reject_immutable_row_change();

create function policy.guard_playbook_webhook_delivery_change()
returns trigger
language plpgsql
set search_path = policy, public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'playbook webhook delivery rows cannot be deleted';
  end if;
  if old.delivery_id <> new.delivery_id
     or old.delta_id <> new.delta_id
     or old.created_at <> new.created_at
     or new.attempt_count < old.attempt_count
     or new.replay_count < old.replay_count
     or new.updated_at < old.updated_at then
    raise exception 'playbook webhook delivery identity and audit counters are immutable';
  end if;
  return new;
end;
$$;

create trigger playbook_webhook_deliveries_guard
before update or delete on policy.playbook_webhook_deliveries
for each row execute function policy.guard_playbook_webhook_delivery_change();

alter table policy.playbook_webhook_deliveries enable row level security;
alter table policy.playbook_webhook_delivery_attempts enable row level security;
alter table policy.playbook_webhook_delivery_replays enable row level security;

create function policy.playbook_webhook_retry_delay_seconds(
  p_cycle_attempt_count integer
)
returns integer
language sql
immutable
strict
set search_path = policy, public
as $$
  select case p_cycle_attempt_count
    when 1 then 60
    when 2 then 300
    else 1800
  end;
$$;

create function policy.enqueue_playbook_change_delta_webhook()
returns trigger
language plpgsql
security definer
set search_path = policy, public, extensions
as $$
begin
  insert into policy.playbook_webhook_deliveries (
    delivery_id, delta_id, next_attempt_at
  ) values (
    'webhook-delivery:' || substr(encode(extensions.digest(convert_to(
      'playbook-change-webhook-v1:' || new.delta_id, 'UTF8'
    ), 'sha256'), 'hex'), 1, 32),
    new.delta_id,
    clock_timestamp()
  ) on conflict (delta_id) do nothing;
  return new;
end;
$$;

create trigger playbook_change_delta_enqueue_webhook
after insert on policy.playbook_watchlist_change_deltas
for each row execute function policy.enqueue_playbook_change_delta_webhook();

insert into policy.playbook_webhook_deliveries (
  delivery_id, delta_id, next_attempt_at
)
select
  'webhook-delivery:' || substr(encode(extensions.digest(convert_to(
    'playbook-change-webhook-v1:' || delta.delta_id, 'UTF8'
  ), 'sha256'), 'hex'), 1, 32),
  delta.delta_id,
  clock_timestamp()
from policy.playbook_watchlist_change_deltas delta
on conflict (delta_id) do nothing;

create function policy.claim_playbook_webhook_deliveries(
  p_limit integer,
  p_lease_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = policy, regulatory, public, extensions
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_delivery policy.playbook_webhook_deliveries%rowtype;
  v_lease_token text;
  v_lease_expires_at timestamptz;
  v_items jsonb := '[]'::jsonb;
  v_delta jsonb;
begin
  if p_limit is null or p_limit < 1 or p_limit > 20 then
    raise exception 'webhook delivery claim limit is invalid';
  end if;
  if p_lease_seconds is null or p_lease_seconds < 10 or p_lease_seconds > 300 then
    raise exception 'webhook delivery lease duration is invalid';
  end if;

  for v_delivery in
    select delivery.*
    from policy.playbook_webhook_deliveries delivery
    where delivery.delivery_state = 'LEASED'
      and delivery.lease_expires_at <= v_now
    order by delivery.lease_expires_at, delivery.delivery_id
    limit p_limit
    for update skip locked
  loop
    insert into policy.playbook_webhook_delivery_attempts (
      delivery_id, attempt_number, replay_number, outcome,
      response_status, error_code, completed_at
    ) values (
      v_delivery.delivery_id, v_delivery.attempt_count,
      v_delivery.replay_count, 'LEASE_EXPIRED', null,
      'LEASE_EXPIRED', v_now
    ) on conflict (delivery_id, attempt_number) do nothing;

    if v_delivery.cycle_attempt_count >= 3 then
      update policy.playbook_webhook_deliveries
      set delivery_state = 'DEAD_LETTER',
          lease_token = null,
          lease_expires_at = null,
          dead_lettered_at = v_now,
          last_outcome = 'LEASE_EXPIRED',
          updated_at = v_now
      where delivery_id = v_delivery.delivery_id;
    else
      update policy.playbook_webhook_deliveries
      set delivery_state = 'PENDING',
          next_attempt_at = v_now + make_interval(secs =>
            policy.playbook_webhook_retry_delay_seconds(
              v_delivery.cycle_attempt_count
            )),
          lease_token = null,
          lease_expires_at = null,
          last_outcome = 'LEASE_EXPIRED',
          updated_at = v_now
      where delivery_id = v_delivery.delivery_id;
    end if;
  end loop;

  for v_delivery in
    select delivery.*
    from policy.playbook_webhook_deliveries delivery
    where delivery.delivery_state = 'PENDING'
      and delivery.next_attempt_at <= v_now
      and delivery.cycle_attempt_count < 3
    order by delivery.next_attempt_at, delivery.created_at, delivery.delivery_id
    limit p_limit
    for update skip locked
  loop
    v_lease_token := 'lease:' || encode(extensions.gen_random_bytes(16), 'hex');
    v_lease_expires_at := v_now + make_interval(secs => p_lease_seconds);

    update policy.playbook_webhook_deliveries
    set delivery_state = 'LEASED',
        attempt_count = attempt_count + 1,
        cycle_attempt_count = cycle_attempt_count + 1,
        lease_token = v_lease_token,
        lease_expires_at = v_lease_expires_at,
        last_outcome = null,
        updated_at = v_now
    where delivery_id = v_delivery.delivery_id
    returning * into v_delivery;

    select jsonb_build_object(
      'deltaId', delta.delta_id,
      'deltaSequence', delta.delta_sequence,
      'watchlistId', delta.watchlist_id,
      'packageId', delta.package_id,
      'event', jsonb_build_object(
        'eventId', delta.event_id,
        'eventType', delta.event_type,
        'title', delta.event_title,
        'publishedAt', delta.event_published_at,
        'effectiveAt', delta.event_effective_at,
        'beforeVersionId', delta.before_version_id,
        'afterVersionId', delta.after_version_id
      ),
      'evidenceChanges', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'claimId', impact.claim_id,
          'impactType', impact.impact_type
        ) order by impact.claim_id), '[]'::jsonb)
        from policy.playbook_watchlist_delta_claim_impacts impact
        where impact.delta_id = delta.delta_id
      ),
      'status', delta.delta_status,
      'packageAssuranceReviewStatus', delta.package_assurance_review_status,
      'actions', to_jsonb(delta.actions),
      'requiredCustomerResponse', delta.required_customer_response,
      'createdAt', delta.created_at
    ) into strict v_delta
    from policy.playbook_watchlist_change_deltas delta
    where delta.delta_id = v_delivery.delta_id;

    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'deliveryId', v_delivery.delivery_id,
      'leaseToken', v_lease_token,
      'leaseExpiresAt', v_lease_expires_at,
      'attemptNumber', v_delivery.attempt_count,
      'replayNumber', v_delivery.replay_count,
      'delta', v_delta
    ));
  end loop;

  return jsonb_build_object(
    'schemaVersion', '1.0.0',
    'claimedAt', v_now,
    'items', v_items
  );
end;
$$;

create function policy.complete_playbook_webhook_delivery(
  p_delivery_id text,
  p_lease_token text,
  p_outcome text,
  p_response_status integer,
  p_error_code text
)
returns jsonb
language plpgsql
security definer
set search_path = policy, public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_delivery policy.playbook_webhook_deliveries%rowtype;
  v_next_state text;
begin
  if p_outcome not in ('SUCCEEDED', 'RETRYABLE_FAILURE', 'PERMANENT_FAILURE') then
    raise exception 'webhook delivery outcome is invalid';
  end if;
  if p_outcome = 'SUCCEEDED' and (
    p_response_status is null or p_response_status < 200
    or p_response_status > 299 or p_error_code is not null
  ) then
    raise exception 'successful webhook delivery result is invalid';
  end if;
  if p_outcome <> 'SUCCEEDED' and (
    p_error_code is null or p_error_code !~ '^[A-Z][A-Z0-9_]{2,63}$'
    or (p_response_status is not null
      and (p_response_status < 100 or p_response_status > 599))
  ) then
    raise exception 'failed webhook delivery result is invalid';
  end if;

  select * into v_delivery
  from policy.playbook_webhook_deliveries delivery
  where delivery.delivery_id = p_delivery_id
  for update;

  if not found then
    return jsonb_build_object('status', 'NOT_FOUND');
  end if;
  if v_delivery.delivery_state <> 'LEASED'
     or v_delivery.lease_token <> p_lease_token then
    return jsonb_build_object('status', 'LEASE_CONFLICT');
  end if;
  if v_delivery.lease_expires_at <= v_now then
    return jsonb_build_object('status', 'LEASE_EXPIRED');
  end if;

  insert into policy.playbook_webhook_delivery_attempts (
    delivery_id, attempt_number, replay_number, outcome,
    response_status, error_code, completed_at
  ) values (
    v_delivery.delivery_id, v_delivery.attempt_count,
    v_delivery.replay_count, p_outcome,
    p_response_status, p_error_code, v_now
  );

  if p_outcome = 'SUCCEEDED' then
    v_next_state := 'DELIVERED';
    update policy.playbook_webhook_deliveries
    set delivery_state = v_next_state,
        lease_token = null,
        lease_expires_at = null,
        delivered_at = v_now,
        last_outcome = p_outcome,
        updated_at = v_now
    where delivery_id = v_delivery.delivery_id;
  elsif p_outcome = 'PERMANENT_FAILURE'
        or v_delivery.cycle_attempt_count >= 3 then
    v_next_state := 'DEAD_LETTER';
    update policy.playbook_webhook_deliveries
    set delivery_state = v_next_state,
        lease_token = null,
        lease_expires_at = null,
        dead_lettered_at = v_now,
        last_outcome = p_outcome,
        updated_at = v_now
    where delivery_id = v_delivery.delivery_id;
  else
    v_next_state := 'PENDING';
    update policy.playbook_webhook_deliveries
    set delivery_state = v_next_state,
        next_attempt_at = v_now + make_interval(secs =>
          policy.playbook_webhook_retry_delay_seconds(
            v_delivery.cycle_attempt_count
          )),
        lease_token = null,
        lease_expires_at = null,
        last_outcome = p_outcome,
        updated_at = v_now
    where delivery_id = v_delivery.delivery_id;
  end if;

  return jsonb_build_object(
    'status', 'RECORDED',
    'deliveryId', v_delivery.delivery_id,
    'deliveryState', v_next_state,
    'attemptNumber', v_delivery.attempt_count
  );
end;
$$;

create function policy.replay_playbook_webhook_delivery(p_delta_id text)
returns jsonb
language plpgsql
security definer
set search_path = policy, public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_delivery policy.playbook_webhook_deliveries%rowtype;
  v_replay_number integer;
begin
  select * into v_delivery
  from policy.playbook_webhook_deliveries delivery
  where delivery.delta_id = p_delta_id
  for update;

  if not found then
    return jsonb_build_object('status', 'NOT_FOUND');
  end if;
  if v_delivery.delivery_state not in ('DELIVERED', 'DEAD_LETTER') then
    return jsonb_build_object('status', 'NOT_REPLAYABLE');
  end if;

  v_replay_number := v_delivery.replay_count + 1;
  insert into policy.playbook_webhook_delivery_replays (
    delivery_id, replay_number, previous_state, requested_at
  ) values (
    v_delivery.delivery_id, v_replay_number,
    v_delivery.delivery_state, v_now
  );

  update policy.playbook_webhook_deliveries
  set delivery_state = 'PENDING',
      cycle_attempt_count = 0,
      replay_count = v_replay_number,
      next_attempt_at = v_now,
      lease_token = null,
      lease_expires_at = null,
      delivered_at = null,
      dead_lettered_at = null,
      last_outcome = null,
      updated_at = v_now
  where delivery_id = v_delivery.delivery_id;

  return jsonb_build_object(
    'status', 'REQUEUED',
    'deliveryId', v_delivery.delivery_id,
    'deltaId', v_delivery.delta_id,
    'replayNumber', v_replay_number
  );
end;
$$;

create function policy.get_playbook_webhook_delivery_audit(p_delta_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = policy, public
as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'status', 'OK',
    'schemaVersion', '1.0.0',
    'delivery', jsonb_build_object(
      'deliveryId', delivery.delivery_id,
      'deltaId', delivery.delta_id,
      'deliveryState', delivery.delivery_state,
      'attemptCount', delivery.attempt_count,
      'cycleAttemptCount', delivery.cycle_attempt_count,
      'replayCount', delivery.replay_count,
      'nextAttemptAt', delivery.next_attempt_at,
      'leaseExpiresAt', delivery.lease_expires_at,
      'deliveredAt', delivery.delivered_at,
      'deadLetteredAt', delivery.dead_lettered_at,
      'lastOutcome', delivery.last_outcome,
      'createdAt', delivery.created_at,
      'updatedAt', delivery.updated_at
    ),
    'attempts', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'attemptNumber', attempt.attempt_number,
        'replayNumber', attempt.replay_number,
        'outcome', attempt.outcome,
        'responseStatus', attempt.response_status,
        'errorCode', attempt.error_code,
        'completedAt', attempt.completed_at
      ) order by attempt.attempt_number), '[]'::jsonb)
      from policy.playbook_webhook_delivery_attempts attempt
      where attempt.delivery_id = delivery.delivery_id
    ),
    'replays', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'replayNumber', replay.replay_number,
        'previousState', replay.previous_state,
        'requestedAt', replay.requested_at
      ) order by replay.replay_number), '[]'::jsonb)
      from policy.playbook_webhook_delivery_replays replay
      where replay.delivery_id = delivery.delivery_id
    )
  ) into v_result
  from policy.playbook_webhook_deliveries delivery
  where delivery.delta_id = p_delta_id;

  return coalesce(v_result, jsonb_build_object('status', 'NOT_FOUND'));
end;
$$;

revoke all on table
  policy.playbook_webhook_deliveries,
  policy.playbook_webhook_delivery_attempts,
  policy.playbook_webhook_delivery_replays
from public, anon, authenticated, service_role;

revoke all on function
  policy.playbook_webhook_retry_delay_seconds(integer),
  policy.enqueue_playbook_change_delta_webhook(),
  policy.claim_playbook_webhook_deliveries(integer,integer),
  policy.complete_playbook_webhook_delivery(text,text,text,integer,text),
  policy.replay_playbook_webhook_delivery(text),
  policy.get_playbook_webhook_delivery_audit(text)
from public, anon, authenticated, service_role;

grant execute on function
  policy.claim_playbook_webhook_deliveries(integer,integer),
  policy.complete_playbook_webhook_delivery(text,text,text,integer,text),
  policy.replay_playbook_webhook_delivery(text),
  policy.get_playbook_webhook_delivery_audit(text)
to service_role;

comment on table policy.playbook_webhook_deliveries is
  'Mutable domain outbox state for at-least-once delivery of immutable Change-to-Action Deltas to one deployment-level Citely receiver. Stores no URL, secret, customer, account, subscription, entitlement, profile, rule, prompt, or artifact body.';

comment on table policy.playbook_webhook_delivery_attempts is
  'Immutable sanitized delivery outcomes. Response bodies, URLs, secrets, and raw error messages are never stored.';

comment on table policy.playbook_webhook_delivery_replays is
  'Immutable audit of service-authorized webhook replay requests.';

comment on function policy.claim_playbook_webhook_deliveries is
  'Reconciles expired leases and atomically claims a bounded due batch with presentation-safe immutable delta snapshots.';

comment on function policy.complete_playbook_webhook_delivery is
  'Records one immutable attempt and transitions the matching active lease to delivered, retry, or dead-letter state.';

comment on function policy.replay_playbook_webhook_delivery is
  'Requeues one delivered or dead-letter delta without changing its event identity or prior attempt audit.';

commit;
