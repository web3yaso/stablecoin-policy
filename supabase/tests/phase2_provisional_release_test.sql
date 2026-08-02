begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, policy, regulatory;

select plan(19);

-- ---------------------------------------------------------------------------
-- sanitized fixture: validated source, two DRAFT claims, one at
-- AI_CROSS_CHECKED (via the real RPC ladder) and one left unchecked; plus one
-- non-DRAFT claim to prove the release path rejects it
-- ---------------------------------------------------------------------------

create temporary table prov_test_state (
  source_fingerprint text
) on commit drop;

insert into policy.storage_objects (
  object_id, provider, bucket, object_key, checksum_sha256, byte_size,
  content_type, encryption_state
) values (
  'object:prov-test:1', 'supabase', 'policy-sources',
  'tests/prov/source.bin', repeat('1', 64), 128,
  'application/octet-stream', 'PROVIDER_ENCRYPTED'
);

insert into regulatory.source_authorities (
  authority_id, name, jurisdiction_code, authority_type, official_domains
) values (
  'authority:prov-test', 'Prov Test Authority', 'EEA',
  'OFFICIAL_REGISTER', array['official.prov.test']
);

insert into regulatory.source_documents (
  document_id, authority_id, official_document_id, document_type, title,
  canonical_url, language_codes, redistribution_rights, licence_identifier
) values (
  'document:prov-test', 'authority:prov-test', 'PROV-TEST-1',
  'REGULATION', 'Sanitized Prov Test Instrument',
  'https://official.prov.test/instrument', array['en'], 'FULL_TEXT',
  'TEST-LICENCE'
);

insert into regulatory.source_versions (
  version_id, document_id, version_label, raw_object_id, checksum_sha256,
  official_url, published_at, effective_from, observed_at, retrieved_at,
  lifecycle_state, storage_rights, rights_reviewed_at, rights_basis
) values (
  'version:prov-test:1', 'document:prov-test', 'test-v1',
  'object:prov-test:1', repeat('2', 64),
  'https://official.prov.test/instrument/v1', now() - interval '10 days',
  now() - interval '9 days', now() - interval '1 day',
  now() - interval '1 day', 'OBSERVED', 'ALLOWED',
  now() - interval '2 days', 'Sanitized test rights basis'
);

insert into regulatory.provisions (
  provision_id, version_id, locator, heading, language_code, provision_text,
  text_checksum_sha256, ordinal, excerpt_permission
) values (
  'provision:prov-test:1', 'version:prov-test:1', 'Article 1',
  'Sanitized test provision', 'en', 'Sanitized non-legal fixture text.',
  repeat('3', 64), 1, 'ALLOWED'
);

insert into policy.legal_claims (
  claim_id, jurisdiction_code, topic, proposition, legal_status,
  review_state, effective_from, knowledge_cutoff
) values
  ('claim:prov-test:1', 'EEA', 'sanitized-topic',
   'Sanitized fixture proposition one.', 'UNDETERMINED',
   'DRAFT', now() - interval '9 days', now() - interval '1 day'),
  ('claim:prov-test:2', 'EEA', 'sanitized-topic',
   'Sanitized fixture proposition two.', 'UNDETERMINED',
   'DRAFT', now() - interval '9 days', now() - interval '1 day'),
  ('claim:prov-test:inreview', 'EEA', 'sanitized-topic',
   'Sanitized fixture proposition three.', 'UNDETERMINED',
   'IN_REVIEW', now() - interval '9 days', now() - interval '1 day');

insert into policy.citations (
  citation_id, claim_id, provision_id, support_relation, exact_locator
) values
  ('citation:prov-test:1', 'claim:prov-test:1',
   'provision:prov-test:1', 'DIRECT_SUPPORT', 'Article 1'),
  ('citation:prov-test:2', 'claim:prov-test:2',
   'provision:prov-test:1', 'DIRECT_SUPPORT', 'Article 1');

