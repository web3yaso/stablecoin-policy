begin;

create function policy.get_official_source_ingestion_status(p_version_id text)
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

revoke all on function policy.get_official_source_ingestion_status(text)
from public, anon, authenticated;
grant execute on function policy.get_official_source_ingestion_status(text)
to service_role;

comment on function policy.get_official_source_ingestion_status is
  'Service-only ingestion health metadata. It exposes no source text, claims, reviews, or playbook data.';

commit;
