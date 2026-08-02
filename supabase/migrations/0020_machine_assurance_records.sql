-- Machine-assurance lane foundation (spec section 8.4; specs/machineAssurance.qnt).
--
-- Adds immutable MachineAssuranceRecord audit rows and a machine-lane state
-- table that live strictly beside the named-human review lane: no reviewer
-- identity exists in this lane, the RPC cannot write lifecycle/review fields,
-- and PROVISIONAL_PUBLISHED is reserved for the provisional-release path in a
-- later migration. Deliberate design: machine level is stored in
-- policy.machine_assurance_states rather than as a column on
-- policy.legal_claims or regulatory.source_versions, so no existing
-- human-lane table, trigger, or freeze rule is altered.

begin;

create extension if not exists pgcrypto with schema extensions;

create function policy.machine_assurance_checks_valid(p_checks jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(p_checks) = 'object'
    and (
      select count(*) = 6
      from jsonb_object_keys(p_checks) as key
    )
    and p_checks ?& array[
      'contradiction', 'freshness', 'rights',
      'jurisdiction', 'effectiveDates', 'citationLocator'
    ]
    and (
      select bool_and(value in ('"PASS"', '"FAIL"', '"NOT_EVALUATED"'))
      from (
        select value::text as value
        from jsonb_each(p_checks)
      ) as check_values
    );
$$;

create table policy.machine_assurance_records (
  record_id text primary key
    check (record_id ~ '^[a-z0-9][a-z0-9._:-]{2,160}$'),
  subject_type text not null
    check (subject_type in ('SOURCE_VERSION', 'CLAIM_DRAFT')),
  subject_id text not null
    check (subject_id ~ '^[a-z0-9][a-z0-9._:-]{2,160}$'),
  assurance_level text not null
    check (assurance_level in ('SOURCE_VALIDATED', 'AI_EXTRACTED', 'AI_CROSS_CHECKED')),
  source_version_fingerprint text not null
    check (source_version_fingerprint ~ '^[0-9a-f]{64}$'),
  claim_fingerprint text
    check (claim_fingerprint is null or claim_fingerprint ~ '^[0-9a-f]{64}$'),
  model text check (model is null or nullif(btrim(model), '') is not null),
  prompt_template_id text,
  prompt_template_version text,
  parameters_version text,
  confidence numeric(5, 4)
    check (confidence is null or (confidence >= 0 and confidence <= 1)),
  checks jsonb not null check (policy.machine_assurance_checks_valid(checks)),
  input_checksum_sha256 text not null
    check (input_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  output_checksum_sha256 text not null
    check (output_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  blockers text[] not null default '{}'::text[],
  limitations text[] not null default '{}'::text[],
  outcome text not null check (outcome in ('ADVANCED', 'BLOCKED')),
  created_at timestamptz not null default now(),
  -- deterministic levels carry no model provenance; AI levels require it all
  check (
    (
      assurance_level = 'SOURCE_VALIDATED'
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
  ),
  -- subject type, level, and claim fingerprint agree
  check (
    (
      subject_type = 'SOURCE_VERSION'
      and assurance_level = 'SOURCE_VALIDATED'
      and claim_fingerprint is null
    ) or (
      subject_type = 'CLAIM_DRAFT'
      and assurance_level in ('AI_EXTRACTED', 'AI_CROSS_CHECKED')
      and claim_fingerprint is not null
    )
  )
);

create index machine_assurance_records_subject_idx
  on policy.machine_assurance_records (subject_type, subject_id, created_at);

create trigger protect_machine_assurance_record_trigger
before update or delete on policy.machine_assurance_records
for each row execute function regulatory.reject_immutable_row_change();

alter table policy.machine_assurance_records enable row level security;

create table policy.machine_assurance_states (
  subject_type text not null
    check (subject_type in ('SOURCE_VERSION', 'CLAIM_DRAFT')),
  subject_id text not null
    check (subject_id ~ '^[a-z0-9][a-z0-9._:-]{2,160}$'),
  assurance_level text not null
    check (assurance_level in ('SOURCE_VALIDATED', 'AI_EXTRACTED', 'AI_CROSS_CHECKED')),
  advanced_by_record_id text not null
    references policy.machine_assurance_records(record_id),
  updated_at timestamptz not null default now(),
  primary key (subject_type, subject_id)
);

alter table policy.machine_assurance_states enable row level security;

create function policy.record_machine_assurance(
  p_record_id text,
  p_subject_type text,
  p_subject_id text,
  p_assurance_level text,
  p_source_version_fingerprint text,
  p_claim_fingerprint text,
  p_model text,
  p_prompt_template_id text,
  p_prompt_template_version text,
  p_parameters_version text,
  p_confidence numeric,
  p_checks jsonb,
  p_input_checksum_sha256 text,
  p_output_checksum_sha256 text,
  p_blockers text[],
  p_limitations text[]
)
returns jsonb
language plpgsql
security definer
set search_path = policy, regulatory, public, extensions
as $$
declare
  v_version_id text;
  v_version regulatory.source_versions%rowtype;
  v_claim policy.legal_claims%rowtype;
  v_manifest jsonb;
  v_actual_fingerprint text;
  v_prior_level text;
  v_all_checks_pass boolean;
  v_outcome text;
begin
  if p_assurance_level = 'PROVISIONAL_PUBLISHED' then
    raise exception 'PROVISIONAL_PUBLISHED is reserved for the provisional release path';
  end if;
  if p_assurance_level not in ('SOURCE_VALIDATED', 'AI_EXTRACTED', 'AI_CROSS_CHECKED') then
    raise exception 'invalid machine assurance level';
  end if;
  if p_subject_type not in ('SOURCE_VERSION', 'CLAIM_DRAFT') then
    raise exception 'invalid machine assurance subject type';
  end if;
  if p_record_id !~ '^[a-z0-9][a-z0-9._:-]{2,160}$'
     or p_subject_id !~ '^[a-z0-9][a-z0-9._:-]{2,160}$' then
    raise exception 'invalid machine assurance identifier';
  end if;
  if not policy.machine_assurance_checks_valid(p_checks) then
    raise exception 'invalid machine assurance checks shape';
  end if;
  if p_blockers is null or p_limitations is null then
    raise exception 'machine assurance blockers and limitations must be arrays';
  end if;

  -- resolve the governing source version and verify the fingerprint is current
  if p_subject_type = 'SOURCE_VERSION' then
    if p_assurance_level <> 'SOURCE_VALIDATED' then
      raise exception 'source versions only take SOURCE_VALIDATED machine records';
    end if;
    v_version_id := p_subject_id;
  else
    if p_assurance_level = 'SOURCE_VALIDATED' then
      raise exception 'claims cannot take SOURCE_VALIDATED machine records';
    end if;
    select * into v_claim
    from policy.legal_claims
    where claim_id = p_subject_id
    for update;
    if not found then
      raise exception 'machine assurance claim does not exist';
    end if;
    if v_claim.review_state <> 'DRAFT' then
      raise exception 'machine assurance records require a private DRAFT claim';
    end if;

    select min(provision.version_id)
    into v_version_id
    from policy.citations citation
    join regulatory.provisions provision
      on provision.provision_id = citation.provision_id
    where citation.claim_id = p_subject_id;
    if v_version_id is null then
      raise exception 'machine assurance claim has no citations';
    end if;
    if (
      select count(distinct provision.version_id)
      from policy.citations citation
      join regulatory.provisions provision
        on provision.provision_id = citation.provision_id
      where citation.claim_id = p_subject_id
    ) <> 1 then
      raise exception 'machine assurance claim must cite exactly one source version';
    end if;
  end if;

  select * into v_version
  from regulatory.source_versions
  where version_id = v_version_id
  for update;
  if not found then
    raise exception 'machine assurance source version does not exist';
  end if;

  v_manifest := policy.build_official_source_verification_manifest(v_version_id);
  v_actual_fingerprint := encode(
    extensions.digest(convert_to(v_manifest::text, 'UTF8'), 'sha256'),
    'hex'
  );
  if v_actual_fingerprint is distinct from p_source_version_fingerprint then
    raise exception 'machine assurance source fingerprint is stale';
  end if;

  -- ladder position checks against the machine-lane state table
  select assurance_level into v_prior_level
  from policy.machine_assurance_states
  where subject_type = p_subject_type and subject_id = p_subject_id
  for update;

  if p_assurance_level = 'AI_EXTRACTED' then
    if not exists (
      select 1 from policy.machine_assurance_states
      where subject_type = 'SOURCE_VERSION'
        and subject_id = v_version_id
        and assurance_level = 'SOURCE_VALIDATED'
    ) then
      raise exception 'claim extraction requires a SOURCE_VALIDATED source version';
    end if;
  elsif p_assurance_level = 'AI_CROSS_CHECKED' then
    if v_prior_level is null
       or v_prior_level not in ('AI_EXTRACTED', 'AI_CROSS_CHECKED') then
      raise exception 'cross-check requires an AI_EXTRACTED claim';
    end if;
  end if;

  v_all_checks_pass := (
    select bool_and(value = '"PASS"')
    from (
      select value::text as value from jsonb_each(p_checks)
    ) as check_values
  );
  v_outcome := case
    when v_all_checks_pass and cardinality(p_blockers) = 0 then 'ADVANCED'
    else 'BLOCKED'
  end;

  insert into policy.machine_assurance_records (
    record_id, subject_type, subject_id, assurance_level,
    source_version_fingerprint, claim_fingerprint,
    model, prompt_template_id, prompt_template_version, parameters_version,
    confidence, checks, input_checksum_sha256, output_checksum_sha256,
    blockers, limitations, outcome
  ) values (
    p_record_id, p_subject_type, p_subject_id, p_assurance_level,
    p_source_version_fingerprint, p_claim_fingerprint,
    nullif(btrim(p_model), ''), nullif(btrim(p_prompt_template_id), ''),
    nullif(btrim(p_prompt_template_version), ''), nullif(btrim(p_parameters_version), ''),
    p_confidence, p_checks, p_input_checksum_sha256, p_output_checksum_sha256,
    p_blockers, p_limitations, v_outcome
  );

  if v_outcome = 'ADVANCED' then
    insert into policy.machine_assurance_states (
      subject_type, subject_id, assurance_level, advanced_by_record_id
    ) values (
      p_subject_type, p_subject_id, p_assurance_level, p_record_id
    )
    on conflict (subject_type, subject_id) do update
    set assurance_level = excluded.assurance_level,
        advanced_by_record_id = excluded.advanced_by_record_id,
        updated_at = now();
  end if;

  return jsonb_build_object(
    'recordId', p_record_id,
    'subjectType', p_subject_type,
    'subjectId', p_subject_id,
    'assuranceLevel', p_assurance_level,
    'outcome', v_outcome,
    'createdAt', now()
  );
end;
$$;

create function policy.get_machine_assurance_chain(
  p_subject_type text,
  p_subject_id text
)
returns jsonb
language sql
stable
set search_path = policy, regulatory, public
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'recordId', record.record_id,
      'subjectType', record.subject_type,
      'subjectId', record.subject_id,
      'assuranceLevel', record.assurance_level,
      'outcome', record.outcome,
      'checks', record.checks,
      'blockers', to_jsonb(record.blockers),
      'limitations', to_jsonb(record.limitations),
      'createdAt', record.created_at
    ) order by record.created_at, record.record_id
  ), '[]'::jsonb)
  from policy.machine_assurance_records record
  where record.subject_type = p_subject_type
    and record.subject_id = p_subject_id;
$$;

revoke all on table policy.machine_assurance_records
from public, anon, authenticated, service_role;
grant select on table policy.machine_assurance_records to service_role;

revoke all on table policy.machine_assurance_states
from public, anon, authenticated, service_role;
grant select on table policy.machine_assurance_states to service_role;

revoke all on function policy.machine_assurance_checks_valid(jsonb)
from public, anon, authenticated;
grant execute on function policy.machine_assurance_checks_valid(jsonb)
to service_role;

revoke all on function policy.record_machine_assurance(
  text, text, text, text, text, text, text, text, text, text,
  numeric, jsonb, text, text, text[], text[]
) from public, anon, authenticated;
grant execute on function policy.record_machine_assurance(
  text, text, text, text, text, text, text, text, text, text,
  numeric, jsonb, text, text, text[], text[]
) to service_role;

revoke all on function policy.get_machine_assurance_chain(text, text)
from public, anon, authenticated;
grant execute on function policy.get_machine_assurance_chain(text, text)
to service_role;

comment on table policy.machine_assurance_records is
  'Immutable machine-lane audit records: model/prompt provenance, deterministic check results, checksums, blockers. Carries no reviewer identity and can never satisfy a human-review gate.';
comment on table policy.machine_assurance_states is
  'Current machine-assurance level per subject, advanced only by policy.record_machine_assurance when every check passes with zero blockers.';
comment on function policy.record_machine_assurance is
  'Atomically records a machine-assurance check run and advances the subject machine level only when all checks pass with no blockers. Fails closed on stale fingerprints, wrong ladder positions, and non-DRAFT claims; never touches human review or lifecycle fields.';

commit;
