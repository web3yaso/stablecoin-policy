begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, policy, regulatory;
select plan(12);

insert into policy.storage_objects (
  object_id, provider, bucket, object_key, checksum_sha256, byte_size,
  content_type, encryption_state
) values (
  'object:draft-test:1', 'supabase', 'policy-sources', 'tests/draft/source.bin',
  repeat('4', 64), 64, 'application/octet-stream', 'PROVIDER_ENCRYPTED'
);
insert into regulatory.source_authorities (
  authority_id, name, jurisdiction_code, authority_type, official_domains
) values (
  'authority:draft-test', 'Draft Test Authority', 'EEA',
  'OFFICIAL_REGISTER', array['official.example.test']
);
insert into regulatory.source_documents (
  document_id, authority_id, official_document_id, document_type, title,
  canonical_url, language_codes, redistribution_rights
) values (
  'document:draft-test', 'authority:draft-test', 'DRAFT-TEST-1', 'REGULATION',
  'Sanitized Draft Test Instrument', 'https://official.example.test/draft',
  array['en'], 'FULL_TEXT'
);
insert into regulatory.source_versions (
  version_id, document_id, version_label, raw_object_id, checksum_sha256,
  official_url, observed_at, retrieved_at, storage_rights,
  rights_reviewed_at, rights_basis
) values (
  'version:draft-test:1', 'document:draft-test', 'v1', 'object:draft-test:1',
  repeat('5', 64), 'https://official.example.test/draft/v1', now(), now(),
  'ALLOWED', now(), 'Sanitized test basis'
);
insert into regulatory.provisions (
  provision_id, version_id, locator, language_code, text_checksum_sha256,
  ordinal, excerpt_permission
) values (
  'provision:draft-test:1', 'version:draft-test:1', 'Article 1', 'en',
  repeat('6', 64), 1, 'ALLOWED'
);

create temporary table draft_test_input (bundle jsonb) on commit drop;
insert into draft_test_input values (jsonb_build_object(
  'schemaVersion', '1.0.0',
  'batchId', 'draft-batch:test:1',
  'jurisdictionCode', 'EEA',
  'claims', jsonb_build_array(jsonb_build_object(
    'claimId', 'claim:draft-test:1',
    'topic', 'sanitized-topic',
    'proposition', 'Sanitized draft proposition; not legal guidance.',
    'legalStatus', 'UNDETERMINED',
    'effectiveFrom', (now() - interval '1 day'),
    'effectiveTo', null,
    'knowledgeCutoff', now(),
    'actorTypes', jsonb_build_array('TEST_ACTOR'),
    'activityCodes', jsonb_build_array('TEST_ACTIVITY'),
    'supersedesClaimId', null,
    'citations', jsonb_build_array(jsonb_build_object(
      'citationId', 'citation:draft-test:1',
      'provisionId', 'provision:draft-test:1',
      'supportRelation', 'DIRECT_SUPPORT',
      'exactLocator', 'Article 1',
      'allowedExcerpt', null
    ))
  ))
));
grant select, update on draft_test_input to service_role;
set local role service_role;

select ok(
  has_function_privilege(
    'service_role', 'policy.import_legal_claim_draft_bundle(jsonb)', 'EXECUTE'
  ),
  'service role can execute the atomic draft importer'
);
select ok(
  not has_table_privilege('service_role', 'policy.claim_draft_imports', 'INSERT'),
  'service role cannot forge draft import audit rows'
);
select lives_ok(
  $sql$select policy.import_legal_claim_draft_bundle(
    (select bundle from draft_test_input)
  )$sql$,
  'valid draft bundle imports atomically'
);
select is(
  (select review_state from policy.legal_claims where claim_id = 'claim:draft-test:1'),
  'DRAFT',
  'imported claim is always DRAFT'
);
select is(
  (select count(*)::integer from policy.citations
   where claim_id = 'claim:draft-test:1'),
  1,
  'draft citation is imported with its claim'
);
select is(
  (select count(*)::integer from policy.claim_draft_imports
   where batch_id = 'draft-batch:test:1'),
  1,
  'draft import writes one immutable audit record'
);
select is(
  (select count(*)::integer from policy.public_corpus_claims
   where claim_id = 'claim:draft-test:1'),
  0,
  'draft import does not expose the claim publicly'
);
select is(
  (policy.import_legal_claim_draft_bundle(
    (select bundle from draft_test_input)
  )->>'idempotentReplay')::boolean,
  true,
  'identical batch replay is idempotent'
);
select is(
  (select count(*)::integer from policy.legal_claims
   where claim_id = 'claim:draft-test:1'),
  1,
  'idempotent replay creates no duplicate claim'
);
select throws_ok(
  $sql$select policy.import_legal_claim_draft_bundle(
    jsonb_set((select bundle from draft_test_input), '{claims,0,topic}', '"changed"')
  )$sql$,
  'P0001',
  'legal claim draft batch id conflicts with another manifest',
  'same batch id with changed content is rejected'
);
select throws_ok(
  $sql$select policy.import_legal_claim_draft_bundle(
    jsonb_set(
      jsonb_set((select bundle from draft_test_input), '{batchId}', '"draft-batch:test:review"'),
      '{claims,0,reviewState}', '"REVIEWED"'
    )
  )$sql$,
  'P0001',
  'invalid legal claim draft',
  'bundle cannot request a reviewed state'
);
select is(
  (select count(*)::integer from policy.claim_draft_imports),
  1,
  'rejected bundles leave no partial audit rows'
);

select * from finish();
rollback;
