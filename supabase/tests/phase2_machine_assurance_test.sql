begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, policy, regulatory;

select plan(17);

-- ---------------------------------------------------------------------------
-- sanitized fixture: one source version with a provision and one DRAFT claim
-- ---------------------------------------------------------------------------

create temporary table machine_test_state (
  source_fingerprint text
) on commit drop;

insert into policy.storage_objects (
  object_id, provider, bucket, object_key, checksum_sha256, byte_size,
  content_type, encryption_state
) values (
  'object:machine-test:1', 'supabase', 'policy-sources',
  'tests/machine/source.bin', repeat('1', 64), 128,
  'application/octet-stream', 'PROVIDER_ENCRYPTED'
);

insert into regulatory.source_authorities (
  authority_id, name, jurisdiction_code, authority_type, official_domains
) values (
  'authority:machine-test', 'Machine Test Authority', 'EEA',
  'OFFICIAL_REGISTER', array['official.machine.test']
);

insert into regulatory.source_documents (
  document_id, authority_id, official_document_id, document_type, title,
  canonical_url, language_codes, redistribution_rights, licence_identifier
) values (
  'document:machine-test', 'authority:machine-test', 'MACHINE-TEST-1',
  'REGULATION', 'Sanitized Machine Test Instrument',
  'https://official.machine.test/instrument', array['en'], 'FULL_TEXT',
  'TEST-LICENCE'
);

insert into regulatory.source_versions (
  version_id, document_id, version_label, raw_object_id, checksum_sha256,
  official_url, published_at, effective_from, observed_at, retrieved_at,
  lifecycle_state, storage_rights, rights_reviewed_at, rights_basis
) values (
  'version:machine-test:1', 'document:machine-test', 'test-v1',
  'object:machine-test:1', repeat('2', 64),
  'https://official.machine.test/instrument/v1', now() - interval '10 days',
  now() - interval '9 days', now() - interval '1 day',
  now() - interval '1 day', 'OBSERVED', 'ALLOWED',
  now() - interval '2 days', 'Sanitized test rights basis'
);

insert into regulatory.provisions (
  provision_id, version_id, locator, heading, language_code, provision_text,
  text_checksum_sha256, ordinal, excerpt_permission
) values (
  'provision:machine-test:1', 'version:machine-test:1', 'Article 1',
  'Sanitized test provision', 'en', 'Sanitized non-legal fixture text.',
  repeat('3', 64), 1, 'ALLOWED'
);

insert into policy.legal_claims (
  claim_id, jurisdiction_code, topic, proposition, legal_status,
  review_state, effective_from, knowledge_cutoff
) values (
  'claim:machine-test:1', 'EEA', 'sanitized-topic',
  'Sanitized non-legal fixture proposition.', 'UNDETERMINED',
  'DRAFT', now() - interval '9 days', now() - interval '1 day'
);

insert into policy.citations (
  citation_id, claim_id, provision_id, support_relation, exact_locator
) values (
  'citation:machine-test:1', 'claim:machine-test:1',
  'provision:machine-test:1', 'DIRECT_SUPPORT', 'Article 1'
);

insert into machine_test_state (source_fingerprint)
select encode(
  extensions.digest(
    convert_to(
      policy.build_official_source_verification_manifest('version:machine-test:1')::text,
      'UTF8'
    ),
    'sha256'
  ),
  'hex'
);

grant select on machine_test_state to service_role;
set local role service_role;

-- ---------------------------------------------------------------------------
-- permission boundaries: no direct writes for the service role
-- ---------------------------------------------------------------------------

select throws_ok(
  $sql$
    insert into policy.machine_assurance_records (
      record_id, subject_type, subject_id, assurance_level,
      source_version_fingerprint, checks,
      input_checksum_sha256, output_checksum_sha256, outcome
    ) values (
      'assurance:direct', 'SOURCE_VERSION', 'version:machine-test:1',
      'SOURCE_VALIDATED', repeat('4', 64),
      '{"contradiction":"PASS","freshness":"PASS","rights":"PASS","jurisdiction":"PASS","effectiveDates":"PASS","citationLocator":"PASS"}'::jsonb,
      repeat('5', 64), repeat('6', 64), 'ADVANCED'
    )
  $sql$,
  '42501',
  'permission denied for table machine_assurance_records',
  'service role cannot insert machine assurance records directly'
);

select throws_ok(
  $sql$
    insert into policy.machine_assurance_states (
      subject_type, subject_id, assurance_level, advanced_by_record_id
    ) values (
      'SOURCE_VERSION', 'version:machine-test:1', 'SOURCE_VALIDATED', 'assurance:x'
    )
  $sql$,
  '42501',
  'permission denied for table machine_assurance_states',
  'service role cannot write machine assurance states directly'
);

