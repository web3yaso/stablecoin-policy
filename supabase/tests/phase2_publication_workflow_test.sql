begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, policy, regulatory;

select plan(34);

create temporary table phase2_test_state (
  source_manifest text,
  claim_manifest text,
  release_manifest text,
  coverage_manifest text,
  freshness_cutoff timestamptz
) on commit drop;

insert into phase2_test_state (freshness_cutoff)
values (now() - interval '2 days');

insert into policy.storage_objects (
  object_id, provider, bucket, object_key, checksum_sha256, byte_size,
  content_type, encryption_state
) values (
  'object:phase2-test:1', 'supabase', 'policy-sources',
  'tests/phase2/source.bin', repeat('1', 64), 128,
  'application/octet-stream', 'PROVIDER_ENCRYPTED'
);

insert into regulatory.source_authorities (
  authority_id, name, jurisdiction_code, authority_type, official_domains
) values (
  'authority:phase2-test', 'Phase 2 Test Authority', 'EEA',
  'OFFICIAL_REGISTER', array['official.example.test']
);

insert into regulatory.source_documents (
  document_id, authority_id, official_document_id, document_type, title,
  canonical_url, language_codes, redistribution_rights, licence_identifier
) values (
  'document:phase2-test', 'authority:phase2-test', 'PHASE2-TEST-1',
  'REGULATION', 'Sanitized Phase 2 Test Instrument',
  'https://official.example.test/instrument', array['en'], 'FULL_TEXT',
  'TEST-LICENCE'
);

insert into regulatory.source_versions (
  version_id, document_id, version_label, raw_object_id, checksum_sha256,
  official_url, published_at, effective_from, observed_at, retrieved_at,
  lifecycle_state, storage_rights, rights_reviewed_at, rights_basis
) values (
  'version:phase2-test:1', 'document:phase2-test', 'test-v1',
  'object:phase2-test:1', repeat('2', 64),
  'https://official.example.test/instrument/v1', now() - interval '10 days',
  now() - interval '9 days', now() - interval '1 day',
  now() - interval '1 day', 'OBSERVED', 'ALLOWED',
  now() - interval '2 days', 'Sanitized test rights basis'
);

insert into regulatory.provisions (
  provision_id, version_id, locator, heading, language_code, provision_text,
  text_checksum_sha256, ordinal, excerpt_permission
) values (
  'provision:phase2-test:1', 'version:phase2-test:1', 'Article 1',
  'Sanitized test provision', 'en', 'Sanitized non-legal fixture text.',
  repeat('3', 64), 1, 'ALLOWED'
);

update phase2_test_state
set source_manifest = (
  policy.get_official_source_verification_manifest('version:phase2-test:1')
  ->> 'manifestSha256'
);

grant select, update on phase2_test_state to service_role;
set local role service_role;

select is(
  (select lifecycle_state from regulatory.source_versions
   where version_id = 'version:phase2-test:1'),
  'OBSERVED',
  'source fixture begins OBSERVED'
);

select throws_ok(
  $sql$
    select policy.review_official_source_version(
      'verification:phase2-test:stale', 'version:phase2-test:1', 'APPROVED',
      'OFFICIAL_BYTE_AND_LOCATOR_REVIEW', 'Legal reviewer', 'reviewer:test:1',
      repeat('0', 64), now(), null
    )
  $sql$,
  'P0001',
  'source verification manifest checksum mismatch',
  'stale source manifest is rejected'
);

select is(
  (select lifecycle_state from regulatory.source_versions
   where version_id = 'version:phase2-test:1'),
  'OBSERVED',
  'stale source review leaves lifecycle unchanged'
);

select is(
  (select count(*)::integer from regulatory.source_verification_records
   where version_id = 'version:phase2-test:1'),
  0,
  'stale source review writes no audit record'
);

select throws_ok(
  $sql$
    select policy.review_official_source_version(
      'verification:phase2-test:machine', 'version:phase2-test:1', 'APPROVED',
      'OFFICIAL_BYTE_AND_LOCATOR_REVIEW', 'Automated reviewer', 'automation',
      (select source_manifest from phase2_test_state), now(), null
    )
  $sql$,
  'P0001',
  'source verification requires an identified human reviewer',
  'automated source reviewer is rejected'
);

