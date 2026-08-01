begin;

create extension if not exists pgcrypto with schema extensions;

create table regulatory.source_verification_records (
  verification_id text primary key
    check (verification_id ~ '^[a-z0-9][a-z0-9._:-]{2,160}$'),
  version_id text not null references regulatory.source_versions(version_id),
  outcome text not null check (outcome in ('APPROVED', 'REJECTED')),
  verification_method text not null check (
    verification_method in (
      'OFFICIAL_BYTE_AND_LOCATOR_REVIEW',
      'REFERENCE_COPY_CROSS_CHECK'
    )
  ),
  reviewer_role text not null check (nullif(btrim(reviewer_role), '') is not null),
  reviewer_ref text not null check (nullif(btrim(reviewer_ref), '') is not null),
  manifest_sha256 text not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  reviewed_at timestamptz not null,
  private_notes text,
  created_at timestamptz not null default now()
);

create unique index source_verification_one_approval_idx
  on regulatory.source_verification_records (version_id)
  where outcome = 'APPROVED';

create trigger protect_source_verification_record_trigger
before update or delete on regulatory.source_verification_records
for each row execute function regulatory.reject_immutable_row_change();

alter table regulatory.source_verification_records enable row level security;

create or replace function regulatory.protect_verified_source_version()
returns trigger
language plpgsql
set search_path = regulatory, policy, public
as $$
begin
  if old.lifecycle_state <> 'OBSERVED' and (
    new.version_id is distinct from old.version_id
    or new.document_id is distinct from old.document_id
    or new.version_label is distinct from old.version_label
    or new.raw_object_id is distinct from old.raw_object_id
    or new.checksum_sha256 is distinct from old.checksum_sha256
    or new.official_url is distinct from old.official_url
    or new.published_at is distinct from old.published_at
    or new.effective_from is distinct from old.effective_from
    or new.effective_to is distinct from old.effective_to
    or new.observed_at is distinct from old.observed_at
    or new.retrieved_at is distinct from old.retrieved_at
    or new.storage_rights is distinct from old.storage_rights
    or new.rights_reviewed_at is distinct from old.rights_reviewed_at
    or new.rights_basis is distinct from old.rights_basis
    or new.supersedes_version_id is distinct from old.supersedes_version_id
  ) then
    raise exception 'verified source version % is immutable; create a superseding version', old.version_id;
  end if;
  return new;
end;
$$;

create function policy.build_official_source_verification_manifest(
  p_version_id text
)
returns jsonb
language sql
stable
set search_path = policy, regulatory, public
as $$
  select jsonb_build_object(
    'schemaVersion', '1.0.0',
    'versionId', version.version_id,
    'documentId', version.document_id,
    'versionLabel', version.version_label,
    'rawObjectId', version.raw_object_id,
    'checksumSha256', version.checksum_sha256,
    'officialUrl', version.official_url,
    'publishedAt', version.published_at,
    'effectiveFrom', version.effective_from,
    'effectiveTo', version.effective_to,
    'observedAt', version.observed_at,
    'retrievedAt', version.retrieved_at,
    'storageRights', version.storage_rights,
    'rightsReviewedAt', version.rights_reviewed_at,
    'rightsBasis', version.rights_basis,
    'redistributionRights', document.redistribution_rights,
    'licenceIdentifier', document.licence_identifier,
    'provisions', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'provisionId', provision.provision_id,
          'locator', provision.locator,
          'languageCode', provision.language_code,
          'textChecksumSha256', provision.text_checksum_sha256,
          'ordinal', provision.ordinal,
          'effectiveExcerptPermission', coalesce(
            rights_review.excerpt_permission,
            provision.excerpt_permission
          )
        ) order by provision.ordinal, provision.provision_id
      )
      from regulatory.provisions provision
      left join regulatory.provision_rights_reviews rights_review
        on rights_review.provision_id = provision.provision_id
      where provision.version_id = version.version_id
    ), '[]'::jsonb)
  )
  from regulatory.source_versions version
  join regulatory.source_documents document
    on document.document_id = version.document_id
  where version.version_id = p_version_id;
$$;

create function policy.get_official_source_verification_manifest(
  p_version_id text
)
returns jsonb
language plpgsql
stable
set search_path = policy, regulatory, public, extensions
as $$
declare
  v_manifest jsonb;
  v_version regulatory.source_versions%rowtype;
begin
  select * into strict v_version
  from regulatory.source_versions
  where version_id = p_version_id;

  v_manifest := policy.build_official_source_verification_manifest(p_version_id);
  return jsonb_build_object(
    'manifest', v_manifest,
    'manifestSha256', encode(
      extensions.digest(convert_to(v_manifest::text, 'UTF8'), 'sha256'),
      'hex'
    ),
    'lifecycleState', v_version.lifecycle_state,
    'verifiedAt', v_version.verified_at
  );
end;
$$;

