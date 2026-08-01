begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, policy, regulatory;
select plan(32);

create temporary table change_test_state (
  manifest_sha256 text,
  observed_at timestamptz,
  claim_proposition text,
  coverage_state text
) on commit drop;

insert into policy.storage_objects (
  object_id, provider, bucket, object_key, checksum_sha256, byte_size,
  content_type, encryption_state
) values
  ('object:change-test:before', 'supabase', 'policy-sources',
   'tests/change/before.bin', repeat('1', 64), 64,
   'application/octet-stream', 'PROVIDER_ENCRYPTED'),
  ('object:change-test:after', 'supabase', 'policy-sources',
   'tests/change/after.bin', repeat('2', 64), 65,
   'application/octet-stream', 'PROVIDER_ENCRYPTED');

insert into regulatory.source_authorities (
  authority_id, name, jurisdiction_code, authority_type, official_domains
) values (
  'authority:change-test', 'Change Test Authority', 'EEA',
  'OFFICIAL_REGISTER', array['official.example.test']
);
insert into regulatory.source_documents (
  document_id, authority_id, official_document_id, document_type, title,
  canonical_url, language_codes, redistribution_rights
) values (
  'document:change-test', 'authority:change-test', 'CHANGE-TEST-1',
  'REGULATION', 'Sanitized Change Test Instrument',
  'https://official.example.test/change', array['en'], 'LINK_ONLY'
);
insert into regulatory.source_versions (
  version_id, document_id, version_label, raw_object_id, checksum_sha256,
  official_url, observed_at, retrieved_at, lifecycle_state,
  storage_rights, rights_reviewed_at, rights_basis, verified_at
) values
  ('version:change-test:before', 'document:change-test', 'v1',
   'object:change-test:before', repeat('3', 64),
   'https://official.example.test/change/v1', now() - interval '3 days',
   now() - interval '3 days', 'VERIFIED', 'ALLOWED',
   now() - interval '4 days', 'Sanitized reviewed rights', now() - interval '2 days'),
  ('version:change-test:after', 'document:change-test', 'v2',
   'object:change-test:after', repeat('4', 64),
   'https://official.example.test/change/v2', now() - interval '1 day',
   now() - interval '1 day', 'VERIFIED', 'ALLOWED',
   now() - interval '2 days', 'Sanitized reviewed rights', now() - interval '12 hours');
insert into regulatory.provisions (
  provision_id, version_id, locator, language_code, text_checksum_sha256,
  ordinal, excerpt_permission
) values
  ('provision:change-test:before:1', 'version:change-test:before',
   'Article 1', 'en', repeat('5', 64), 1, 'LINK_ONLY'),
  ('provision:change-test:before:2', 'version:change-test:before',
   'Article 2', 'en', repeat('6', 64), 2, 'LINK_ONLY'),
  ('provision:change-test:after:1', 'version:change-test:after',
   'Article 1', 'en', repeat('7', 64), 1, 'LINK_ONLY'),
  ('provision:change-test:after:3', 'version:change-test:after',
   'Article 3', 'en', repeat('8', 64), 3, 'LINK_ONLY');
insert into regulatory.source_verification_records (
  verification_id, version_id, outcome, verification_method,
  reviewer_role, reviewer_ref, manifest_sha256, reviewed_at
) values
  ('verification:change-test:before', 'version:change-test:before', 'APPROVED',
   'OFFICIAL_BYTE_AND_LOCATOR_REVIEW', 'Legal reviewer', 'reviewer:test:before',
   repeat('9', 64), now() - interval '2 days'),
  ('verification:change-test:after', 'version:change-test:after', 'APPROVED',
   'OFFICIAL_BYTE_AND_LOCATOR_REVIEW', 'Legal reviewer', 'reviewer:test:after',
   repeat('a', 64), now() - interval '12 hours');
insert into policy.legal_claims (
  claim_id, jurisdiction_code, topic, proposition, legal_status,
  review_state, effective_from, knowledge_cutoff
) values (
  'claim:change-test:1', 'EEA', 'sanitized-change-topic',
  'Private sanitized change proposition.', 'REQUIREMENT', 'DRAFT',
  now() - interval '10 days', now()
);
insert into policy.citations (
  citation_id, claim_id, provision_id, support_relation, exact_locator
) values (
  'citation:change-test:1', 'claim:change-test:1',
  'provision:change-test:before:1', 'DIRECT_SUPPORT', 'Article 1'
);
update policy.legal_claims set review_state = 'REVIEWED'
where claim_id = 'claim:change-test:1';