select lives_ok(
  $sql$
    select policy.review_official_source_version(
      'verification:phase2-test:approved', 'version:phase2-test:1', 'APPROVED',
      'OFFICIAL_BYTE_AND_LOCATOR_REVIEW', 'Legal reviewer', 'reviewer:test:1',
      (select source_manifest from phase2_test_state), now(), null
    )
  $sql$,
  'named-human source review succeeds'
);

select is(
  (select lifecycle_state from regulatory.source_versions
   where version_id = 'version:phase2-test:1'),
  'VERIFIED',
  'approved source becomes VERIFIED'
);

select is(
  (select count(*)::integer from regulatory.source_verification_records
   where version_id = 'version:phase2-test:1' and outcome = 'APPROVED'),
  1,
  'source approval has one immutable audit record'
);

insert into policy.legal_claims (
  claim_id, jurisdiction_code, topic, proposition, legal_status,
  effective_from, knowledge_cutoff, actor_types, activity_codes
) values (
  'claim:phase2-test:1', 'EEA', 'test-topic',
  'Sanitized test proposition; not legal guidance.', 'REQUIREMENT',
  now() - interval '9 days', now() - interval '1 hour',
  array['TEST_ACTOR'], array['TEST_ACTIVITY']
);

insert into policy.citations (
  citation_id, claim_id, provision_id, support_relation, exact_locator,
  allowed_excerpt
) values (
  'citation:phase2-test:1', 'claim:phase2-test:1',
  'provision:phase2-test:1', 'DIRECT_SUPPORT', 'Article 1',
  'Sanitized fixture excerpt.'
);

select lives_ok(
  $sql$select policy.submit_legal_claim_for_review('claim:phase2-test:1')$sql$,
  'claim with a citation enters review'
);

update phase2_test_state
set claim_manifest = (
  policy.get_legal_claim_review_manifest('claim:phase2-test:1')
  ->> 'manifestSha256'
);

select throws_ok(
  $sql$
    select policy.review_legal_claim(
      'review:phase2-test:machine', 'claim:phase2-test:1', 'APPROVED',
      'Automated reviewer', 'llm',
      (select claim_manifest from phase2_test_state), now(), null
    )
  $sql$,
  'P0001',
  'claim review requires an identified human reviewer',
  'automated claim reviewer is rejected'
);

select lives_ok(
  $sql$
    select policy.review_legal_claim(
      'review:phase2-test:approved', 'claim:phase2-test:1', 'APPROVED',
      'Legal reviewer', 'reviewer:test:2',
      (select claim_manifest from phase2_test_state), now(), null
    )
  $sql$,
  'named-human claim review succeeds'
);

select is(
  (select review_state from policy.legal_claims
   where claim_id = 'claim:phase2-test:1'),
  'REVIEWED',
  'approved claim becomes REVIEWED'
);

select is(
  (select count(*)::integer from policy.review_records
   where claim_id = 'claim:phase2-test:1' and outcome = 'APPROVED'),
  1,
  'claim approval has one audit record'
);

select lives_ok(
  $sql$
    select policy.create_corpus_release(
      'corpus:phase2-test:1', now() - interval '1 day', now()
    )
  $sql$,
  'corpus release is created through its RPC'
);

insert into policy.corpus_release_claims (release_id, claim_id)
values ('corpus:phase2-test:1', 'claim:phase2-test:1');

select lives_ok(
  $sql$select policy.submit_corpus_release_for_review('corpus:phase2-test:1')$sql$,
  'corpus release enters review with reviewed membership'
);

update phase2_test_state
set release_manifest = (
  policy.get_corpus_release_review_manifest('corpus:phase2-test:1')
  ->> 'manifestSha256'
);

select throws_ok(
  $sql$
    select policy.review_corpus_release(
      'release-review:phase2-test:machine', 'corpus:phase2-test:1', 'APPROVED',
      'Automated reviewer', 'system',
      (select release_manifest from phase2_test_state), now(), null
    )
  $sql$,
  'P0001',
  'corpus release review requires an identified human reviewer',
  'automated corpus reviewer is rejected'
);

select lives_ok(
  $sql$
    select policy.review_corpus_release(
      'release-review:phase2-test:approved', 'corpus:phase2-test:1', 'APPROVED',
      'Legal reviewer', 'reviewer:test:3',
      (select release_manifest from phase2_test_state), now(), null
    )
  $sql$,
  'named-human corpus review succeeds'
);

select lives_ok(
  $sql$
    select policy.publish_corpus_release(
      'corpus:phase2-test:1',
      (select release_manifest from phase2_test_state), now()
    )
  $sql$,
  'currently approved corpus release publishes'
);

