begin;

create function policy.ingest_official_source_v4(
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
  v_version regulatory.source_versions%rowtype;
  v_document regulatory.source_documents%rowtype;
  v_redistribution_rights text := p_document->>'redistributionRights';
  v_licence_identifier text := nullif(btrim(p_document->>'licenceIdentifier'), '');
begin
  if v_redistribution_rights not in ('FULL_TEXT', 'EXCERPT', 'LINK_ONLY', 'UNKNOWN') then
    raise exception 'invalid source redistribution rights';
  end if;

  v_version_id := policy.ingest_official_source_v3(
    p_object_id, p_bucket, p_object_key, p_checksum_sha256, p_byte_size,
    p_content_type, p_authority, p_document, p_version, p_provisions,
    p_effective_from, p_retrieval_metadata
  );

  select * into strict v_version
  from regulatory.source_versions
  where version_id = v_version_id;
  select * into strict v_document
  from regulatory.source_documents
  where document_id = v_version.document_id;

  if v_document.redistribution_rights not in ('UNKNOWN', v_redistribution_rights) then
    raise exception 'source document redistribution-rights conflict';
  end if;
  if v_document.licence_identifier is not null
     and v_document.licence_identifier is distinct from v_licence_identifier then
    raise exception 'source document licence conflict';
  end if;
  if v_version.lifecycle_state <> 'OBSERVED' and (
    v_document.redistribution_rights is distinct from v_redistribution_rights
    or v_document.licence_identifier is distinct from v_licence_identifier
    or exists (
      select 1
      from regulatory.provisions existing
      join jsonb_array_elements(p_provisions) incoming
        on incoming->>'provisionId' = existing.provision_id
      where existing.version_id = v_version_id
        and existing.excerpt_permission is distinct from incoming->>'excerptPermission'
    )
  ) then
    raise exception 'verified source rights are immutable';
  end if;

  if exists (
    select 1
    from regulatory.provisions existing
    join jsonb_array_elements(p_provisions) incoming
      on incoming->>'provisionId' = existing.provision_id
    where existing.version_id = v_version_id
      and existing.excerpt_permission <> 'UNKNOWN'
      and existing.excerpt_permission is distinct from incoming->>'excerptPermission'
  ) then
    raise exception 'source provision excerpt-permission conflict';
  end if;

  update regulatory.source_documents
  set redistribution_rights = case
        when redistribution_rights = 'UNKNOWN' then v_redistribution_rights
        else redistribution_rights
      end,
      licence_identifier = coalesce(licence_identifier, v_licence_identifier)
  where document_id = v_version.document_id
    and v_version.lifecycle_state = 'OBSERVED';

  update regulatory.provisions existing
  set excerpt_permission = incoming.excerpt_permission
  from (
    select
      item->>'provisionId' as provision_id,
      item->>'excerptPermission' as excerpt_permission
    from jsonb_array_elements(p_provisions) item
  ) incoming
  where existing.version_id = v_version_id
    and existing.provision_id = incoming.provision_id
    and existing.excerpt_permission = 'UNKNOWN'
    and incoming.excerpt_permission in ('ALLOWED', 'LINK_ONLY');

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
    'redistributionRights', document.redistribution_rights,
    'licenceIdentifier', document.licence_identifier,
    'provisionCount', count(provision.provision_id),
    'allowedExcerptCount', count(provision.provision_id)
      filter (where provision.excerpt_permission = 'ALLOWED'),
    'linkOnlyExcerptCount', count(provision.provision_id)
      filter (where provision.excerpt_permission = 'LINK_ONLY'),
    'unknownExcerptCount', count(provision.provision_id)
      filter (where provision.excerpt_permission = 'UNKNOWN'),
    'firstOrdinal', min(provision.ordinal),
    'lastOrdinal', max(provision.ordinal)
  )
  from regulatory.source_versions version
  join regulatory.source_documents document
    on document.document_id = version.document_id
  left join regulatory.provisions provision
    on provision.version_id = version.version_id
  where version.version_id = p_version_id
  group by version.version_id, document.document_id;
$$;

revoke all on function policy.ingest_official_source_v4(
  text, text, text, text, bigint, text, jsonb, jsonb, jsonb, jsonb,
  timestamptz, jsonb
) from public, anon, authenticated;
grant execute on function policy.ingest_official_source_v4(
  text, text, text, text, bigint, text, jsonb, jsonb, jsonb, jsonb,
  timestamptz, jsonb
) to service_role;

revoke all on function policy.get_official_source_ingestion_status(text)
from public, anon, authenticated;
grant execute on function policy.get_official_source_ingestion_status(text)
to service_role;

comment on function policy.ingest_official_source_v4 is
  'Reconciles reviewed document and excerpt rights for observed versions without permitting conflicting or verified-version mutations.';

commit;
