begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, policy, regulatory;
select plan(17);

select ok(
  has_function_privilege(
    'service_role', 'policy.get_legal_corpus_review_queue(text,integer)',
    'EXECUTE'
  ),
  'service role can read the private human review queue'
);
select ok(
  not has_function_privilege(
    'anon', 'policy.get_legal_corpus_review_queue(text,integer)', 'EXECUTE'
  ),
  'anonymous callers cannot read the private human review queue'
);

set local role service_role;
select is(
  (policy.get_legal_corpus_review_queue('EEA', 100)
    ->>'totalTaskCount')::integer,
  0,
  'an empty jurisdiction has no invented review tasks'
);
select is(
  (policy.get_legal_corpus_review_queue('EEA', 100)
    ->>'humanReviewRequired')::boolean,
  true,
  'queue explicitly requires human review'
);
select is(
  (policy.get_legal_corpus_review_queue('EEA', 100)
    ->>'automaticApprovalAllowed')::boolean,
  false,
  'queue never grants automatic approval authority'
);
reset role;

insert into policy.storage_objects (
  object_id, provider, bucket, object_key, checksum_sha256, byte_size,
  content_type, encryption_state
) values (
  'object:queue-test:1', 'supabase', 'policy-sources',
  'tests/queue/source.bin', repeat('c', 64), 64,
  'application/octet-stream', 'PROVIDER_ENCRYPTED'
);
insert into regulatory.source_authorities (
  authority_id, name, jurisdiction_code, authority_type, official_domains
) values (
  'authority:queue-test', 'Queue Test Authority', 'EEA',
  'OFFICIAL_REGISTER', array['official.example.test']
);
insert into regulatory.source_documents (
  document_id, authority_id, official_document_id, document_type, title,
  canonical_url, language_codes, redistribution_rights
) values (
  'document:queue-test', 'authority:queue-test', 'QUEUE-TEST-1',
  'REGULATION', 'Sanitized Queue Test Instrument',
  'https://official.example.test/queue', array['en'], 'LINK_ONLY'
);
insert into regulatory.source_versions (
  version_id, document_id, version_label, raw_object_id, checksum_sha256,
  official_url, observed_at, retrieved_at, storage_rights
) values (
  'version:queue-test:1', 'document:queue-test', 'v1',
  'object:queue-test:1', repeat('d', 64),
  'https://official.example.test/queue/v1', now(), now(),
  'REVIEW_REQUIRED'
);
insert into regulatory.provisions (
  provision_id, version_id, locator, language_code, text_checksum_sha256,
  ordinal, excerpt_permission
) values (
  'provision:queue-test:1', 'version:queue-test:1', 'Article 1',
  'en', repeat('e', 64), 1, 'UNKNOWN'
);
insert into policy.legal_claims (
  claim_id, jurisdiction_code, topic, proposition, legal_status,
  effective_from, knowledge_cutoff
) values (
  'claim:queue-test:1', 'EEA', 'sanitized-topic',
  'Private sanitized proposition.', 'UNDETERMINED', now(), now()
);
insert into policy.citations (
  citation_id, claim_id, provision_id, support_relation, exact_locator
) values (
  'citation:queue-test:1', 'claim:queue-test:1',
  'provision:queue-test:1', 'DIRECT_SUPPORT', 'Article 1'
);
insert into policy.corpus_releases (
  release_id, as_of, knowledge_cutoff, manifest_checksum_sha256,
  release_state
) values (
  'corpus:queue-test:1', now(), now(), repeat('0', 64), 'DRAFT'
);
insert into policy.corpus_release_claims (release_id, claim_id) values (
  'corpus:queue-test:1', 'claim:queue-test:1'
);

set local role service_role;
select is(
  (policy.get_legal_corpus_review_queue('EEA', 100)
    ->>'totalTaskCount')::integer,
  3,
  'queue projects source, claim and release tasks'
);
select is(
  policy.get_legal_corpus_review_queue('EEA', 100)
    ->'tasks'->0->>'taskType',
  'SOURCE_VERIFICATION',
  'source verification tasks have first priority'
);
select is(
  policy.get_legal_corpus_review_queue('EEA', 100)
    ->'tasks'->1->>'taskType',
  'CLAIM_REVIEW',
  'claim review tasks follow source tasks'
);
select is(
  policy.get_legal_corpus_review_queue('EEA', 100)
    ->'tasks'->2->>'taskType',
  'CORPUS_RELEASE_REVIEW',
  'corpus release tasks follow claim tasks'
);
select ok(
  policy.get_legal_corpus_review_queue('EEA', 100)
    ->'tasks'->0->'readinessErrors' ? 'storage_rights_not_allowed',
  'source task reports storage-rights blocker'
);
select ok(
  policy.get_legal_corpus_review_queue('EEA', 100)
    ->'tasks'->1->'readinessErrors' ? 'unverified_source',
  'claim task reports unverified evidence'
);
select ok(
  policy.get_legal_corpus_review_queue('EEA', 100)
    ->'tasks'->2->'readinessErrors' ? 'unreviewed_claim',
  'release task reports unreviewed membership'
);
select is(
  (policy.get_legal_corpus_review_queue('EEA', 1)
    ->>'returnedTaskCount')::integer,
  1,
  'queue enforces its response limit'
);
select is(
  (policy.get_legal_corpus_review_queue('EEA', 1)
    ->>'totalTaskCount')::integer,
  3,
  'limited queue preserves the total task count'
);
select ok(
  policy.get_legal_corpus_review_queue('EEA', 100)::text
    !~* 'proposition|reviewer_ref|private_notes',
  'queue exposes no proposition or reviewer-private fields'
);
select is(
  (
    (select count(*) from regulatory.source_verification_records)
    + (select count(*) from policy.review_records)
    + (select count(*) from policy.corpus_release_review_records)
    + (select count(*) from policy.coverage_review_records)
  )::integer,
  0,
  'reading the queue creates no review audit state'
);
select throws_ok(
  $sql$select policy.get_legal_corpus_review_queue('EEA', 0)$sql$,
  'P0001',
  'review queue limit must be between 1 and 200',
  'invalid queue limits fail closed'
);

select * from finish();
rollback;