select is(
  (select release_state from policy.corpus_releases
   where release_id = 'corpus:phase2-test:1'),
  'PUBLISHED',
  'approved corpus reaches PUBLISHED'
);

select is(
  (select count(*)::integer from policy.corpus_release_review_records
   where release_id = 'corpus:phase2-test:1' and outcome = 'APPROVED'),
  1,
  'corpus approval has one audit record'
);

select lives_ok(
  $sql$
    select policy.create_coverage_baseline_checklist(
      'checklist:phase2-test:1', 'EEA', 'test-v1',
      '[{"itemId":"test-item","title":"Sanitized baseline item","supportingClaimIds":["claim:phase2-test:1"]}]'::jsonb
    )
  $sql$,
  'versioned coverage checklist is created'
);

update phase2_test_state
set coverage_manifest = (
  policy.get_coverage_review_manifest(
    'EEA', 'checklist:phase2-test:1', 'corpus:phase2-test:1',
    freshness_cutoff, 'Sanitized reviewed test baseline.'
  ) ->> 'manifestSha256'
);

select throws_ok(
  $sql$
    select policy.review_coverage_scope(
      'coverage-review:phase2-test:machine', 'EEA',
      'checklist:phase2-test:1', 'corpus:phase2-test:1',
      (select freshness_cutoff from phase2_test_state),
      'Sanitized reviewed test baseline.',
      (select coverage_manifest from phase2_test_state),
      'Automated reviewer', 'ai', now(), null
    )
  $sql$,
  'P0001',
  'coverage review requires an identified human reviewer',
  'automated coverage reviewer is rejected'
);

select throws_ok(
  $sql$
    select policy.review_coverage_scope(
      'coverage-review:phase2-test:stale', 'EEA',
      'checklist:phase2-test:1', 'corpus:phase2-test:1',
      (select freshness_cutoff from phase2_test_state),
      'Sanitized reviewed test baseline.', repeat('0', 64),
      'Legal reviewer', 'reviewer:test:4', now(), null
    )
  $sql$,
  'P0001',
  'coverage review manifest checksum mismatch',
  'stale coverage manifest is rejected'
);

select is(
  (select count(*)::integer from policy.coverage_review_records
   where jurisdiction_code = 'EEA'),
  0,
  'rejected coverage reviews write no audit record'
);

select lives_ok(
  $sql$
    select policy.review_coverage_scope(
      'coverage-review:phase2-test:approved', 'EEA',
      'checklist:phase2-test:1', 'corpus:phase2-test:1',
      (select freshness_cutoff from phase2_test_state),
      'Sanitized reviewed test baseline.',
      (select coverage_manifest from phase2_test_state),
      'Legal reviewer', 'reviewer:test:4', now(), null
    )
  $sql$,
  'named-human coverage review succeeds'
);

select is(
  (select concat_ws(':', coverage_state, completeness_percent, freshness_state)
   from policy.coverage_scopes where jurisdiction_code = 'EEA'),
  'REVIEWED:100:CURRENT',
  'coverage atomically reaches REVIEWED, 100%, CURRENT'
);

select is(
  (select count(*)::integer from policy.coverage_review_records
   where jurisdiction_code = 'EEA'),
  1,
  'coverage approval has one audit record'
);

select ok(
  not has_table_privilege('service_role', 'policy.coverage_scopes', 'INSERT'),
  'service role cannot directly insert coverage'
);

select ok(
  not has_table_privilege('service_role', 'policy.coverage_scopes', 'UPDATE'),
  'service role cannot directly update coverage'
);

select ok(
  not has_table_privilege('service_role', 'policy.coverage_scopes', 'DELETE'),
  'service role cannot directly delete coverage'
);

select ok(
  not has_table_privilege('service_role', 'policy.review_records', 'INSERT'),
  'service role cannot directly insert claim reviews'
);

select ok(
  not has_table_privilege('service_role', 'policy.corpus_releases', 'INSERT'),
  'service role cannot directly insert corpus releases'
);

select is(
  (select count(*)::integer from policy.public_corpus_claims
   where claim_id = 'claim:phase2-test:1'),
  1,
  'reviewed claim appears through the published public corpus view'
);

select is(
  (select coverage_state from policy.public_coverage
   where jurisdiction_code = 'EEA'),
  'REVIEWED',
  'reviewed coverage appears through the public coverage view'
);

select * from finish();
rollback;