insert into change_test_state (
  manifest_sha256, observed_at, claim_proposition, coverage_state
) select
  policy.get_regulatory_change_candidate_manifest(
    'version:change-test:before', 'version:change-test:after'
  )->>'manifestSha256',
  now(),
  (select proposition from policy.legal_claims where claim_id = 'claim:change-test:1'),
  (select coverage_state from policy.coverage_scopes where jurisdiction_code = 'EEA');

grant select on change_test_state to service_role;

select ok(has_function_privilege(
  'service_role', 'policy.get_regulatory_change_candidate_manifest(text,text)', 'EXECUTE'
), 'service role can prepare a change candidate manifest');
select ok(not has_table_privilege(
  'service_role', 'regulatory.regulatory_events', 'INSERT'
), 'service role cannot directly insert regulatory events');
select ok(not has_table_privilege(
  'service_role', 'regulatory.regulatory_events', 'UPDATE'
), 'service role cannot directly publish regulatory events');
select ok(not has_table_privilege(
  'service_role', 'policy.event_claim_impacts', 'INSERT'
), 'service role cannot directly insert claim impacts');
select ok(not has_table_privilege(
  'service_role', 'policy.event_claim_impacts', 'UPDATE'
), 'service role cannot directly review claim impacts');
select ok(not has_table_privilege(
  'service_role', 'regulatory.regulatory_event_review_records', 'INSERT'
), 'service role cannot directly insert event review audit rows');
select ok(not has_table_privilege(
  'service_role', 'policy.event_claim_impact_review_records', 'INSERT'
), 'service role cannot directly insert impact review audit rows');
select ok(has_function_privilege(
  'service_role', 'policy.get_regulatory_change_backup_metadata()', 'EXECUTE'
), 'service role can export private change audit metadata for backup');
select ok(not has_function_privilege(
  'anon', 'policy.get_regulatory_change_backup_metadata()', 'EXECUTE'
), 'anonymous callers cannot export private change audit metadata');