-- ---------------------------------------------------------------------------
-- fail-closed preconditions
-- ---------------------------------------------------------------------------

select throws_ok(
  $sql$
    select policy.record_machine_assurance(
      'assurance:stale', 'SOURCE_VERSION', 'version:machine-test:1',
      'SOURCE_VALIDATED', repeat('9', 64), null,
      null, null, null, null, null,
      '{"contradiction":"NOT_EVALUATED","freshness":"PASS","rights":"PASS","jurisdiction":"NOT_EVALUATED","effectiveDates":"NOT_EVALUATED","citationLocator":"PASS"}'::jsonb,
      repeat('5', 64), repeat('6', 64), '{}'::text[], '{}'::text[]
    )
  $sql$,
  'P0001',
  'machine assurance source fingerprint is stale',
  'stale source fingerprint fails closed'
);

select throws_ok(
  $sql$
    select policy.record_machine_assurance(
      'assurance:early-extract', 'CLAIM_DRAFT', 'claim:machine-test:1',
      'AI_EXTRACTED',
      (select source_fingerprint from machine_test_state where source_fingerprint is not null),
      repeat('7', 64),
      'test-model', 'claim-extraction', '1.0.0', '1.0.0', 0.9,
      '{"contradiction":"PASS","freshness":"PASS","rights":"PASS","jurisdiction":"PASS","effectiveDates":"PASS","citationLocator":"PASS"}'::jsonb,
      repeat('5', 64), repeat('6', 64), '{}'::text[], '{}'::text[]
    )
  $sql$,
  'P0001',
  'claim extraction requires a SOURCE_VALIDATED source version',
  'extraction before source validation fails closed'
);

select throws_ok(
  $sql$
    select policy.record_machine_assurance(
      'assurance:published', 'CLAIM_DRAFT', 'claim:machine-test:1',
      'PROVISIONAL_PUBLISHED',
      (select source_fingerprint from machine_test_state where source_fingerprint is not null),
      repeat('7', 64),
      'test-model', 'claim-extraction', '1.0.0', '1.0.0', 0.9,
      '{"contradiction":"PASS","freshness":"PASS","rights":"PASS","jurisdiction":"PASS","effectiveDates":"PASS","citationLocator":"PASS"}'::jsonb,
      repeat('5', 64), repeat('6', 64), '{}'::text[], '{}'::text[]
    )
  $sql$,
  'P0001',
  'PROVISIONAL_PUBLISHED is reserved for the provisional release path',
  'direct provisional publication level is rejected'
);

-- ---------------------------------------------------------------------------
-- ladder: validate source, then extract, then cross-check
-- ---------------------------------------------------------------------------

select lives_ok(
  $sql$
    select policy.record_machine_assurance(
      'assurance:validate', 'SOURCE_VERSION', 'version:machine-test:1',
      'SOURCE_VALIDATED',
      (select source_fingerprint from machine_test_state where source_fingerprint is not null),
      null, null, null, null, null, null,
      '{"contradiction":"NOT_EVALUATED","freshness":"PASS","rights":"PASS","jurisdiction":"NOT_EVALUATED","effectiveDates":"NOT_EVALUATED","citationLocator":"PASS"}'::jsonb,
      repeat('5', 64), repeat('6', 64), '{}'::text[], '{}'::text[]
    )
  $sql$,
  'deterministic source validation record is accepted'
);

-- NOT_EVALUATED checks mean the record is stored but cannot advance the level
select is(
  (select assurance_level from policy.machine_assurance_states
   where subject_type = 'SOURCE_VERSION' and subject_id = 'version:machine-test:1'),
  null,
  'partially evaluated checks store a BLOCKED record without advancing'
);

select lives_ok(
  $sql$
    select policy.record_machine_assurance(
      'assurance:validate-full', 'SOURCE_VERSION', 'version:machine-test:1',
      'SOURCE_VALIDATED',
      (select source_fingerprint from machine_test_state where source_fingerprint is not null),
      null, null, null, null, null, null,
      '{"contradiction":"PASS","freshness":"PASS","rights":"PASS","jurisdiction":"PASS","effectiveDates":"PASS","citationLocator":"PASS"}'::jsonb,
      repeat('5', 64), repeat('6', 64), '{}'::text[], '{}'::text[]
    )
  $sql$,
  'fully passing source validation is accepted'
);