insert into prov_test_state (source_fingerprint)
select encode(
  extensions.digest(
    convert_to(
      policy.build_official_source_verification_manifest('version:prov-test:1')::text,
      'UTF8'
    ),
    'sha256'
  ),
  'hex'
);

grant select on prov_test_state to service_role;
set local role service_role;

-- walk claim 1 up the real machine ladder
select lives_ok(
  $sql$
    select policy.record_machine_assurance(
      'prov:validate', 'SOURCE_VERSION', 'version:prov-test:1',
      'SOURCE_VALIDATED',
      (select source_fingerprint from prov_test_state),
      null, null, null, null, null, null,
      '{"contradiction":"PASS","freshness":"PASS","rights":"PASS","jurisdiction":"PASS","effectiveDates":"PASS","citationLocator":"PASS"}'::jsonb,
      repeat('5', 64), repeat('6', 64), '{}'::text[], '{}'::text[]
    )
  $sql$,
  'fixture source validates through the real RPC'
);

select lives_ok(
  $sql$
    select policy.record_machine_assurance(
      'prov:extract:1', 'CLAIM_DRAFT', 'claim:prov-test:1',
      'AI_EXTRACTED',
      (select source_fingerprint from prov_test_state),
      repeat('7', 64),
      'model-a', 'claim-extraction', '1.0.0', '1.0.0', 0.9,
      '{"contradiction":"PASS","freshness":"PASS","rights":"PASS","jurisdiction":"PASS","effectiveDates":"PASS","citationLocator":"PASS"}'::jsonb,
      repeat('5', 64), repeat('6', 64), '{}'::text[], '{}'::text[]
    )
  $sql$,
  'fixture claim 1 extracts through the real RPC'
);

select lives_ok(
  $sql$
    select policy.record_machine_assurance(
      'prov:crosscheck:1', 'CLAIM_DRAFT', 'claim:prov-test:1',
      'AI_CROSS_CHECKED',
      (select source_fingerprint from prov_test_state),
      repeat('7', 64),
      'model-b', 'claim-crosscheck', '1.0.0', '1.0.0', 0.9,
      '{"contradiction":"PASS","freshness":"PASS","rights":"PASS","jurisdiction":"PASS","effectiveDates":"PASS","citationLocator":"PASS"}'::jsonb,
      repeat('5', 64), repeat('6', 64), '{}'::text[], '{}'::text[]
    )
  $sql$,
  'fixture claim 1 cross-checks through the real RPC'
);

-- direct writes are closed
select throws_ok(
  $sql$
    insert into policy.provisional_corpus_releases (
      release_id, jurisdiction_code, as_of, knowledge_cutoff, manifest_sha256
    ) values (
      'provisional:direct', 'EEA', now(), now(), repeat('8', 64)
    )
  $sql$,
  '42501',
  'permission denied for table provisional_corpus_releases',
  'service role cannot insert provisional releases directly'
);

select throws_ok(
  $sql$
    insert into policy.provisional_release_claims (
      release_id, claim_id, claim_fingerprint, assurance_record_id
    ) values (
      'provisional:direct', 'claim:prov-test:1', repeat('7', 64), 'prov:crosscheck:1'
    )
  $sql$,
  '42501',
  'permission denied for table provisional_release_claims',
  'service role cannot insert provisional membership directly'
);

-- fail-closed release preconditions
select throws_ok(
  $sql$
    select policy.publish_provisional_release(
      'provisional:empty', 'EEA', now(), now() - interval '1 day', '{}'::text[]
    )
  $sql$,
  'P0001',
  'provisional release membership is empty',
  'empty membership is rejected'
);

select throws_ok(
  $sql$
    select policy.publish_provisional_release(
      'provisional:unchecked', 'EEA', now(), now() - interval '1 day',
      array['claim:prov-test:1', 'claim:prov-test:2']
    )
  $sql$,
  'P0001',
  'provisional release claim claim:prov-test:2 is not AI_CROSS_CHECKED',
  'an unchecked claim blocks the whole release'
);

