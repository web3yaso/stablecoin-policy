begin;

create table regulatory.provision_rights_reviews (
  provision_id text primary key references regulatory.provisions(provision_id),
  version_id text not null references regulatory.source_versions(version_id),
  excerpt_permission text not null
    check (excerpt_permission in ('ALLOWED', 'LINK_ONLY')),
  rights_reviewed_at timestamptz not null,
  rights_basis text not null check (nullif(btrim(rights_basis), '') is not null),
  created_at timestamptz not null default now()
);

create function regulatory.validate_provision_rights_review()
returns trigger
language plpgsql
set search_path = regulatory, public
as $$
begin
  if not exists (
    select 1
    from regulatory.provisions provision
    where provision.provision_id = new.provision_id
      and provision.version_id = new.version_id
      and provision.excerpt_permission = 'UNKNOWN'
  ) then
    raise exception 'provision rights review requires a matching UNKNOWN provision';
  end if;
  return new;
end;
$$;

create trigger validate_provision_rights_review_trigger
before insert on regulatory.provision_rights_reviews
for each row execute function regulatory.validate_provision_rights_review();

create trigger protect_provision_rights_review_trigger
before update or delete on regulatory.provision_rights_reviews
for each row execute function regulatory.reject_immutable_row_change();

alter table regulatory.provision_rights_reviews enable row level security;

create function policy.ingest_official_source_v5(
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
  v_rights_reviewed_at timestamptz := nullif(p_version->>'rightsReviewedAt', '')::timestamptz;
  v_rights_basis text := nullif(btrim(p_version->>'rightsBasis'), '');
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
  ) then
    raise exception 'verified source rights are immutable';
  end if;

  if exists (
    select 1
    from regulatory.provisions existing
    join jsonb_array_elements(p_provisions) incoming
      on incoming->>'provisionId' = existing.provision_id
    left join regulatory.provision_rights_reviews review
      on review.provision_id = existing.provision_id
    where existing.version_id = v_version_id
      and coalesce(review.excerpt_permission, existing.excerpt_permission)
        is distinct from incoming->>'excerptPermission'
      and not (
        existing.excerpt_permission = 'UNKNOWN'
        and review.provision_id is null
        and incoming->>'excerptPermission' in ('ALLOWED', 'LINK_ONLY')
      )
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

  insert into regulatory.provision_rights_reviews (
    provision_id, version_id, excerpt_permission, rights_reviewed_at, rights_basis
  )
  select
    existing.provision_id,
    existing.version_id,
    incoming.item->>'excerptPermission',
    v_rights_reviewed_at,
    v_rights_basis
  from regulatory.provisions existing
  join jsonb_array_elements(p_provisions) incoming(item)
    on incoming.item->>'provisionId' = existing.provision_id
  where existing.version_id = v_version_id
    and existing.excerpt_permission = 'UNKNOWN'
    and incoming.item->>'excerptPermission' in ('ALLOWED', 'LINK_ONLY')
  on conflict (provision_id) do nothing;

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
      filter (where coalesce(review.excerpt_permission, provision.excerpt_permission) = 'ALLOWED'),
    'linkOnlyExcerptCount', count(provision.provision_id)
      filter (where coalesce(review.excerpt_permission, provision.excerpt_permission) = 'LINK_ONLY'),
    'unknownExcerptCount', count(provision.provision_id)
      filter (where coalesce(review.excerpt_permission, provision.excerpt_permission) = 'UNKNOWN'),
    'firstOrdinal', min(provision.ordinal),
    'lastOrdinal', max(provision.ordinal)
  )
  from regulatory.source_versions version
  join regulatory.source_documents document
    on document.document_id = version.document_id
  left join regulatory.provisions provision
    on provision.version_id = version.version_id
  left join regulatory.provision_rights_reviews review
    on review.provision_id = provision.provision_id
  where version.version_id = p_version_id
  group by version.version_id, document.document_id;
$$;

revoke all on table regulatory.provision_rights_reviews
from public, anon, authenticated;
grant select, insert on table regulatory.provision_rights_reviews
to service_role;

revoke all on function policy.ingest_official_source_v5(
  text, text, text, text, bigint, text, jsonb, jsonb, jsonb, jsonb,
  timestamptz, jsonb
) from public, anon, authenticated;
grant execute on function policy.ingest_official_source_v5(
  text, text, text, text, bigint, text, jsonb, jsonb, jsonb, jsonb,
  timestamptz, jsonb
) to service_role;

revoke all on function policy.get_official_source_ingestion_status(text)
from public, anon, authenticated;
grant execute on function policy.get_official_source_ingestion_status(text)
to service_role;

comment on table regulatory.provision_rights_reviews is
  'Immutable reviewed permission overlay for provisions whose extraction-time permission remains UNKNOWN.';
comment on function policy.ingest_official_source_v5 is
  'Reconciles reviewed source rights without mutating immutable provision rows.';

commit;
