begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, policy, regulatory;
select plan(9);

select ok(
  has_function_privilege(
    'service_role', 'policy.get_jurisdiction_baseline_readiness(text)', 'EXECUTE'
  ),
  'service role can read the private baseline workflow report'
);
select ok(
  not has_function_privilege(
    'anon', 'policy.get_jurisdiction_baseline_readiness(text)', 'EXECUTE'
  ),
  'anonymous callers cannot read the private baseline workflow report'
);

set local role service_role;
select is(
  policy.get_jurisdiction_baseline_readiness('EEA')->>'workflowStage',
  'SOURCE_INGESTION',
  'an empty jurisdiction starts at source ingestion'
);
select is(
  (policy.get_jurisdiction_baseline_readiness('EEA')
    ->>'legalCompletenessAssessed')::boolean,
  false,
  'workflow readiness never claims legal completeness'
);
select ok(
  policy.get_jurisdiction_baseline_readiness('EEA')->'blockers'
    ? 'source_versions_missing',
  'the report returns deterministic source blockers'
);
select throws_ok(
  $sql$select policy.get_jurisdiction_baseline_readiness('bad')$sql$,
  'P0001',
  'invalid baseline readiness jurisdiction',
  'invalid jurisdiction codes fail closed'
);
reset role;

insert into policy.storage_objects (
  object_id, provider, bucket, object_key, checksum_sha256, byte_size,
  content_type, encryption_state
) values (
  'object:readiness-test:1', 'supabase', 'policy-sources',
  'tests/readiness/source.bin', repeat('7', 64), 64,
  'application/octet-stream', 'PROVIDER_ENCRYPTED'
);
insert into regulatory.source_authorities (
  authority_id, name, jurisdiction_code, authority_type, official_domains
) values (
  'authority:readiness-test', 'Readiness Test Authority', 'EEA',
  'OFFICIAL_REGISTER', array['official.example.test']
);
insert into regulatory.source_documents (
  document_id, authority_id, official_document_id, document_type, title,
  canonical_url, language_codes, redistribution_rights
) values (
  'document:readiness-test', 'authority:readiness-test', 'READINESS-TEST-1',
  'REGULATION', 'Sanitized Readiness Test Instrument',
  'https://official.example.test/readiness', array['en'], 'LINK_ONLY'
);
insert into regulatory.source_versions (
  version_id, document_id, version_label, raw_object_id, checksum_sha256,
  official_url, observed_at, retrieved_at, storage_rights
) values (
  'version:readiness-test:1', 'document:readiness-test', 'v1',
  'object:readiness-test:1', repeat('8', 64),
  'https://official.example.test/readiness/v1', now(), now(),
  'REVIEW_REQUIRED'
);

set local role service_role;
select is(
  policy.get_jurisdiction_baseline_readiness('EEA')->>'workflowStage',
  'SOURCE_REVIEW',
  'an observed source advances only to source review'
);
select is(
  (policy.get_jurisdiction_baseline_readiness('EEA')
    ->'counts'->>'sourceVersions')::integer,
  1,
  'the report counts active source versions'
);
select is(
  (policy.get_jurisdiction_baseline_readiness('EEA')
    ->'counts'->>'verifiedSourceVersions')::integer,
  0,
  'an observed source is not reported as verified'
);

select * from finish();
rollback;
