begin;

create table policy.datasets (
  dataset_id text primary key check (dataset_id ~ '^[a-z0-9][a-z0-9-]{2,80}$'),
  active_release_id text,
  description text,
  created_at timestamptz not null default now()
);

create table policy.dataset_releases (
  release_id text primary key,
  dataset_id text not null references policy.datasets(dataset_id),
  artifact_object_id text not null references policy.storage_objects(object_id),
  schema_version text not null,
  generated_at timestamptz not null,
  published_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (dataset_id, generated_at, artifact_object_id)
);

alter table policy.datasets
  add constraint datasets_active_release_fk
  foreign key (active_release_id)
  references policy.dataset_releases(release_id);

create index dataset_releases_dataset_published_idx
  on policy.dataset_releases (dataset_id, published_at desc);

alter table policy.datasets enable row level security;
alter table policy.dataset_releases enable row level security;

create view policy.report_release_catalog
with (security_invoker = true)
as
select
  r.slug,
  rr.release_id,
  rr.title,
  rr.title_en,
  rr.summary,
  rr.category,
  rr.jurisdictions,
  rr.published_at,
  rr.word_count,
  rr.price_usd,
  rr.metadata ->> 'encryptedContentFile' as encrypted_content_file,
  so.object_key as artifact_key,
  so.checksum_sha256 as artifact_checksum_sha256,
  rr.source_url,
  rr.publication_state
from policy.report_releases rr
join policy.reports r on r.report_id = rr.report_id
join policy.storage_objects so on so.object_id = rr.artifact_object_id;

create view policy.active_report_catalog
with (security_invoker = true)
as
select catalog.*
from policy.reports r
join policy.report_release_catalog catalog
  on catalog.release_id = r.active_release_id
where catalog.publication_state = 'PUBLISHED';

create view policy.dataset_release_catalog
with (security_invoker = true)
as
select
  dr.dataset_id,
  dr.release_id,
  so.object_key,
  so.checksum_sha256,
  so.byte_size,
  so.content_type,
  dr.schema_version,
  dr.generated_at,
  dr.published_at
from policy.dataset_releases dr
join policy.storage_objects so on so.object_id = dr.artifact_object_id;

create view policy.active_dataset_catalog
with (security_invoker = true)
as
select catalog.*
from policy.datasets d
join policy.dataset_release_catalog catalog
  on catalog.release_id = d.active_release_id;

create or replace function policy.publish_report_release(
  p_object_id text,
  p_provider text,
  p_bucket text,
  p_object_key text,
  p_checksum_sha256 text,
  p_byte_size bigint,
  p_content_type text,
  p_encryption_state text,
  p_report_id text,
  p_slug text,
  p_release_id text,
  p_title text,
  p_title_en text,
  p_summary text,
  p_category text,
  p_jurisdictions text[],
  p_published_at timestamptz,
  p_word_count integer,
  p_price_usd numeric,
  p_source_url text,
  p_metadata jsonb
)
returns text
language plpgsql
security definer
set search_path = policy, public
as $$
declare
  v_object_id text;
  v_checksum text;
  v_report_id text;
  v_release_report_id text;
  v_release_object_id text;
begin
  select object_id, checksum_sha256
    into v_object_id, v_checksum
  from policy.storage_objects
  where provider = p_provider and bucket = p_bucket and object_key = p_object_key;

  if found then
    if v_checksum <> p_checksum_sha256 then
      raise exception 'immutable object checksum conflict for %', p_object_key;
    end if;
  else
    insert into policy.storage_objects (
      object_id, provider, bucket, object_key, checksum_sha256,
      byte_size, content_type, encryption_state
    ) values (
      p_object_id, p_provider, p_bucket, p_object_key, p_checksum_sha256,
      p_byte_size, p_content_type, p_encryption_state
    );
    v_object_id := p_object_id;
  end if;

  insert into policy.reports (report_id, slug)
  values (p_report_id, p_slug)
  on conflict (slug) do nothing;

  select report_id into v_report_id
  from policy.reports
  where slug = p_slug;

  select report_id, artifact_object_id
    into v_release_report_id, v_release_object_id
  from policy.report_releases
  where release_id = p_release_id;

  if found then
    if v_release_report_id <> v_report_id or v_release_object_id <> v_object_id then
      raise exception 'report release identity conflict for %', p_release_id;
    end if;
  else
    insert into policy.report_releases (
      release_id, report_id, artifact_object_id, title, title_en,
      summary, category, jurisdictions, published_at, word_count,
      price_usd, source_url, publication_state, metadata
    ) values (
      p_release_id, v_report_id, v_object_id, p_title, p_title_en,
      p_summary, p_category, p_jurisdictions, p_published_at, p_word_count,
      p_price_usd, p_source_url, 'PUBLISHED', coalesce(p_metadata, '{}'::jsonb)
    );
  end if;

  update policy.reports target
  set active_release_id = p_release_id
  where target.report_id = v_report_id
    and (
      target.active_release_id is null
      or p_published_at >= (
        select current_release.published_at
        from policy.report_releases current_release
        where current_release.release_id = target.active_release_id
      )
    );

  return p_release_id;
end;
$$;

