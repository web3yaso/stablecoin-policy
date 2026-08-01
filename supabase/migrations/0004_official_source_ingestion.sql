begin;

create function policy.ingest_official_source(
  p_object_id text,
  p_bucket text,
  p_object_key text,
  p_checksum_sha256 text,
  p_byte_size bigint,
  p_content_type text,
  p_authority jsonb,
  p_document jsonb,
  p_version jsonb,
  p_provisions jsonb
)
returns text
language plpgsql
set search_path = policy, regulatory, public
as $$
declare
  v_existing policy.storage_objects%rowtype;
  v_version_id text := p_version->>'versionId';
begin
  if jsonb_typeof(p_provisions) <> 'array' or jsonb_array_length(p_provisions) = 0 then
    raise exception 'official source ingestion requires provisions';
  end if;

  select * into v_existing
  from policy.storage_objects
  where object_id = p_object_id
     or (provider = 'supabase-storage' and bucket = p_bucket and object_key = p_object_key)
  limit 1;

  if found and (
    v_existing.object_id <> p_object_id
    or v_existing.bucket <> p_bucket
    or v_existing.object_key <> p_object_key
    or v_existing.checksum_sha256 <> p_checksum_sha256
    or v_existing.byte_size <> p_byte_size
    or v_existing.content_type <> p_content_type
  ) then
    raise exception 'immutable source object metadata conflict';
  end if;

  insert into policy.storage_objects (
    object_id, provider, bucket, object_key, checksum_sha256, byte_size,
    content_type, encryption_state
  ) values (
    p_object_id, 'supabase-storage', p_bucket, p_object_key, p_checksum_sha256,
    p_byte_size, p_content_type, 'PROVIDER_ENCRYPTED'
  ) on conflict (object_id) do nothing;

  insert into regulatory.source_authorities (
    authority_id, name, jurisdiction_code, authority_type, official_domains
  ) values (
    p_authority->>'authorityId', p_authority->>'name',
    p_authority->>'jurisdictionCode', p_authority->>'authorityType',
    array(select jsonb_array_elements_text(p_authority->'officialDomains'))
  ) on conflict (authority_id) do nothing;

  insert into regulatory.source_documents (
    document_id, authority_id, official_document_id, document_type, title,
    canonical_url, language_codes, redistribution_rights, licence_identifier
  ) values (
    p_document->>'documentId', p_document->>'authorityId',
    p_document->>'officialDocumentId', p_document->>'documentType',
    p_document->>'title', p_document->>'canonicalUrl',
    array(select jsonb_array_elements_text(p_document->'languageCodes')),
    p_document->>'redistributionRights', p_document->>'licenceIdentifier'
  ) on conflict (document_id) do nothing;

  insert into regulatory.source_versions (
    version_id, document_id, version_label, raw_object_id, checksum_sha256,
    official_url, published_at, observed_at, retrieved_at, lifecycle_state
  ) values (
    v_version_id, p_version->>'documentId', p_version->>'versionLabel',
    p_object_id, p_checksum_sha256, p_version->>'officialUrl',
    nullif(p_version->>'publishedAt', '')::timestamptz,
    (p_version->>'observedAt')::timestamptz,
    (p_version->>'retrievedAt')::timestamptz, 'OBSERVED'
  ) on conflict (version_id) do nothing;

  insert into regulatory.provisions (
    provision_id, version_id, locator, heading, language_code, provision_text,
    text_checksum_sha256, ordinal, excerpt_permission
  )
  select
    row.provision_id, v_version_id, row.locator, row.heading,
    row.language_code, row.provision_text, row.text_checksum_sha256,
    row.ordinal, row.excerpt_permission
  from (
    select
      item->>'provisionId' as provision_id,
      item->>'locator' as locator,
      item->>'heading' as heading,
      item->>'languageCode' as language_code,
      item->>'provisionText' as provision_text,
      item->>'textChecksumSha256' as text_checksum_sha256,
      (item->>'ordinal')::integer as ordinal,
      item->>'excerptPermission' as excerpt_permission
    from jsonb_array_elements(p_provisions) item
  ) row
  on conflict (provision_id) do nothing;

  return v_version_id;
end;
$$;

revoke all on function policy.ingest_official_source(
  text, text, text, text, bigint, text, jsonb, jsonb, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function policy.ingest_official_source(
  text, text, text, text, bigint, text, jsonb, jsonb, jsonb, jsonb
) to service_role;

comment on function policy.ingest_official_source is
  'Atomically registers one immutable official source version and provision candidates. It never creates legal claims.';

commit;
