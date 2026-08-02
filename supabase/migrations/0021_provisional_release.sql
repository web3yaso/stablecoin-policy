-- Provisional corpus releases (spec section 8.4; specs/machineAssurance.qnt
-- PROVISIONAL_PUBLISHED terminal state).
--
-- Publishes AI_CROSS_CHECKED draft claims through an explicit atomic path in
-- tables physically separate from the reviewed release workflow (migration
-- 0012). Publication writes a deterministic PROVISIONAL_PUBLISHED assurance
-- record per claim and advances the machine-lane state, but never touches
-- claim review_state, reviewed releases, coverage, or any named-human gate.
-- policy.record_machine_assurance continues to reject PROVISIONAL_PUBLISHED;
-- this release RPC is the only writer of that level.

begin;

-- widen the machine ladder to its terminal state
alter table policy.machine_assurance_records
  drop constraint machine_assurance_records_level_check;
alter table policy.machine_assurance_records
  add constraint machine_assurance_records_level_check
  check (assurance_level in (
    'SOURCE_VALIDATED', 'AI_EXTRACTED', 'AI_CROSS_CHECKED', 'PROVISIONAL_PUBLISHED'
  ));

alter table policy.machine_assurance_records
  drop constraint machine_assurance_records_provenance_check;
alter table policy.machine_assurance_records
  add constraint machine_assurance_records_provenance_check
  check (
    (
      -- deterministic actions carry no model provenance
      assurance_level in ('SOURCE_VALIDATED', 'PROVISIONAL_PUBLISHED')
      and model is null
      and prompt_template_id is null
      and prompt_template_version is null
      and parameters_version is null
      and confidence is null
    ) or (
      assurance_level in ('AI_EXTRACTED', 'AI_CROSS_CHECKED')
      and nullif(btrim(model), '') is not null
      and nullif(btrim(prompt_template_id), '') is not null
      and nullif(btrim(prompt_template_version), '') is not null
      and nullif(btrim(parameters_version), '') is not null
      and confidence is not null
    )
  );

alter table policy.machine_assurance_records
  drop constraint machine_assurance_records_subject_check;
alter table policy.machine_assurance_records
  add constraint machine_assurance_records_subject_check
  check (
    (
      subject_type = 'SOURCE_VERSION'
      and assurance_level = 'SOURCE_VALIDATED'
      and claim_fingerprint is null
    ) or (
      subject_type = 'CLAIM_DRAFT'
      and assurance_level in ('AI_EXTRACTED', 'AI_CROSS_CHECKED', 'PROVISIONAL_PUBLISHED')
      and claim_fingerprint is not null
    )
  );

alter table policy.machine_assurance_states
  drop constraint machine_assurance_states_level_check;
alter table policy.machine_assurance_states
  add constraint machine_assurance_states_level_check
  check (assurance_level in (
    'SOURCE_VALIDATED', 'AI_EXTRACTED', 'AI_CROSS_CHECKED', 'PROVISIONAL_PUBLISHED'
  ));

