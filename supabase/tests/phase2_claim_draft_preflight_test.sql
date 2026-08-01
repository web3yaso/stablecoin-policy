begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, policy, regulatory;
select plan(16);

insert into policy.storage_objects (
  object_id, provider, bucket, object_key, checksum_sha256, byte_size,
  content_type, encryption_state
) values (
  'object:preflight-test:1', 'supabase', 'policy-sources',
  'tests/preflight/source.bin', repeat('9', 64), 64,
  'application/octet-stream', 'PROVIDER_ENCRYPTED'
);
insert into regulatory.source_authorities (
  authority_id, name, jurisdiction_code, authority_type, official_domains
) values (
  'authority:preflight-test', 'Preflight Test Authority', 'EEA',
  'OFFICIAL_REGISTER', array['official.example.test']
);
insert into regulatory.source_documents (
  document_id, authority_id, official_document_id, document_type, title,
  canonical_url, language_codes, redistribution_rights
) values (
  'document:preflight-test', 'authority:preflight-test', 'PREFLIGHT-TEST-1',
  'REGULATION', 'Sanitized Preflight Test Instrument',
  'https://official.example.test/preflight', array['en'], 'LINK_ONLY'
);
insert into regulatory.source_versions (
  version_id, document_id, version_label, raw_object_id, checksum_sha256,
  official_url, observed_at, retrieved_at, storage_rights
) values (
  'version:preflight-test:1', 'document:preflight-test', 'v1',
  'object:preflight-test:1', repeat('a', 64),
  'https://official.example.test/preflight/v1', now(), now(),
  'REVIEW_REQUIRED'
);
insert into regulatory.provisions (
  provision_id, version_id, locator, language_code, text_checksum_sha256,
  ordinal, excerpt_permission
) values (
  'provision:preflight-test:1', 'version:preflight-test:1', 'Article 1',
  'en', repeat('b', 64), 1, 'UNKNOWN'
);

create temporary table preflight_test_input (bundle jsonb) on commit drop;
insert into preflight_test_input values (jsonb_build_object(
  'schemaVersion', '1.0.0',
  'batchId', 'preflight-batch:test:1',
  'jurisdictionCode', 'EEA',
  'claims', jsonb_build_array(jsonb_build_object(
    'claimId', 'claim:preflight-test:1',
    'topic', 'sanitized-topic',
    'proposition', 'Sanitized preflight proposition; not legal guidance.',
    'legalStatus', 'UNDETERMINED',
    'effectiveFrom', (now() - interval '1 day'),
    'effectiveTo', null,
    'knowledgeCutoff', now(),
    'actorTypes', jsonb_build_array('TEST_ACTOR'),
    'activityCodes', jsonb_build_array('TEST_ACTIVITY'),
    'supersedesClaimId', null,
    'citations', jsonb_build_array(jsonb_build_object(
      'citationId', 'citation:preflight-test:1',
      'provisionId', 'provision:preflight-test:1',
      'supportRelation', 'DIRECT_SUPPORT',
      'exactLocator', 'Article 1',
      'allowedExcerpt', null
    ))
  ))
));
grant select on preflight_test_input to service_role;

select ok(
  has_function_privilege(
    'service_role', 'policy.preflight_legal_claim_draft_bundle(jsonb)',
    'EXECUTE'
  ),
  'service role can execute the private draft preflight'
);
select ok(
  not has_function_privilege(
    'anon', 'policy.preflight_legal_claim_draft_bundle(jsonb)', 'EXECUTE'
  ),
  'anonymous callers cannot execute the private draft preflight'
);

set local role service_role;
select is(
  (policy.preflight_legal_claim_draft_bundle(
    (select bundle from preflight_test_input)
  )->>'importReady')::boolean,
  true,
  'known provision references are ready for private DRAFT import'
);
select is(
  (policy.preflight_legal_claim_draft_bundle(
    (select bundle from preflight_test_input)
  )->>'reviewEvidenceReady')::boolean,
  false,
  'an observed source is not ready for claim review'
);
select ok(
  policy.preflight_legal_claim_draft_bundle(
    (select bundle from preflight_test_input)
  )->'claims'->0->'reviewReadinessErrors' ? 'unverified_source',
  'preflight reports unverified source evidence'
);
select ok(
  policy.preflight_legal_claim_draft_bundle(
    (select bundle from preflight_test_input)
  )->'claims'->0->'reviewReadinessErrors' ? 'unknown_excerpt_permission',
  'preflight reports unknown excerpt permission'
);
select is(
  (policy.preflight_legal_claim_draft_bundle(
    (select bundle from preflight_test_input)
  )->>'legalValidityAssessed')::boolean,
  false,
  'preflight never claims legal validity'
);
select is(
  (select count(*)::integer from policy.legal_claims),
  0,
  'preflight creates no claims'
);
select is(
  (select count(*)::integer from policy.claim_draft_imports),
  0,
  'preflight creates no import audit record'
);
select is(
  (policy.preflight_legal_claim_draft_bundle(jsonb_set(
    (select bundle from preflight_test_input),
    '{claims,0,citations,0,provisionId}',
    '"provision:missing:test"'
  ))->>'importReady')::boolean,
  false,
  'missing provisions block import'
);
select ok(
  policy.preflight_legal_claim_draft_bundle(jsonb_set(
    (select bundle from preflight_test_input),
    '{claims,0,citations,0,provisionId}',
    '"provision:missing:test"'
  ))->'claims'->0->'importErrors' ? 'provision_missing',
  'missing provision blocker is explicit'
);
select is(
  (policy.preflight_legal_claim_draft_bundle(jsonb_set(
    (select bundle from preflight_test_input),
    '{claims,0,citations,0,allowedExcerpt}',
    '"sanitized excerpt"'
  ))->>'importReady')::boolean,
  false,
  'an excerpt without ALLOWED permission blocks import'
);
reset role;

insert into policy.legal_claims (
  claim_id, jurisdiction_code, topic, proposition, legal_status,
  effective_from, knowledge_cutoff
) values (
  'claim:preflight-test:1', 'EEA', 'existing',
  'Existing sanitized fixture.', 'UNDETERMINED', now(), now()
);
set local role service_role;
select ok(
  policy.preflight_legal_claim_draft_bundle(
    (select bundle from preflight_test_input)
  )->'claims'->0->'importErrors' ? 'claim_id_exists',
  'existing claim IDs are reported before import'
);

reset role;
delete from policy.legal_claims where claim_id = 'claim:preflight-test:1';
set local role service_role;
select lives_ok(
  $sql$select policy.import_legal_claim_draft_bundle(
    (select bundle from preflight_test_input)
  )$sql$,
  'fixture bundle imports before replay preflight'
);
select is(
  (policy.preflight_legal_claim_draft_bundle(
    (select bundle from preflight_test_input)
  )->>'idempotentReplay')::boolean,
  true,
  'identical imported batch is recognized as an idempotent replay'
);
select ok(
  policy.preflight_legal_claim_draft_bundle(jsonb_set(
    (select bundle from preflight_test_input),
    '{claims,0,topic}',
    '"changed-topic"'
  ))->'bundleErrors' ? 'batch_manifest_conflict',
  'changed reuse of an imported batch ID is blocked explicitly'
);

select * from finish();
rollback;