set local role service_role;
select is(
  jsonb_array_length(policy.get_regulatory_change_candidate_manifest(
    'version:change-test:before', 'version:change-test:after'
  )->'manifest'->'provisionChanges'),
  3,
  'manifest deterministically identifies modified, removed and added provisions'
);
select is(
  jsonb_array_length(policy.get_regulatory_change_candidate_manifest(
    'version:change-test:before', 'version:change-test:after'
  )->'manifest'->'claimCandidates'),
  1,
  'manifest identifies claims citing the before version'
);
select ok(
  policy.get_regulatory_change_candidate_manifest(
    'version:change-test:before', 'version:change-test:after'
  )::text !~* 'proposition|reviewer_ref|private_notes',
  'candidate manifest excludes claim and reviewer-private content'
);
select throws_ok(
  $sql$select policy.create_regulatory_event_candidate(
    'event:change-test:stale', 'version:change-test:before',
    'version:change-test:after', 'AMENDMENT', 'Sanitized amendment',
    now(), null, repeat('0', 64)
  )$sql$,
  'P0001', 'regulatory change manifest checksum mismatch',
  'stale candidate fingerprint is rejected'
);
select is(
  (select count(*)::integer from regulatory.regulatory_events), 0,
  'rejected candidate writes no event'
);
select lives_ok(
  $sql$select policy.create_regulatory_event_candidate(
    'event:change-test:1', 'version:change-test:before',
    'version:change-test:after', 'AMENDMENT', 'Sanitized amendment',
    (select observed_at from change_test_state), null,
    (select manifest_sha256 from change_test_state)
  )$sql$,
  'current manifest creates a candidate event'
);
select is(
  (select event_state from regulatory.regulatory_events
   where event_id = 'event:change-test:1'),
  'CANDIDATE', 'automated candidate creation cannot review or publish an event'
);
select is(
  (select concat_ws(':', impact_type, review_state)
   from policy.event_claim_impacts
   where event_id = 'event:change-test:1' and claim_id = 'claim:change-test:1'),
  'MAY_AFFECT:PENDING', 'automatic claim impact remains a pending suggestion'
);
select lives_ok(
  $sql$select policy.create_regulatory_event_candidate(
    'event:change-test:1', 'version:change-test:before',
    'version:change-test:after', 'AMENDMENT', 'Sanitized amendment',
    (select observed_at from change_test_state), null,
    (select manifest_sha256 from change_test_state)
  )$sql$,
  'identical candidate replay is idempotent'
);
select throws_ok(
  $sql$select policy.review_regulatory_event(
    'event-review:change-test:machine', 'event:change-test:1', 'APPROVED',
    'Automated reviewer', 'llm', (select manifest_sha256 from change_test_state),
    now(), null
  )$sql$,
  'P0001', 'regulatory event review requires an identified human reviewer',
  'automated event reviewer is rejected'
);
select is(
  (select count(*)::integer from regulatory.regulatory_event_review_records),
  0, 'rejected event review writes no audit record'
);
select lives_ok(
  $sql$select policy.review_regulatory_event(
    'event-review:change-test:human', 'event:change-test:1', 'APPROVED',
    'Legal reviewer', 'reviewer:test:event',
    (select manifest_sha256 from change_test_state), now(), null
  )$sql$,
  'named-human event review succeeds'
);
select throws_ok(
  $sql$select policy.publish_regulatory_event(
    'event:change-test:1', (select manifest_sha256 from change_test_state), now()
  )$sql$,
  'P0001', 'all regulatory event impacts require human disposition',
  'pending claim impact blocks publication'
);
select throws_ok(
  $sql$select policy.review_regulatory_event_impact(
    'impact-review:change-test:machine', 'event:change-test:1',
    'claim:change-test:1', 'REVIEWED', 'INVALIDATES',
    'Automated reviewer', 'automation',
    (select manifest_sha256 from change_test_state), now(), null
  )$sql$,
  'P0001', 'regulatory event impact review requires an identified human reviewer',
  'automated impact reviewer is rejected'
);
select is(
  (select count(*)::integer from policy.event_claim_impact_review_records),
  0, 'rejected impact review writes no audit record'
);
select lives_ok(
  $sql$select policy.review_regulatory_event_impact(
    'impact-review:change-test:human', 'event:change-test:1',
    'claim:change-test:1', 'REVIEWED', 'INVALIDATES',
    'Legal reviewer', 'reviewer:test:impact',
    (select manifest_sha256 from change_test_state), now(), null
  )$sql$,
  'named-human impact review succeeds'
);
select throws_ok(
  $sql$select policy.publish_regulatory_event(
    'event:change-test:1', repeat('0', 64), now()
  )$sql$,
  'P0001', 'regulatory change manifest checksum mismatch',
  'stale publication fingerprint is rejected'
);
select lives_ok(
  $sql$select policy.publish_regulatory_event(
    'event:change-test:1', (select manifest_sha256 from change_test_state), now()
  )$sql$,
  'currently approved event and impact publish atomically'
);
select is(
  (select event_state from regulatory.regulatory_events
   where event_id = 'event:change-test:1'),
  'PUBLISHED', 'human-reviewed regulatory event reaches PUBLISHED'
);
select is(
  (select proposition from policy.legal_claims where claim_id = 'claim:change-test:1'),
  (select claim_proposition from change_test_state),
  'change pipeline does not modify claim content'
);
select is(
  (select coverage_state from policy.coverage_scopes where jurisdiction_code = 'EEA'),
  (select coverage_state from change_test_state),
  'change pipeline does not modify coverage state'
);
select is(
  (select count(*)::integer from policy.public_regulatory_changes
   where event_id = 'event:change-test:1'),
  0, 'event stays private until the impacted claim belongs to a published corpus'
);
reset role;
select throws_ok(
  $sql$update regulatory.regulatory_event_review_records
    set private_notes = 'changed'
    where event_review_id = 'event-review:change-test:human'$sql$,
  'P0001', 'regulatory_event_review_records rows are immutable; create a new version',
  'event review audit record is immutable'
);

select * from finish();
rollback;