create function policy.review_official_source_version(
  p_verification_id text,
  p_version_id text,
  p_outcome text,
  p_verification_method text,
  p_reviewer_role text,
  p_reviewer_ref text,
  p_manifest_sha256 text,
  p_reviewed_at timestamptz,
  p_private_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = policy, regulatory, public, extensions
as $$
declare
  v_version regulatory.source_versions%rowtype;
  v_manifest jsonb;
  v_actual_manifest_sha256 text;
  v_provision_count integer;
  v_unknown_permission_count integer;
begin
  if p_verification_id !~ '^[a-z0-9][a-z0-9._:-]{2,160}$' then
    raise exception 'invalid source verification id';
  end if;
  if p_outcome not in ('APPROVED', 'REJECTED') then
    raise exception 'invalid source verification outcome';
  end if;
  if p_verification_method not in (
    'OFFICIAL_BYTE_AND_LOCATOR_REVIEW',
    'REFERENCE_COPY_CROSS_CHECK'
  ) then
    raise exception 'invalid source verification method';
  end if;
  if nullif(btrim(p_reviewer_role), '') is null
     or nullif(btrim(p_reviewer_ref), '') is null then
    raise exception 'source verification requires an identified human reviewer';
  end if;
  if lower(btrim(p_reviewer_ref)) in ('ai', 'llm', 'system', 'automation', 'unknown') then
    raise exception 'source verification requires an identified human reviewer';
  end if;
  if p_manifest_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid source verification manifest checksum';
  end if;
  if p_reviewed_at is null or p_reviewed_at > now() + interval '5 minutes' then
    raise exception 'invalid source verification review time';
  end if;

  select * into strict v_version
  from regulatory.source_versions
  where version_id = p_version_id
  for update;

  if v_version.lifecycle_state <> 'OBSERVED' then
    raise exception 'only OBSERVED source versions may be reviewed';
  end if;
  if p_reviewed_at < v_version.retrieved_at then
    raise exception 'source verification cannot predate retrieval';
  end if;

  v_manifest := policy.build_official_source_verification_manifest(p_version_id);
  v_actual_manifest_sha256 := encode(
    extensions.digest(convert_to(v_manifest::text, 'UTF8'), 'sha256'),
    'hex'
  );
  if v_actual_manifest_sha256 is distinct from p_manifest_sha256 then
    raise exception 'source verification manifest checksum mismatch';
  end if;

  select
    count(*)::integer,
    count(*) filter (
      where coalesce(rights_review.excerpt_permission, provision.excerpt_permission) = 'UNKNOWN'
    )::integer
  into v_provision_count, v_unknown_permission_count
  from regulatory.provisions provision
  left join regulatory.provision_rights_reviews rights_review
    on rights_review.provision_id = provision.provision_id
  where provision.version_id = p_version_id;

  if p_outcome = 'APPROVED' and (
    v_version.storage_rights <> 'ALLOWED'
    or v_version.rights_reviewed_at is null
    or nullif(btrim(v_version.rights_basis), '') is null
    or v_provision_count = 0
    or v_unknown_permission_count > 0
  ) then
    raise exception 'source version is not ready for approval';
  end if;

  insert into regulatory.source_verification_records (
    verification_id,
    version_id,
    outcome,
    verification_method,
    reviewer_role,
    reviewer_ref,
    manifest_sha256,
    reviewed_at,
    private_notes
  ) values (
    p_verification_id,
    p_version_id,
    p_outcome,
    p_verification_method,
    btrim(p_reviewer_role),
    btrim(p_reviewer_ref),
    p_manifest_sha256,
    p_reviewed_at,
    nullif(btrim(p_private_notes), '')
  );

  if p_outcome = 'APPROVED' then
    update regulatory.source_versions
    set lifecycle_state = 'VERIFIED', verified_at = p_reviewed_at
    where version_id = p_version_id and lifecycle_state = 'OBSERVED';
  end if;

  return jsonb_build_object(
    'verificationId', p_verification_id,
    'versionId', p_version_id,
    'outcome', p_outcome,
    'manifestSha256', p_manifest_sha256,
    'lifecycleState', case when p_outcome = 'APPROVED' then 'VERIFIED' else 'OBSERVED' end,
    'reviewedAt', p_reviewed_at
  );
end;
$$;

revoke all on table regulatory.source_verification_records
from public, anon, authenticated;
grant select on table regulatory.source_verification_records
to service_role;

revoke all on function policy.build_official_source_verification_manifest(text)
from public, anon, authenticated;
grant execute on function policy.build_official_source_verification_manifest(text)
to service_role;

revoke all on function policy.get_official_source_verification_manifest(text)
from public, anon, authenticated;
grant execute on function policy.get_official_source_verification_manifest(text)
to service_role;

revoke all on function policy.review_official_source_version(
  text, text, text, text, text, text, text, timestamptz, text
) from public, anon, authenticated;
grant execute on function policy.review_official_source_version(
  text, text, text, text, text, text, text, timestamptz, text
) to service_role;

comment on table regulatory.source_verification_records is
  'Immutable private human-review audit records for official source versions.';
comment on function policy.get_official_source_verification_manifest is
  'Returns a service-only deterministic source verification manifest and SHA-256 fingerprint without provision text.';
comment on function policy.review_official_source_version is
  'Records a named human source review and promotes an approval-ready OBSERVED source version to VERIFIED atomically.';

commit;