select throws_ok(
  $sql$
    select policy.publish_provisional_release(
      'provisional:wrong-jurisdiction', 'SG', now(), now() - interval '1 day',
      array['claim:prov-test:1']
    )
  $sql$,
  'P0001',
  'provisional release claim claim:prov-test:1 is outside the release jurisdiction',
  'a jurisdiction mismatch blocks the release'
);

select throws_ok(
  $sql$
    select policy.publish_provisional_release(
      'provisional:inreview', 'EEA', now(), now() - interval '1 day',
      array['claim:prov-test:inreview']
    )
  $sql$,
  'P0001',
  'provisional release claims must remain private DRAFT rows',
  'a claim in human review cannot enter a provisional release'
);

-- successful publication
select lives_ok(
  $sql$
    select policy.publish_provisional_release(
      'provisional:eea:test', 'EEA', now(), now() - interval '1 day',
      array['claim:prov-test:1']
    )
  $sql$,
  'a clean AI_CROSS_CHECKED claim publishes provisionally'
);

select is(
  (select assurance_level from policy.machine_assurance_states
   where subject_type = 'CLAIM_DRAFT' and subject_id = 'claim:prov-test:1'),
  'PROVISIONAL_PUBLISHED',
  'publication advances the machine state to PROVISIONAL_PUBLISHED'
);

select is(
  (select outcome || ':' || coalesce(model, 'null')
   from policy.machine_assurance_records
   where record_id = 'provisional:eea:test:claim:prov-test:1:published'),
  'ADVANCED:null',
  'publication writes a deterministic PROVISIONAL_PUBLISHED audit record'
);

-- replay of the same release id fails closed instead of silently rewriting
select throws_ok(
  $sql$
    select policy.publish_provisional_release(
      'provisional:eea:test', 'EEA', now(), now() - interval '1 day',
      array['claim:prov-test:1']
    )
  $sql$,
  'P0001',
  'provisional release claim claim:prov-test:1 is not AI_CROSS_CHECKED',
  'a published claim cannot be republished into a new release without a fresh cross-check'
);

-- lane separation: human-lane state is untouched
select is(
  (select review_state from policy.legal_claims where claim_id = 'claim:prov-test:1'),
  'DRAFT',
  'provisional publication leaves claim review_state as DRAFT'
);

select is(
  (select count(*)::integer from policy.corpus_releases),
  0,
  'reviewed corpus releases remain untouched by provisional publication'
);

-- ---------------------------------------------------------------------------
-- migration 0022: presentation-safe provisional views
-- ---------------------------------------------------------------------------

select columns_are(
  'policy', 'public_provisional_claims',
  array[
    'claim_id', 'jurisdiction_code', 'topic', 'proposition', 'legal_status',
    'effective_from', 'effective_to', 'release_id', 'as_of',
    'knowledge_cutoff', 'published_at', 'assurance_level', 'human_reviewed',
    'confidence', 'limitations', 'counsel_triggers', 'source_version_id',
    'source_checksum_sha256', 'source_retrieved_at', 'source_official_url',
    'citations'
  ],
  'provisional claim view exposes no reviewer, prompt, model, or private columns'
);

select is(
  (select assurance_level || ':' || human_reviewed::text || ':'
      || (confidence is not null)::text
   from policy.public_provisional_claims
   where claim_id = 'claim:prov-test:1'),
  'PROVISIONAL_PUBLISHED:false:true',
  'published claim appears provisional with confidence and no human review'
);

select is(
  (select count(*)::integer from policy.public_provisional_claims
   where claim_id = 'claim:prov-test:2'),
  0,
  'unpublished claims never appear in the provisional view'
);

select is(
  (select jurisdiction_code || ':' || provisional_claim_count::text
   from policy.public_provisional_coverage),
  'EEA:1',
  'provisional coverage reports the latest release without completeness claims'
);

select * from finish();

rollback;
