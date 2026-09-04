-- Approved first-activation rollback-to-unavailable boundary.
-- Existing activation/eval gates are retained behind scope-serialized wrappers.
begin;

do $$
declare c record;
begin
  for c in select conname from pg_constraint
    where conrelid = 'retrieval.index_releases'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%release_state%'
  loop
    execute format('alter table retrieval.index_releases drop constraint %I', c.conname);
  end loop;
end;
$$;
alter table retrieval.index_releases
  add column suspended_at timestamptz,
  add constraint index_release_phase_check
    check (release_state in ('DRAFT', 'ACTIVE', 'RETIRED', 'SUSPENDED')),
  add constraint index_release_phase_time_check check (
    (release_state = 'DRAFT' and activated_at is null and retired_at is null and suspended_at is null)
    or (release_state = 'ACTIVE' and activated_at is not null and retired_at is null and suspended_at is null)
    or (release_state = 'RETIRED' and activated_at is not null and retired_at is not null and suspended_at is null)
    or (release_state = 'SUSPENDED' and activated_at is not null and retired_at is null and suspended_at is not null)
  );
alter table retrieval.active_index_pointers
  alter column active_index_release_id drop not null,
  add column revision bigint not null default 1 check (revision > 0),
  add constraint empty_pointer_has_no_previous check (
    active_index_release_id is not null or previous_index_release_id is null
  );

create function retrieval.advance_pointer_revision()
returns trigger language plpgsql set search_path = retrieval, pg_catalog as $$
begin
  if tg_op = 'DELETE' then raise exception 'retrieval scope pointer cannot be deleted'; end if;
  if tg_op = 'INSERT' then new.revision := 1;
  else
    if new.policy_domain is distinct from old.policy_domain
      or new.assurance_tier is distinct from old.assurance_tier then
      raise exception 'retrieval scope identity is immutable';
    end if;
    new.revision := old.revision + 1;
  end if;
  return new;
end;
$$;
create trigger advance_pointer_revision_trigger
before insert or update or delete on retrieval.active_index_pointers
for each row execute function retrieval.advance_pointer_revision();

create function retrieval.protect_suspended_index()
returns trigger language plpgsql set search_path = retrieval, pg_catalog as $$
begin
  if old.release_state = 'SUSPENDED' then
    raise exception 'suspended retrieval index is immutable; build a new DRAFT';
  end if;
  if new.release_state = 'SUSPENDED' and old.release_state <> 'ACTIVE' then
    raise exception 'only an ACTIVE retrieval index can be suspended';
  end if;
  return new;
end;
$$;
create trigger protect_suspended_index_trigger before update on retrieval.index_releases
for each row execute function retrieval.protect_suspended_index();