create table policy.provisional_corpus_releases (
  release_id text primary key
    check (release_id ~ '^[a-z0-9][a-z0-9._:-]{2,160}$'),
  jurisdiction_code text not null
    check (jurisdiction_code ~ '^[A-Z][A-Z0-9-]{1,15}$'),
  as_of timestamptz not null,
  knowledge_cutoff timestamptz not null,
  manifest_sha256 text not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create trigger protect_provisional_release_trigger
before update or delete on policy.provisional_corpus_releases
for each row execute function regulatory.reject_immutable_row_change();

alter table policy.provisional_corpus_releases enable row level security;

create table policy.provisional_release_claims (
  release_id text not null
    references policy.provisional_corpus_releases(release_id),
  claim_id text not null references policy.legal_claims(claim_id),
  claim_fingerprint text not null
    check (claim_fingerprint ~ '^[0-9a-f]{64}$'),
  assurance_record_id text not null
    references policy.machine_assurance_records(record_id),
  primary key (release_id, claim_id)
);

create trigger protect_provisional_release_claim_trigger
before update or delete on policy.provisional_release_claims
for each row execute function regulatory.reject_immutable_row_change();

alter table policy.provisional_release_claims enable row level security;

create function policy.publish_provisional_release(
  p_release_id text,
  p_jurisdiction_code text,
  p_as_of timestamptz,
  p_knowledge_cutoff timestamptz,
  p_claim_ids text[]
)
returns jsonb
language plpgsql
security definer
set search_path = policy, regulatory, public, extensions
as $$
declare
  v_claim_id text;
  v_claim policy.legal_claims%rowtype;
  v_state policy.machine_assurance_states%rowtype;
  v_record policy.machine_assurance_records%rowtype;
  v_members jsonb := '[]'::jsonb;
  v_manifest jsonb;
  v_manifest_sha256 text;
  v_published_at timestamptz := now();
begin
  if p_release_id !~ '^[a-z0-9][a-z0-9._:-]{2,160}$' then
    raise exception 'invalid provisional release identifier';
  end if;
  if p_jurisdiction_code !~ '^[A-Z][A-Z0-9-]{1,15}$' then
    raise exception 'invalid provisional release jurisdiction';
  end if;
  if p_as_of is null or p_knowledge_cutoff is null then
    raise exception 'provisional release requires as_of and knowledge_cutoff';
  end if;
  if p_claim_ids is null or cardinality(p_claim_ids) = 0 then
    raise exception 'provisional release membership is empty';
  end if;
  if (select count(distinct claim_id) from unnest(p_claim_ids) as claim_id)
     <> cardinality(p_claim_ids) then
    raise exception 'provisional release membership contains duplicates';
  end if;

  foreach v_claim_id in array p_claim_ids loop
    select * into v_claim
    from policy.legal_claims
    where claim_id = v_claim_id
    for update;
    if not found then
      raise exception 'provisional release claim % does not exist', v_claim_id;
    end if;
    if v_claim.review_state <> 'DRAFT' then
      raise exception 'provisional release claims must remain private DRAFT rows';
    end if;
    if v_claim.jurisdiction_code <> p_jurisdiction_code then
      raise exception 'provisional release claim % is outside the release jurisdiction', v_claim_id;
    end if;

    select * into v_state
    from policy.machine_assurance_states
    where subject_type = 'CLAIM_DRAFT' and subject_id = v_claim_id
    for update;
    if not found or v_state.assurance_level <> 'AI_CROSS_CHECKED' then
      raise exception 'provisional release claim % is not AI_CROSS_CHECKED', v_claim_id;
    end if;

    select * into v_record
    from policy.machine_assurance_records
    where record_id = v_state.advanced_by_record_id;
    if not found
       or v_record.outcome <> 'ADVANCED'
       or cardinality(v_record.blockers) <> 0 then
      raise exception 'provisional release claim % lacks a clean cross-check record', v_claim_id;
    end if;

    v_members := v_members || jsonb_build_array(jsonb_build_object(
      'claimId', v_claim_id,
      'claimFingerprint', v_record.claim_fingerprint,
      'assuranceRecordId', v_record.record_id
    ));
  end loop;

  v_manifest := jsonb_build_object(
    'schemaVersion', '1.0.0',
    'releaseId', p_release_id,
    'jurisdictionCode', p_jurisdiction_code,
    'asOf', p_as_of,
    'knowledgeCutoff', p_knowledge_cutoff,
    'claims', (
      select coalesce(jsonb_agg(member order by member->>'claimId'), '[]'::jsonb)
      from jsonb_array_elements(v_members) as member
    )
  );
  v_manifest_sha256 := encode(
    extensions.digest(convert_to(v_manifest::text, 'UTF8'), 'sha256'),
    'hex'
  );

  insert into policy.provisional_corpus_releases (
    release_id, jurisdiction_code, as_of, knowledge_cutoff,
    manifest_sha256, published_at
  ) values (
    p_release_id, p_jurisdiction_code, p_as_of, p_knowledge_cutoff,
    v_manifest_sha256, v_published_at
  );

  foreach v_claim_id in array p_claim_ids loop
    select record.* into v_record
    from policy.machine_assurance_states state
    join policy.machine_assurance_records record
      on record.record_id = state.advanced_by_record_id
    where state.subject_type = 'CLAIM_DRAFT' and state.subject_id = v_claim_id;

    insert into policy.provisional_release_claims (
      release_id, claim_id, claim_fingerprint, assurance_record_id
    ) values (
      p_release_id, v_claim_id, v_record.claim_fingerprint, v_record.record_id
    );

    -- deterministic publication audit record; the only writer of this level
    insert into policy.machine_assurance_records (
      record_id, subject_type, subject_id, assurance_level,
      source_version_fingerprint, claim_fingerprint,
      checks, input_checksum_sha256, output_checksum_sha256,
      blockers, limitations, outcome
    ) values (
      p_release_id || ':' || v_claim_id || ':published',
      'CLAIM_DRAFT', v_claim_id, 'PROVISIONAL_PUBLISHED',
      v_record.source_version_fingerprint, v_record.claim_fingerprint,
      v_record.checks, v_record.input_checksum_sha256, v_manifest_sha256,
      '{}'::text[],
      array['Provisional machine-published evidence; not human-reviewed legal advice.'],
      'ADVANCED'
    );

    update policy.machine_assurance_states
    set assurance_level = 'PROVISIONAL_PUBLISHED',
        advanced_by_record_id = p_release_id || ':' || v_claim_id || ':published',
        updated_at = now()
    where subject_type = 'CLAIM_DRAFT' and subject_id = v_claim_id;
  end loop;

  return jsonb_build_object(
    'releaseId', p_release_id,
    'jurisdictionCode', p_jurisdiction_code,
    'manifestSha256', v_manifest_sha256,
    'claimCount', cardinality(p_claim_ids),
    'publishedAt', v_published_at
  );
end;
$$;

create function policy.get_provisional_release(p_release_id text)
returns jsonb
language sql
stable
set search_path = policy, regulatory, public
as $$
  select jsonb_build_object(
    'releaseId', release.release_id,
    'jurisdictionCode', release.jurisdiction_code,
    'asOf', release.as_of,
    'knowledgeCutoff', release.knowledge_cutoff,
    'manifestSha256', release.manifest_sha256,
    'publishedAt', release.published_at,
    'claims', coalesce((
      select jsonb_agg(jsonb_build_object(
        'claimId', member.claim_id,
        'claimFingerprint', member.claim_fingerprint,
        'assuranceRecordId', member.assurance_record_id
      ) order by member.claim_id)
      from policy.provisional_release_claims member
      where member.release_id = release.release_id
    ), '[]'::jsonb)
  )
  from policy.provisional_corpus_releases release
  where release.release_id = p_release_id;
$$;

create function policy.get_provisions_for_extraction(p_version_id text)
returns jsonb
language sql
stable
set search_path = policy, regulatory, public
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'provisionId', provision.provision_id,
      'locator', provision.locator,
      'ordinal', provision.ordinal,
      'text', provision.provision_text
    ) order by provision.ordinal, provision.provision_id
  ), '[]'::jsonb)
  from regulatory.provisions provision
  join regulatory.source_versions version
    on version.version_id = provision.version_id
  where provision.version_id = p_version_id
    and version.storage_rights = 'ALLOWED';
