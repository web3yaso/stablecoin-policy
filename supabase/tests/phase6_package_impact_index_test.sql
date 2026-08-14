begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, policy, regulatory;

select plan(28);

insert into policy.storage_objects (
  object_id, provider, bucket, object_key, checksum_sha256, byte_size,
  content_type, encryption_state
) values (
  'object:impact-test:source', 'supabase', 'policy-sources',
  'tests/package-impact/source.bin', repeat('1', 64), 128,
  'application/octet-stream', 'PROVIDER_ENCRYPTED'
);

insert into regulatory.source_authorities (
  authority_id, name, jurisdiction_code, authority_type, official_domains
) values (
  'authority:impact-test', 'Sanitized Impact Test Authority', 'EEA',
  'REGULATOR', array['official.impact.test']
);

insert into regulatory.source_documents (
  document_id, authority_id, official_document_id, document_type, title,
  canonical_url, language_codes, redistribution_rights
) values (
  'document:impact-test', 'authority:impact-test', 'IMPACT-TEST-1',
  'REGULATION', 'Sanitized Impact Test Instrument',
  'https://official.impact.test/instrument', array['en'], 'LINK_ONLY'
);

insert into regulatory.source_versions (
  version_id, document_id, version_label, raw_object_id, checksum_sha256,
  official_url, observed_at, retrieved_at, lifecycle_state
) values (
  'version:impact-test:1', 'document:impact-test', 'test-v1',
  'object:impact-test:source', repeat('2', 64),
  'https://official.impact.test/instrument/v1',
  '2026-08-10T00:00:00Z', '2026-08-10T00:00:00Z', 'VERIFIED'
);

insert into policy.legal_claims (
  claim_id, jurisdiction_code, topic, proposition, legal_status,
  review_state, effective_from, knowledge_cutoff
) values
  ('claim:impact-test:matching', 'EEA', 'sanitized-impact-topic',
   'Sanitized matching claim.', 'UNDETERMINED', 'PUBLISHED',
   '2026-08-01T00:00:00Z', '2026-08-10T00:00:00Z'),
  ('claim:impact-test:unrelated', 'EEA', 'sanitized-other-topic',
   'Sanitized unrelated claim.', 'UNDETERMINED', 'PUBLISHED',
   '2026-08-01T00:00:00Z', '2026-08-10T00:00:00Z');

insert into policy.machine_assurance_records (
  record_id, subject_type, subject_id, assurance_level,
  source_version_fingerprint, claim_fingerprint,
  model, prompt_template_id, prompt_template_version, parameters_version,
  confidence, checks, input_checksum_sha256, output_checksum_sha256,
  blockers, limitations, outcome
) values (
  'record:impact-test:crosscheck', 'CLAIM_DRAFT',
  'claim:impact-test:matching', 'AI_CROSS_CHECKED', repeat('3', 64),
  repeat('4', 64), 'sanitized-test-model', 'impact-test', '1', '1', 0.99,
  '{"contradiction":"PASS","freshness":"PASS","rights":"PASS","jurisdiction":"PASS","effectiveDates":"PASS","citationLocator":"PASS"}'::jsonb,
  repeat('5', 64), repeat('6', 64), '{}'::text[], '{}'::text[], 'ADVANCED'
);

insert into policy.provisional_corpus_releases (
  release_id, jurisdiction_code, as_of, knowledge_cutoff, manifest_sha256,
  published_at
) values (
  'provisional:impact-test:eea:1', 'EEA', '2026-08-10T00:00:00Z',
  '2026-08-09T00:00:00Z', repeat('7', 64), '2026-08-11T00:00:00Z'
);

insert into policy.provisional_release_claims (
  release_id, claim_id, claim_fingerprint, assurance_record_id
) values (
  'provisional:impact-test:eea:1', 'claim:impact-test:matching',
  repeat('4', 64), 'record:impact-test:crosscheck'
);

insert into regulatory.regulatory_events (
  event_id, authority_id, after_version_id, event_type, title, observed_at,
  event_state, reviewed_at, published_at
) values
  ('event:impact-test:published', 'authority:impact-test',
   'version:impact-test:1', 'AMENDMENT', 'Sanitized published event',
   '2026-08-12T00:00:00Z', 'PUBLISHED', '2026-08-12T01:00:00Z',
   '2026-08-12T02:00:00Z'),
  ('event:impact-test:candidate', 'authority:impact-test',
   'version:impact-test:1', 'AMENDMENT', 'Sanitized candidate event',
   '2026-08-12T00:00:00Z', 'CANDIDATE', null, null),
  ('event:impact-test:dismissed', 'authority:impact-test',
   'version:impact-test:1', 'AMENDMENT', 'Sanitized dismissed event',
   '2026-08-12T00:00:00Z', 'PUBLISHED', '2026-08-12T01:00:00Z',
   '2026-08-12T02:00:00Z'),
  ('event:impact-test:unrelated', 'authority:impact-test',
   'version:impact-test:1', 'AMENDMENT', 'Sanitized unrelated event',
   '2026-08-12T00:00:00Z', 'PUBLISHED', '2026-08-12T01:00:00Z',
   '2026-08-12T02:00:00Z');

