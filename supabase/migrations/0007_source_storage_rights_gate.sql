begin;

alter table regulatory.source_versions
  add column storage_rights text not null default 'REVIEW_REQUIRED'
    check (storage_rights in ('ALLOWED', 'REVIEW_REQUIRED', 'PROHIBITED')),
  add column rights_reviewed_at timestamptz,
  add column rights_basis text;

alter table regulatory.source_versions
  add constraint source_versions_allowed_storage_rights_review_check
  check (
    storage_rights <> 'ALLOWED'
    or (rights_reviewed_at is not null and nullif(btrim(rights_basis), '') is not null)
  );

create function policy.ingest_official_source_v3(
  p_object_id text,
  p_bucket text,
  p_object_key text,
  p_checksum_sha256 text,
  p_byte_size bigint,
  p_content_type text,
  p_authority jsonb,
  p_document jsonb,
  p_version jsonb,
  p_provisions jsonb,
  p_effective_from timestamptz,
  p_retrieval_metadata jsonb
)
returns text
language plpgsql
set search_path = policy, regulatory, public
as $$
declare
  v_version_id text;
  v_existing regulatory.source_versions%rowtype;
  v_rights_reviewed_at timestamptz;
  v_rights_basis text;
begin
  if p_version->>'storageRights' <> 'ALLOWED' then
    raise exception 'official source storage rights do not permit ingestion';
  end if;

  v_rights_reviewed_at := nullif(p_version->>'rightsReviewedAt', '')::timestamptz;
  v_rights_basis := nullif(btrim(p_version->>'rightsBasis'), '');
  if v_rights_reviewed_at is null or v_rights_basis is null then
    raise exception 'official source storage rights review is incomplete';
  end if;

  v_version_id := policy.ingest_official_source_v2(
    p_object_id, p_bucket, p_object_key, p_checksum_sha256, p_byte_size,
    p_content_type, p_authority, p_document, p_version, p_provisions,
    p_effective_from, p_retrieval_metadata
  );

  select * into strict v_existing
  from regulatory.source_versions
  where version_id = v_version_id;

  if v_existing.storage_rights = 'ALLOWED' and (
    v_existing.rights_reviewed_at <> v_rights_reviewed_at
    or v_existing.rights_basis <> v_rights_basis
  ) then
    raise exception 'source version storage-rights review conflict';
  end if;
  if v_existing.storage_rights = 'PROHIBITED' then
    raise exception 'source version storage is prohibited';
  end if;

  update regulatory.source_versions
  set storage_rights = 'ALLOWED',
      rights_reviewed_at = v_rights_reviewed_at,
      rights_basis = v_rights_basis
  where version_id = v_version_id
    and lifecycle_state = 'OBSERVED'
    and storage_rights = 'REVIEW_REQUIRED';

  if not exists (
    select 1
    from regulatory.source_versions
    where version_id = v_version_id
      and storage_rights = 'ALLOWED'
      and rights_reviewed_at = v_rights_reviewed_at
      and rights_basis = v_rights_basis
  ) then
    raise exception 'source version storage rights were not recorded';
  end if;

  return v_version_id;
end;
$$;

create or replace function policy.get_official_source_ingestion_status(p_version_id text)
returns jsonb
language sql
stable
set search_path = policy, regulatory, public
as $$
  select jsonb_build_object(
    'versionId', version.version_id,
    'documentId', version.document_id,
    'lifecycleState', version.lifecycle_state,
    'checksumSha256', version.checksum_sha256,
    'verifiedAt', version.verified_at,
    'storageRights', version.storage_rights,
    'rightsReviewedAt', version.rights_reviewed_at,
    'rightsBasis', version.rights_basis,
    'provisionCount', count(provision.provision_id),
    'firstOrdinal', min(provision.ordinal),
    'lastOrdinal', max(provision.ordinal)
  )
  from regulatory.source_versions version
  left join regulatory.provisions provision
    on provision.version_id = version.version_id
  where version.version_id = p_version_id
  group by version.version_id;
$$;

revoke all on function policy.ingest_official_source_v3(
  text, text, text, text, bigint, text, jsonb, jsonb, jsonb, jsonb,
  timestamptz, jsonb
) from public, anon, authenticated;
grant execute on function policy.ingest_official_source_v3(
  text, text, text, text, bigint, text, jsonb, jsonb, jsonb, jsonb,
  timestamptz, jsonb
) to service_role;

revoke all on function policy.get_official_source_ingestion_status(text)
from public, anon, authenticated;
grant execute on function policy.get_official_source_ingestion_status(text)
to service_role;

comment on column regulatory.source_versions.storage_rights is
  'Commercial internal-copy permission, independent of public redistribution and excerpt rights.';
comment on column regulatory.source_versions.rights_reviewed_at is
  'Timestamp of the per-artifact storage-rights review; required when storage is allowed.';
comment on column regulatory.source_versions.rights_basis is
  'Recorded licence, permission, or other reviewed basis for commercial internal storage.';
comment on function policy.ingest_official_source_v3 is
  'Requires reviewed commercial storage rights before service-only official-source ingestion.';

commit;