select is(
  (select assurance_level from policy.machine_assurance_states
   where subject_type = 'SOURCE_VERSION' and subject_id = 'version:machine-test:1'),
  'SOURCE_VALIDATED',
  'all-pass validation advances the source to SOURCE_VALIDATED'
);

select lives_ok(
  $sql$
    select policy.record_machine_assurance(
      'assurance:extract-blocked', 'CLAIM_DRAFT', 'claim:machine-test:1',
      'AI_EXTRACTED',
      (select source_fingerprint from machine_test_state where source_fingerprint is not null),
      repeat('7', 64),
      'test-model', 'claim-extraction', '1.0.0', '1.0.0', 0.4,
      '{"contradiction":"FAIL","freshness":"PASS","rights":"PASS","jurisdiction":"PASS","effectiveDates":"PASS","citationLocator":"PASS"}'::jsonb,
      repeat('5', 64), repeat('6', 64),
      array['CROSS_MODEL_CONTRADICTION'], array['Sanitized limitation']::text[]
    )
  $sql$,
  'a failing extraction check is recorded'
);

select is(
  (select outcome from policy.machine_assurance_records
   where record_id = 'assurance:extract-blocked'),
  'BLOCKED',
  'failed contradiction check produces a BLOCKED record'
);

select is(
  (select assurance_level from policy.machine_assurance_states
   where subject_type = 'CLAIM_DRAFT' and subject_id = 'claim:machine-test:1'),
  null,
  'a BLOCKED record does not advance the claim level'
);

select throws_ok(
  $sql$
    select policy.record_machine_assurance(
      'assurance:crosscheck-early', 'CLAIM_DRAFT', 'claim:machine-test:1',
      'AI_CROSS_CHECKED',
      (select source_fingerprint from machine_test_state where source_fingerprint is not null),
      repeat('7', 64),
      'other-model', 'claim-crosscheck', '1.0.0', '1.0.0', 0.9,
      '{"contradiction":"PASS","freshness":"PASS","rights":"PASS","jurisdiction":"PASS","effectiveDates":"PASS","citationLocator":"PASS"}'::jsonb,
      repeat('5', 64), repeat('6', 64), '{}'::text[], '{}'::text[]
    )
  $sql$,
  'P0001',
  'cross-check requires an AI_EXTRACTED claim',
  'cross-check before successful extraction fails closed'
);

select lives_ok(
  $sql$
    select policy.record_machine_assurance(
      'assurance:extract', 'CLAIM_DRAFT', 'claim:machine-test:1',
      'AI_EXTRACTED',
      (select source_fingerprint from machine_test_state where source_fingerprint is not null),
      repeat('7', 64),
      'test-model', 'claim-extraction', '1.0.0', '1.0.0', 0.9,
      '{"contradiction":"PASS","freshness":"PASS","rights":"PASS","jurisdiction":"PASS","effectiveDates":"PASS","citationLocator":"PASS"}'::jsonb,
      repeat('5', 64), repeat('6', 64), '{}'::text[], '{}'::text[]
    )
  $sql$,
  'clean extraction advances the claim'
);

select lives_ok(
  $sql$
    select policy.record_machine_assurance(
      'assurance:crosscheck', 'CLAIM_DRAFT', 'claim:machine-test:1',
      'AI_CROSS_CHECKED',
      (select source_fingerprint from machine_test_state where source_fingerprint is not null),
      repeat('7', 64),
      'other-model', 'claim-crosscheck', '1.0.0', '1.0.0', 0.9,
      '{"contradiction":"PASS","freshness":"PASS","rights":"PASS","jurisdiction":"PASS","effectiveDates":"PASS","citationLocator":"PASS"}'::jsonb,
      repeat('5', 64), repeat('6', 64), '{}'::text[], '{}'::text[]
    )
  $sql$,
  'independent cross-check advances the claim to AI_CROSS_CHECKED'
);

select is(
  (select assurance_level from policy.machine_assurance_states
   where subject_type = 'CLAIM_DRAFT' and subject_id = 'claim:machine-test:1'),
  'AI_CROSS_CHECKED',
  'ladder ends at AI_CROSS_CHECKED in this migration'
);

-- ---------------------------------------------------------------------------
-- lane separation: the machine RPC never touched the human-lane fields
-- ---------------------------------------------------------------------------

select is(
  (select lifecycle_state || ':' || coalesce(verified_at::text, 'null')
   from regulatory.source_versions where version_id = 'version:machine-test:1'),
  'OBSERVED:null',
  'machine records never change lifecycle_state or verified_at'
);

select * from finish();

rollback;
