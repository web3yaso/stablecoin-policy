begin;

insert into storage.buckets (id, name, public)
values ('policy-playbooks', 'policy-playbooks', false)
on conflict (id) do update set public = false;

create table policy.playbook_packages (
  package_id text primary key
    check (package_id ~ '^package:[a-z0-9-]+:[0-9a-f]{16}$'),
  playbook_id text not null
    check (playbook_id ~ '^[a-z0-9][a-z0-9-]{2,80}$'),
  profile_fingerprint text not null
    check (profile_fingerprint ~ '^[0-9a-f]{64}$'),
  artifact_object_id text not null unique
    references policy.storage_objects(object_id),
  artifact_checksum_sha256 text not null
    check (artifact_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  integrity_sha256 text not null
    check (integrity_sha256 ~ '^[0-9a-f]{64}$'),
  schema_version text not null,
  evaluated_at timestamptz not null,
  assurance_review_status text not null
    check (assurance_review_status in ('PROVISIONAL', 'HUMAN_REVIEWED')),
  corpus_release_id text,
  retrieval_index_release_id text,
  dossier_id text,
  rules_version text not null,
  template_version text not null,
  created_at timestamptz not null default now()
);

create table policy.playbook_package_idempotency (
  idempotency_key_sha256 text primary key
    check (idempotency_key_sha256 ~ '^[0-9a-f]{64}$'),
  request_fingerprint_sha256 text not null
    check (request_fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
  package_id text references policy.playbook_packages(package_id),
  state text not null default 'PENDING'
    check (state in ('PENDING', 'COMPLETED')),
  lease_expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  check (
    (state = 'PENDING' and package_id is null and completed_at is null)
    or (state = 'COMPLETED' and package_id is not null and completed_at is not null)
  )
);

create index playbook_packages_playbook_evaluated_idx
  on policy.playbook_packages (playbook_id, evaluated_at desc);

create trigger playbook_packages_immutable
before update or delete on policy.playbook_packages
for each row execute function regulatory.reject_immutable_row_change();

create or replace function policy.guard_playbook_package_idempotency_change()
returns trigger
language plpgsql
set search_path = policy, public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'playbook package idempotency rows cannot be deleted';
  end if;
  if old.idempotency_key_sha256 <> new.idempotency_key_sha256
     or old.request_fingerprint_sha256 <> new.request_fingerprint_sha256
     or old.created_at <> new.created_at
     or old.state = 'COMPLETED'
     or (new.state = 'COMPLETED' and new.package_id is null) then
    raise exception 'completed playbook package idempotency rows are immutable';
  end if;
  return new;
end;
$$;

create trigger playbook_package_idempotency_guard
before update or delete on policy.playbook_package_idempotency
for each row execute function policy.guard_playbook_package_idempotency_change();

alter table policy.playbook_packages enable row level security;
alter table policy.playbook_package_idempotency enable row level security;

create or replace function policy.claim_playbook_package_idempotency(
  p_idempotency_key_sha256 text,
  p_request_fingerprint_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = policy, public
as $$
declare
  v_record policy.playbook_package_idempotency%rowtype;
  v_lease_expires_at timestamptz := clock_timestamp() + interval '2 minutes';
  v_inserted_count integer;
begin
  insert into policy.playbook_package_idempotency (
    idempotency_key_sha256, request_fingerprint_sha256, lease_expires_at
  ) values (
    p_idempotency_key_sha256, p_request_fingerprint_sha256, v_lease_expires_at
  )
  on conflict (idempotency_key_sha256) do nothing;
  get diagnostics v_inserted_count = row_count;

  select * into v_record
  from policy.playbook_package_idempotency
  where idempotency_key_sha256 = p_idempotency_key_sha256
  for update;

  if v_record.request_fingerprint_sha256 <> p_request_fingerprint_sha256 then
    raise exception 'playbook idempotency key conflict';
  end if;
  if v_record.state = 'COMPLETED' then
    return jsonb_build_object(
      'status', 'COMPLETED',
      'packageId', v_record.package_id
    );
  end if;
  if v_inserted_count = 0
     and v_record.lease_expires_at > clock_timestamp() then
    return jsonb_build_object(
      'status', 'PENDING',
      'retryAfter', v_record.lease_expires_at
    );
  end if;

  update policy.playbook_package_idempotency
  set lease_expires_at = v_lease_expires_at
  where idempotency_key_sha256 = p_idempotency_key_sha256;

  return jsonb_build_object(
    'status', 'CLAIMED',
    'leaseExpiresAt', v_lease_expires_at
  );
end;
$$;

create or replace function policy.bind_playbook_package_idempotency(
  p_idempotency_key_sha256 text,
  p_request_fingerprint_sha256 text,
  p_package_id text
)
returns text
language plpgsql
security definer
set search_path = policy, public
as $$
declare
  v_record policy.playbook_package_idempotency%rowtype;
begin
  if not exists (
    select 1 from policy.playbook_packages p where p.package_id = p_package_id
  ) then
    raise exception 'unknown playbook package %', p_package_id;
  end if;

  select * into v_record
  from policy.playbook_package_idempotency
  where idempotency_key_sha256 = p_idempotency_key_sha256
  for update;

  if not found then
    raise exception 'playbook idempotency key was not claimed';
  end if;
  if v_record.request_fingerprint_sha256 <> p_request_fingerprint_sha256
     or (v_record.state = 'COMPLETED' and v_record.package_id <> p_package_id) then
    raise exception 'playbook idempotency key conflict';
  end if;
  if v_record.state = 'PENDING' then
    update policy.playbook_package_idempotency
    set package_id = p_package_id,
        state = 'COMPLETED',
        completed_at = clock_timestamp()
    where idempotency_key_sha256 = p_idempotency_key_sha256;
  end if;

  return p_package_id;
end;
$$;

create or replace function policy.register_playbook_package(
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
  p_request_fingerprint_sha256 text
)
returns text
language plpgsql
security definer
set search_path = policy, public
as $$
declare
  v_object_id text;
  v_object_checksum text;
  v_existing policy.playbook_packages%rowtype;
begin
  if p_provider <> 'supabase-storage'
     or p_bucket <> 'policy-playbooks'
     or p_content_type <> 'application/json'
     or p_byte_size <= 0
     or p_object_id <> 'object:playbook-package:' || left(p_integrity_sha256, 32)
     or p_package_id <> 'package:' || p_playbook_id || ':' || left(p_integrity_sha256, 16)
     or p_object_key <> 'packages/' || p_playbook_id || '/' || p_integrity_sha256 || '.json' then
    raise exception 'invalid playbook artifact identity';
  end if;

  select object_id, checksum_sha256
    into v_object_id, v_object_checksum
  from policy.storage_objects
  where provider = p_provider and bucket = p_bucket and object_key = p_object_key;

  if found then
    if v_object_checksum <> p_artifact_checksum_sha256 then
      raise exception 'immutable playbook artifact checksum conflict for %', p_object_key;
    end if;
  else
    insert into policy.storage_objects (
      object_id, provider, bucket, object_key, checksum_sha256,
      byte_size, content_type, encryption_state
    ) values (
      p_object_id, p_provider, p_bucket, p_object_key,
      p_artifact_checksum_sha256, p_byte_size, p_content_type,
      'PROVIDER_ENCRYPTED'
    );
    v_object_id := p_object_id;
  end if;

  select * into v_existing
  from policy.playbook_packages
  where package_id = p_package_id;

  if found then
    if v_existing.playbook_id <> p_playbook_id
       or v_existing.profile_fingerprint <> p_profile_fingerprint
       or v_existing.artifact_object_id <> v_object_id
       or v_existing.artifact_checksum_sha256 <> p_artifact_checksum_sha256
       or v_existing.integrity_sha256 <> p_integrity_sha256
       or v_existing.schema_version <> p_schema_version
       or v_existing.evaluated_at <> p_evaluated_at
       or v_existing.assurance_review_status <> p_assurance_review_status
       or v_existing.corpus_release_id is distinct from p_corpus_release_id
       or v_existing.retrieval_index_release_id is distinct from p_retrieval_index_release_id
       or v_existing.dossier_id is distinct from p_dossier_id
       or v_existing.rules_version <> p_rules_version
       or v_existing.template_version <> p_template_version then
      raise exception 'immutable playbook package conflict for %', p_package_id;
    end if;
  else
    insert into policy.playbook_packages (
      package_id, playbook_id, profile_fingerprint, artifact_object_id,
      artifact_checksum_sha256, integrity_sha256, schema_version,
      evaluated_at, assurance_review_status, corpus_release_id,
      retrieval_index_release_id, dossier_id, rules_version, template_version
    ) values (
      p_package_id, p_playbook_id, p_profile_fingerprint, v_object_id,
      p_artifact_checksum_sha256, p_integrity_sha256, p_schema_version,
      p_evaluated_at, p_assurance_review_status, p_corpus_release_id,
      p_retrieval_index_release_id, p_dossier_id, p_rules_version,
      p_template_version
    );
  end if;

  perform policy.bind_playbook_package_idempotency(
    p_idempotency_key_sha256,
    p_request_fingerprint_sha256,
    p_package_id
  );

  return p_package_id;
end;
$$;

create or replace function policy.get_playbook_package_artifact(
  p_package_id text
)
returns jsonb
language sql
stable
security definer
set search_path = policy, public
as $$
  select jsonb_build_object(
    'packageId', p.package_id,
    'playbookId', p.playbook_id,
    'profileFingerprint', p.profile_fingerprint,
    'artifactObjectId', p.artifact_object_id,
    'objectKey', o.object_key,
    'checksumSha256', o.checksum_sha256,
    'byteSize', o.byte_size,
    'contentType', o.content_type,
    'integritySha256', p.integrity_sha256,
    'schemaVersion', p.schema_version,
    'evaluatedAt', p.evaluated_at,
    'assuranceReviewStatus', p.assurance_review_status,
    'corpusReleaseId', p.corpus_release_id,
    'retrievalIndexReleaseId', p.retrieval_index_release_id,
    'dossierId', p.dossier_id,
    'rulesVersion', p.rules_version,
    'templateVersion', p.template_version
  )
  from policy.playbook_packages p
  join policy.storage_objects o on o.object_id = p.artifact_object_id
  where p.package_id = p_package_id;
$$;

create or replace function policy.get_playbook_package_by_idempotency(
  p_idempotency_key_sha256 text
)
returns jsonb
language sql
stable
security definer
set search_path = policy, public
as $$
  select policy.get_playbook_package_artifact(i.package_id)
    || jsonb_build_object(
      'requestFingerprintSha256', i.request_fingerprint_sha256
    )
  from policy.playbook_package_idempotency i
  where i.idempotency_key_sha256 = p_idempotency_key_sha256
    and i.state = 'COMPLETED';
$$;

revoke all on table policy.playbook_packages,
  policy.playbook_package_idempotency
from public, anon, authenticated, service_role;

revoke all on function policy.claim_playbook_package_idempotency(text,text),
  policy.bind_playbook_package_idempotency(text,text,text),
  policy.register_playbook_package(
    text,text,text,text,text,bigint,text,text,text,text,text,text,timestamptz,
    text,text,text,text,text,text,text,text
  ),
  policy.get_playbook_package_artifact(text),
  policy.get_playbook_package_by_idempotency(text)
from public, anon, authenticated;

grant select on table policy.playbook_packages,
  policy.playbook_package_idempotency
to service_role;

grant execute on function policy.claim_playbook_package_idempotency(text,text),
  policy.register_playbook_package(
    text,text,text,text,text,bigint,text,text,text,text,text,text,timestamptz,
    text,text,text,text,text,text,text,text
  ),
  policy.get_playbook_package_artifact(text),
  policy.get_playbook_package_by_idempotency(text)
to service_role;

comment on table policy.playbook_packages is
  'Queryable immutable metadata for paid PlaybookPackage artifacts. Complete JSON lives only in private object storage; raw customer profiles are not stored here.';

comment on table policy.playbook_package_idempotency is
  'Hashed retry keys bound immutably to one request fingerprint and package. Raw Idempotency-Key values are never stored.';

commit;