insert into policy.event_claim_impacts (
  event_id, claim_id, impact_type, review_state
) values
  ('event:impact-test:published', 'claim:impact-test:matching',
   'MAY_AFFECT', 'REVIEWED'),
  ('event:impact-test:candidate', 'claim:impact-test:matching',
   'MAY_AFFECT', 'REVIEWED'),
  ('event:impact-test:dismissed', 'claim:impact-test:matching',
   'MAY_AFFECT', 'DISMISSED'),
  ('event:impact-test:unrelated', 'claim:impact-test:unrelated',
   'MAY_AFFECT', 'REVIEWED');

select ok(
  not has_table_privilege(
    'anon', 'policy.playbook_package_claim_dependencies', 'SELECT'
  ),
  'anonymous callers cannot read paid package claim dependencies'
);
select ok(
  not has_table_privilege(
    'authenticated', 'policy.playbook_package_claim_dependencies', 'SELECT'
  ),
  'authenticated browsers cannot read paid package claim dependencies'
);
select ok(
  has_table_privilege(
    'service_role', 'policy.playbook_package_claim_dependencies', 'SELECT'
  ),
  'service role can read the private impact index'
);
select ok(
  not has_table_privilege(
    'service_role', 'policy.playbook_package_claim_dependencies', 'INSERT'
  ),
  'service role cannot insert package dependencies directly'
);
select ok(
  not has_function_privilege(
    'anon',
    'policy.register_playbook_package_with_dependencies(text,text,text,text,text,bigint,text,text,text,text,text,text,timestamptz,text,text,text,text,text,text,text,text,text[])',
    'EXECUTE'
  ),
  'anonymous callers cannot register package dependencies'
);
select ok(
  not has_function_privilege(
    'authenticated', 'policy.get_affected_playbook_packages(text)', 'EXECUTE'
  ),
  'authenticated browsers cannot query affected paid packages'
);
select ok(
  not has_function_privilege(
    'service_role',
    'policy.register_playbook_package(text,text,text,text,text,bigint,text,text,text,text,text,text,timestamptz,text,text,text,text,text,text,text,text)',
    'EXECUTE'
  ),
  'service role cannot bypass atomic dependency registration'
);
select ok(
  has_function_privilege(
    'service_role',
    'policy.register_playbook_package_with_dependencies(text,text,text,text,text,bigint,text,text,text,text,text,text,timestamptz,text,text,text,text,text,text,text,text,text[])',
    'EXECUTE'
  ),
  'service role can atomically register packages and dependencies'
);
select ok(
  has_function_privilege(
    'service_role', 'policy.get_affected_playbook_packages(text)', 'EXECUTE'
  ),
  'service role can query affected packages'
);

set local role service_role;

select is(
  policy.claim_playbook_package_idempotency(repeat('4', 64), repeat('5', 64))
    ->>'status',
  'CLAIMED',
  'package request first claims its idempotency lease'
);