create or replace function policy.publish_dataset_release(
  p_object_id text,
  p_provider text,
  p_bucket text,
  p_object_key text,
  p_checksum_sha256 text,
  p_byte_size bigint,
  p_content_type text,
  p_dataset_id text,
  p_release_id text,
  p_schema_version text,
  p_generated_at timestamptz,
  p_published_at timestamptz,
  p_description text,
  p_metadata jsonb
)
returns text
language plpgsql
security definer
set search_path = policy, public
as $$
declare
  v_object_id text;
  v_checksum text;
  v_release_dataset_id text;
  v_release_object_id text;
begin
  select object_id, checksum_sha256
    into v_object_id, v_checksum
  from policy.storage_objects
  where provider = p_provider and bucket = p_bucket and object_key = p_object_key;

  if found then
    if v_checksum <> p_checksum_sha256 then
      raise exception 'immutable object checksum conflict for %', p_object_key;
    end if;
  else
    insert into policy.storage_objects (
      object_id, provider, bucket, object_key, checksum_sha256,
      byte_size, content_type, encryption_state
    ) values (
      p_object_id, p_provider, p_bucket, p_object_key, p_checksum_sha256,
      p_byte_size, p_content_type, 'PROVIDER_ENCRYPTED'
    );
    v_object_id := p_object_id;
  end if;

  insert into policy.datasets (dataset_id, description)
  values (p_dataset_id, p_description)
  on conflict (dataset_id) do update
    set description = coalesce(policy.datasets.description, excluded.description);

  select dataset_id, artifact_object_id
    into v_release_dataset_id, v_release_object_id
  from policy.dataset_releases
  where release_id = p_release_id;

  if found then
    if v_release_dataset_id <> p_dataset_id or v_release_object_id <> v_object_id then
      raise exception 'dataset release identity conflict for %', p_release_id;
    end if;
  else
    insert into policy.dataset_releases (
      release_id, dataset_id, artifact_object_id, schema_version,
      generated_at, published_at, metadata
    ) values (
      p_release_id, p_dataset_id, v_object_id, p_schema_version,
      p_generated_at, p_published_at, coalesce(p_metadata, '{}'::jsonb)
    );
  end if;

  update policy.datasets target
  set active_release_id = p_release_id
  where target.dataset_id = p_dataset_id
    and (
      target.active_release_id is null
      or p_published_at >= (
        select current_release.published_at
        from policy.dataset_releases current_release
        where current_release.release_id = target.active_release_id
      )
    );

  return p_release_id;
end;
$$;

create or replace function policy.activate_report_release(
  p_slug text,
  p_release_id text
)
returns text
language plpgsql
security definer
set search_path = policy, public
as $$
declare
  v_report_id text;
begin
  select report_id into v_report_id from policy.reports where slug = p_slug;
  if v_report_id is null or not exists (
    select 1 from policy.report_releases
    where release_id = p_release_id and report_id = v_report_id
  ) then
    raise exception 'unknown report release % for %', p_release_id, p_slug;
  end if;
  update policy.reports set active_release_id = p_release_id where report_id = v_report_id;
  return p_release_id;
end;
$$;

create or replace function policy.activate_dataset_release(
  p_dataset_id text,
  p_release_id text
)
returns text
language plpgsql
security definer
set search_path = policy, public
as $$
begin
  if not exists (
    select 1 from policy.dataset_releases
    where release_id = p_release_id and dataset_id = p_dataset_id
  ) then
    raise exception 'unknown dataset release % for %', p_release_id, p_dataset_id;
  end if;
  update policy.datasets set active_release_id = p_release_id where dataset_id = p_dataset_id;
  return p_release_id;
end;
$$;

revoke all on function policy.publish_report_release(
  text, text, text, text, text, bigint, text, text, text, text, text,
  text, text, text, text, text[], timestamptz, integer, numeric, text, jsonb
) from public, anon, authenticated;
revoke all on function policy.publish_dataset_release(
  text, text, text, text, text, bigint, text, text, text, text,
  timestamptz, timestamptz, text, jsonb
) from public, anon, authenticated;
revoke all on function policy.activate_report_release(text, text)
  from public, anon, authenticated;
revoke all on function policy.activate_dataset_release(text, text)
  from public, anon, authenticated;

grant usage on schema policy to service_role;
grant select, insert, update on all tables in schema policy to service_role;
grant select on policy.report_release_catalog,
  policy.active_report_catalog,
  policy.dataset_release_catalog,
  policy.active_dataset_catalog to service_role;
grant execute on function policy.publish_report_release(
  text, text, text, text, text, bigint, text, text, text, text, text,
  text, text, text, text, text[], timestamptz, integer, numeric, text, jsonb
) to service_role;
grant execute on function policy.publish_dataset_release(
  text, text, text, text, text, bigint, text, text, text, text,
  timestamptz, timestamptz, text, jsonb
) to service_role;
grant execute on function policy.activate_report_release(text, text)
  to service_role;
grant execute on function policy.activate_dataset_release(text, text)
  to service_role;

comment on table policy.dataset_releases is
  'Immutable generated dataset releases; active pointers may be rolled back to any verified release.';

commit;
