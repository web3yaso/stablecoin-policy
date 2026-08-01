begin;

alter table regulatory.source_versions
  add column retrieval_metadata jsonb not null default '{}'::jsonb
  check (jsonb_typeof(retrieval_metadata) = 'object');

create function policy.ingest_official_source_v2(
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
begin
  if jsonb_typeof(p_retrieval_metadata) <> 'object' then
    raise exception 'source retrieval metadata must be an object';
  end if;

  v_version_id := policy.ingest_official_source(
    p_object_id, p_bucket, p_object_key, p_checksum_sha256, p_byte_size,
    p_content_type, p_authority, p_document, p_version, p_provisions
  );

  select * into strict v_existing
  from regulatory.source_versions
  where version_id = v_version_id;

  if v_existing.effective_from is not null
     and p_effective_from is not null
     and v_existing.effective_from <> p_effective_from then
    raise exception 'source version effective date conflict';
  end if;
  if v_existing.retrieval_metadata <> '{}'::jsonb
     and v_existing.retrieval_metadata <> p_retrieval_metadata then
    raise exception 'source version retrieval metadata conflict';
  end if;

  update regulatory.source_versions
  set effective_from = coalesce(effective_from, p_effective_from),
      retrieval_metadata = case
        when retrieval_metadata = '{}'::jsonb then p_retrieval_metadata
        else retrieval_metadata
      end
  where version_id = v_version_id
    and lifecycle_state = 'OBSERVED';

  return v_version_id;
end;
$$;

revoke all on function policy.ingest_official_source_v2(
  text, text, text, text, bigint, text, jsonb, jsonb, jsonb, jsonb,
  timestamptz, jsonb
) from public, anon, authenticated;
grant execute on function policy.ingest_official_source_v2(
  text, text, text, text, bigint, text, jsonb, jsonb, jsonb, jsonb,
  timestamptz, jsonb
) to service_role;

comment on column regulatory.source_versions.retrieval_metadata is
  'Non-secret provenance for containers and archive entries used to retrieve the immutable source body.';
comment on function policy.ingest_official_source_v2 is
  'Adds archive-level provenance and effective date handling to service-only official source ingestion.';

commit;