select lives_ok(
  $sql$
    select policy.register_playbook_package_with_dependencies(
      'object:playbook-package:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'supabase-storage', 'policy-playbooks',
      'packages/stablecoin-pre-listing/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json',
      repeat('6', 64), 2048, 'application/json',
      'package:stablecoin-pre-listing:aaaaaaaaaaaaaaaa',
      'stablecoin-pre-listing', repeat('7', 64), repeat('a', 64),
      '1.1.0', '2026-08-12T00:00:00Z', 'PROVISIONAL',
      'provisional:impact-test:eea:1', null, 'usdc-eea', '1.0.0', '1.0.0',
      repeat('4', 64), repeat('5', 64),
      array['claim:impact-test:matching']
    )
  $sql$,
  'package metadata, idempotency, and exact claim dependencies register atomically'
);
select is(
  (select count(*)::integer from policy.playbook_packages),
  1,
  'one immutable package is registered'
);
select is(
  (select count(*)::integer from policy.playbook_package_claim_dependencies),
  1,
  'one exact package claim dependency is registered'
);
select is(
  (select dependency_basis from policy.playbook_package_claim_dependencies),
  'DECISION_EVIDENCE',
  'only deterministic decision evidence is indexed'
);
select is(
  (select state from policy.playbook_package_idempotency
   where idempotency_key_sha256 = repeat('4', 64)),
  'COMPLETED',
  'atomic dependency registration completes idempotency'
);
select lives_ok(
  $sql$
    select policy.register_playbook_package_with_dependencies(
      'object:playbook-package:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'supabase-storage', 'policy-playbooks',
      'packages/stablecoin-pre-listing/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json',
      repeat('6', 64), 2048, 'application/json',
      'package:stablecoin-pre-listing:aaaaaaaaaaaaaaaa',
      'stablecoin-pre-listing', repeat('7', 64), repeat('a', 64),
      '1.1.0', '2026-08-12T00:00:00Z', 'PROVISIONAL',
      'provisional:impact-test:eea:1', null, 'usdc-eea', '1.0.0', '1.0.0',
      repeat('4', 64), repeat('5', 64),
      array['claim:impact-test:matching']
    )
  $sql$,
  'exact package dependency registration replays idempotently'
);
select is(
  (select count(*)::integer from policy.playbook_package_claim_dependencies),
  1,
  'exact replay creates no duplicate dependency'
);
select throws_ok(
  $sql$
    select policy.register_playbook_package_with_dependencies(
      'object:playbook-package:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'supabase-storage', 'policy-playbooks',
      'packages/stablecoin-pre-listing/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json',
      repeat('6', 64), 2048, 'application/json',
      'package:stablecoin-pre-listing:aaaaaaaaaaaaaaaa',
      'stablecoin-pre-listing', repeat('7', 64), repeat('a', 64),
      '1.1.0', '2026-08-12T00:00:00Z', 'PROVISIONAL',
      'provisional:impact-test:eea:1', null, 'usdc-eea', '1.0.0', '1.0.0',
      repeat('4', 64), repeat('5', 64),
      array['claim:impact-test:matching', 'claim:impact-test:matching']
    )
  $sql$,
  'playbook evidence claim IDs must be unique',
  'duplicate dependency IDs fail closed before registration'
);
select throws_ok(
  $sql$
    select policy.register_playbook_package_with_dependencies(
      'object:playbook-package:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'supabase-storage', 'policy-playbooks',
      'packages/stablecoin-pre-listing/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json',
      repeat('6', 64), 2048, 'application/json',
      'package:stablecoin-pre-listing:aaaaaaaaaaaaaaaa',
      'stablecoin-pre-listing', repeat('7', 64), repeat('a', 64),
      '1.1.0', '2026-08-12T00:00:00Z', 'PROVISIONAL',
      'provisional:impact-test:eea:1', null, 'usdc-eea', '1.0.0', '1.0.0',
      repeat('4', 64), repeat('5', 64),
      array['claim:impact-test:unrelated']
    )
  $sql$,
  'playbook evidence claim is outside the provisional corpus release',
  'a claim outside the pinned corpus release cannot become a dependency'
);
select throws_ok(
  $sql$
    select policy.get_affected_playbook_packages('event:impact-test:candidate')
  $sql$,
  'regulatory event is not published',
  'candidate events cannot expose affected packages'
);
select is(
  policy.get_affected_playbook_packages('event:impact-test:published')
    #>> '{packages,0,packageId}',
  'package:stablecoin-pre-listing:aaaaaaaaaaaaaaaa',
  'a published reviewed exact claim impact returns the affected package'
);
select is(
  policy.get_affected_playbook_packages('event:impact-test:published')
    #>> '{packages,0,claimImpacts,0,impactType}',
  'MAY_AFFECT',
  'the affected package includes the reviewed impact type'
);
select is(
  jsonb_array_length(
    policy.get_affected_playbook_packages('event:impact-test:dismissed')
      ->'packages'
  ),
  0,
  'a dismissed impact cannot return a package'
);
select is(
  jsonb_array_length(
    policy.get_affected_playbook_packages('event:impact-test:unrelated')
      ->'packages'
  ),
  0,
  'a reviewed impact for an unrelated claim cannot return a package'
);
select throws_ok(
  $sql$
    select policy.get_affected_playbook_packages('event:impact-test:unknown')
  $sql$,
  'unknown regulatory event event:impact-test:unknown',
  'unknown regulatory events fail closed'
);

reset role;

select throws_ok(
  $sql$
    update policy.playbook_package_claim_dependencies
    set dependency_basis = 'DECISION_EVIDENCE'
  $sql$,
  'playbook_package_claim_dependencies rows are immutable; create a new version',
  'registered dependency edges are immutable'
);
select ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'policy'
      and table_name = 'playbook_package_claim_dependencies'
      and column_name in (
        'profile', 'customer_id', 'artifact_json', 'decision_rules',
        'prompt', 'actions'
      )
  ),
  'the impact index stores no customer profile, artifact, rule, prompt, or action'
);
select is(
  (select count(*)::integer from policy.storage_objects
   where bucket = 'policy-playbooks'),
  1,
  'dependency indexing creates no duplicate private artifact'
);

select * from finish();
rollback;