$$;

revoke all on function policy.get_provisions_for_extraction(text)
from public, anon, authenticated;
grant execute on function policy.get_provisions_for_extraction(text)
to service_role;

comment on function policy.get_provisions_for_extraction is
  'Service-only provision text feed for the machine extraction pipeline; empty unless the source version passed the commercial storage-rights gate.';

revoke all on table policy.provisional_corpus_releases
from public, anon, authenticated, service_role;
grant select on table policy.provisional_corpus_releases to service_role;

revoke all on table policy.provisional_release_claims
from public, anon, authenticated, service_role;
grant select on table policy.provisional_release_claims to service_role;

revoke all on function policy.publish_provisional_release(
  text, text, timestamptz, timestamptz, text[]
) from public, anon, authenticated;
grant execute on function policy.publish_provisional_release(
  text, text, timestamptz, timestamptz, text[]
) to service_role;

revoke all on function policy.get_provisional_release(text)
from public, anon, authenticated;
grant execute on function policy.get_provisional_release(text)
to service_role;

comment on table policy.provisional_corpus_releases is
  'Immutable provisional (machine-assured) corpus releases; physically separate from reviewed releases and invisible to reviewed-only workflows.';
comment on function policy.publish_provisional_release is
  'Atomically publishes AI_CROSS_CHECKED DRAFT claims as a provisional release: verifies clean cross-check records, binds a deterministic manifest, writes PROVISIONAL_PUBLISHED audit records, and never touches claim review_state or reviewed releases.';

commit;