create table retrieval.index_suspension_operations (
  operation_id text primary key check (operation_id ~ '^[a-z0-9][a-z0-9._:-]{2,200}$'),
  policy_domain text not null,
  assurance_tier text not null check (assurance_tier in ('PROVISIONAL', 'HUMAN_REVIEWED')),
  index_release_id text not null references retrieval.index_releases(index_release_id),
  expected_manifest_sha256 text not null check (expected_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  expected_revision bigint not null check (expected_revision > 0),
  reason text not null check (length(btrim(reason)) > 0 and length(reason) <= 500),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default clock_timestamp()
);
alter table retrieval.index_suspension_operations enable row level security;
revoke all on retrieval.index_suspension_operations from public, anon, authenticated, service_role;
grant select on retrieval.index_suspension_operations to service_role;
create policy service_read_index_suspensions on retrieval.index_suspension_operations
for select to service_role using (true);
create trigger protect_index_suspension_operation_trigger
before update or delete on retrieval.index_suspension_operations
for each row execute function regulatory.reject_immutable_row_change();

-- All lifecycle entry points take this lock BEFORE any release row lock.
-- The advisory scope lock also covers the absent-pointer first activation.
create function retrieval.lock_index_scope(p_domain text, p_tier text)
returns void language plpgsql set search_path = pg_catalog as $$
begin
  if p_domain is null or p_domain !~ '^[a-z][a-z0-9-]{2,40}$'
    or p_tier is null or p_tier not in ('PROVISIONAL', 'HUMAN_REVIEWED') then
    raise exception 'invalid retrieval scope';
  end if;
  perform pg_advisory_xact_lock(73601, hashtext(p_domain || ':' || p_tier));
end;
$$;

-- Move the already-gated implementations out of the exposed policy schema.
alter function policy.activate_retrieval_index_release(text,text,timestamptz) set schema retrieval;
alter function retrieval.activate_retrieval_index_release(text,text,timestamptz) rename to activate_index_under_scope_lock;
alter function policy.rollback_retrieval_index_release(text,text,timestamptz) set schema retrieval;
alter function retrieval.rollback_retrieval_index_release(text,text,timestamptz) rename to rollback_index_under_scope_lock;
revoke all on function retrieval.activate_index_under_scope_lock(text,text,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function retrieval.rollback_index_under_scope_lock(text,text,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function retrieval.lock_index_scope(text,text) from public, anon, authenticated, service_role;

create function policy.activate_retrieval_index_release(
  p_index_release_id text, p_expected_manifest_sha256 text, p_activated_at timestamptz
) returns jsonb language plpgsql security definer
set search_path = policy, retrieval, pg_catalog as $$
declare r retrieval.index_releases%rowtype;
begin
  -- Identity is immutable; read without a row lock to establish lock order.
  select * into strict r from retrieval.index_releases where index_release_id = p_index_release_id;
  perform retrieval.lock_index_scope(r.policy_domain, r.assurance_tier);
  select * into strict r from retrieval.index_releases where index_release_id = p_index_release_id for update;
  if p_activated_at is null or not isfinite(p_activated_at)
    or p_activated_at > clock_timestamp() or p_activated_at > r.fresh_through
    or clock_timestamp() > r.fresh_through then
    raise exception 'invalid or stale retrieval activation time';
  end if;
  return retrieval.activate_index_under_scope_lock(p_index_release_id, p_expected_manifest_sha256, p_activated_at);
end;
$$;
create function policy.rollback_retrieval_index_release(
  p_policy_domain text, p_assurance_tier text, p_rolled_back_at timestamptz
) returns jsonb language plpgsql security definer
set search_path = policy, retrieval, pg_catalog as $$
declare p retrieval.active_index_pointers%rowtype;
begin
  perform retrieval.lock_index_scope(p_policy_domain, p_assurance_tier);
  select * into strict p from retrieval.active_index_pointers
    where policy_domain = p_policy_domain and assurance_tier = p_assurance_tier for update;
  if p_rolled_back_at is null or not isfinite(p_rolled_back_at)
    or p_rolled_back_at < p.updated_at or p_rolled_back_at > clock_timestamp() then
    raise exception 'invalid retrieval rollback time';
  end if;
  if not exists (select 1 from retrieval.index_releases
    where index_release_id = p.active_index_release_id and release_state = 'ACTIVE'
      and policy_domain = p_policy_domain and assurance_tier = p_assurance_tier)
    or not exists (select 1 from retrieval.index_releases
      where index_release_id = p.previous_index_release_id and release_state = 'RETIRED'
        and policy_domain = p_policy_domain and assurance_tier = p_assurance_tier
        and fresh_through >= clock_timestamp()) then
    raise exception 'no eligible previous retrieval index is available for rollback';
  end if;
  return retrieval.rollback_index_under_scope_lock(p_policy_domain, p_assurance_tier, p_rolled_back_at);
end;
$$;

create function policy.inspect_retrieval_index_pointer(p_policy_domain text, p_assurance_tier text)
returns jsonb language plpgsql stable security definer
set search_path = policy, retrieval, pg_catalog as $$
begin
  if p_policy_domain is null or p_policy_domain !~ '^[a-z][a-z0-9-]{2,40}$'
    or p_assurance_tier is null or p_assurance_tier not in ('PROVISIONAL', 'HUMAN_REVIEWED') then
    raise exception 'invalid retrieval scope';
  end if;
  return (select jsonb_build_object('policyDomain', p.policy_domain,
    'assuranceTier', p.assurance_tier, 'activeIndexReleaseId', p.active_index_release_id,
    'previousIndexReleaseId', p.previous_index_release_id, 'revision', p.revision::text,
    'manifestSha256', r.manifest_sha256)
    from retrieval.active_index_pointers p left join retrieval.index_releases r
      on r.index_release_id = p.active_index_release_id
    where p.policy_domain = p_policy_domain and p.assurance_tier = p_assurance_tier);
end;
$$;

create function policy.suspend_retrieval_index_release(
  p_operation_id text, p_policy_domain text, p_assurance_tier text,
  p_index_release_id text, p_expected_manifest_sha256 text,
  p_expected_revision bigint, p_reason text
) returns jsonb language plpgsql security definer
set search_path = policy, retrieval, pg_catalog as $$
declare
  op retrieval.index_suspension_operations%rowtype;
  p retrieval.active_index_pointers%rowtype;
  r retrieval.index_releases%rowtype;
  result jsonb;
  v_suspended_at timestamptz;
begin
  if p_operation_id is null or p_operation_id !~ '^[a-z0-9][a-z0-9._:-]{2,200}$'
    or p_index_release_id is null or p_index_release_id !~ '^[a-z0-9][a-z0-9._:-]{2,200}$'
    or p_expected_manifest_sha256 is null or p_expected_manifest_sha256 !~ '^[0-9a-f]{64}$'
    or p_expected_revision is null or p_expected_revision < 1
    or p_reason is null or length(btrim(p_reason)) = 0 or length(p_reason) > 500 then
    raise exception 'invalid retrieval suspension request';
  end if;
  -- Operation namespace first, scope second; neither other entry point takes an operation lock.
  perform pg_advisory_xact_lock(73602, hashtext(p_operation_id));
  perform retrieval.lock_index_scope(p_policy_domain, p_assurance_tier);
  select * into op from retrieval.index_suspension_operations where operation_id = p_operation_id;
  if found then
    if op.policy_domain is distinct from p_policy_domain or op.assurance_tier is distinct from p_assurance_tier
      or op.index_release_id is distinct from p_index_release_id
      or op.expected_manifest_sha256 is distinct from p_expected_manifest_sha256
      or op.expected_revision is distinct from p_expected_revision or op.reason is distinct from p_reason then
      raise exception 'retrieval suspension operation replay conflict';
    end if;
    return op.result;
  end if;
  select * into p from retrieval.active_index_pointers
    where policy_domain = p_policy_domain and assurance_tier = p_assurance_tier for update;
  if not found or p.active_index_release_id is distinct from p_index_release_id
    or p.revision is distinct from p_expected_revision then
    raise exception 'retrieval suspension pointer is stale';
  end if;
  select * into strict r from retrieval.index_releases where index_release_id = p_index_release_id for update;
  if r.policy_domain is distinct from p_policy_domain or r.assurance_tier is distinct from p_assurance_tier
    or r.release_state <> 'ACTIVE' or r.manifest_sha256 is distinct from p_expected_manifest_sha256 then
    raise exception 'retrieval suspension target is stale';
  end if;
  v_suspended_at := clock_timestamp();
  update retrieval.index_releases set release_state = 'SUSPENDED', suspended_at = v_suspended_at
    where index_release_id = p_index_release_id;
  update retrieval.active_index_pointers set active_index_release_id = null,
    previous_index_release_id = null, updated_at = v_suspended_at
    where policy_domain = p_policy_domain and assurance_tier = p_assurance_tier;
  result := jsonb_build_object('operationId', p_operation_id, 'policyDomain', p_policy_domain,
    'assuranceTier', p_assurance_tier, 'indexReleaseId', p_index_release_id,
    'manifestSha256', p_expected_manifest_sha256, 'releaseState', 'SUSPENDED',
    'activeIndexReleaseId', null, 'revision', (p.revision + 1)::text, 'suspendedAt', v_suspended_at);
  insert into retrieval.index_suspension_operations(operation_id, policy_domain, assurance_tier,
    index_release_id, expected_manifest_sha256, expected_revision, reason, result)
  values (p_operation_id, p_policy_domain, p_assurance_tier, p_index_release_id,
    p_expected_manifest_sha256, p_expected_revision, p_reason, result);
  return result;
end;
$$;

revoke all on function policy.activate_retrieval_index_release(text,text,timestamptz) from public, anon, authenticated;
revoke all on function policy.rollback_retrieval_index_release(text,text,timestamptz) from public, anon, authenticated;
revoke all on function policy.inspect_retrieval_index_pointer(text,text) from public, anon, authenticated;
revoke all on function policy.suspend_retrieval_index_release(text,text,text,text,text,bigint,text) from public, anon, authenticated;
grant execute on function policy.activate_retrieval_index_release(text,text,timestamptz) to service_role;
grant execute on function policy.rollback_retrieval_index_release(text,text,timestamptz) to service_role;
grant execute on function policy.inspect_retrieval_index_pointer(text,text) to service_role;
grant execute on function policy.suspend_retrieval_index_release(text,text,text,text,text,bigint,text) to service_role;
-- Existing resolve/list SQL explicitly permits ACTIVE/RETIRED only, so
-- SUSPENDED is denied for default and pinned fresh retrieval without changes.
notify pgrst, 'reload schema';
commit;
