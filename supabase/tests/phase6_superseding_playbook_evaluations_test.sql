begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, policy, regulatory;

select plan(48);

insert into policy.storage_objects (
  object_id, provider, bucket, object_key, checksum_sha256, byte_size,
  content_type, encryption_state
) values
  ('object:superseding-test:source', 'supabase-storage', 'policy-sources',
   'tests/superseding/source.json', repeat('1', 64), 100,
   'application/json', 'PROVIDER_ENCRYPTED'),
  ('object:superseding-test:base', 'supabase-storage', 'policy-playbooks',
   'tests/superseding/base.json', repeat('2', 64), 100,
   'application/json', 'PROVIDER_ENCRYPTED');

insert into regulatory.source_authorities (
  authority_id, name, jurisdiction_code, authority_type, official_domains
) values (
  'authority:superseding-test', 'Sanitized Superseding Test Authority', 'EEA',
  'REGULATOR', array['official.superseding.test']
);

insert into regulatory.source_documents (
  document_id, authority_id, official_document_id, document_type, title,
  canonical_url, language_codes, redistribution_rights
) values (
  'document:superseding-test', 'authority:superseding-test',
  'SUPERSEDING-TEST-1', 'REGULATION', 'Sanitized Superseding Instrument',
  'https://official.superseding.test/instrument', array['en'], 'LINK_ONLY'
);

insert into regulatory.source_versions (
  version_id, document_id, version_label, raw_object_id, checksum_sha256,
  official_url, observed_at, retrieved_at, lifecycle_state
) values (
  'version:superseding-test:1', 'document:superseding-test', 'test-v1',
  'object:superseding-test:source', repeat('3', 64),
  'https://official.superseding.test/instrument/v1', now(), now(), 'VERIFIED'
);

insert into policy.legal_claims (
  claim_id, jurisdiction_code, topic, proposition, legal_status,
  review_state, effective_from, knowledge_cutoff
) values (
  'claim:superseding-test:matching', 'EEA', 'sanitized-superseding-topic',
  'Sanitized superseding claim.', 'UNDETERMINED', 'PUBLISHED', now(), now()
);

insert into policy.machine_assurance_records (
  record_id, subject_type, subject_id, assurance_level,
  source_version_fingerprint, claim_fingerprint,
  model, prompt_template_id, prompt_template_version, parameters_version,
  confidence, checks, input_checksum_sha256, output_checksum_sha256,
  blockers, limitations, outcome
) values (
  'record:superseding-test:crosscheck', 'CLAIM_DRAFT',
  'claim:superseding-test:matching', 'AI_CROSS_CHECKED', repeat('4', 64),
  repeat('5', 64), 'sanitized-test-model', 'superseding-test', '1', '1', 0.99,
  '{"contradiction":"PASS","freshness":"PASS","rights":"PASS","jurisdiction":"PASS","effectiveDates":"PASS","citationLocator":"PASS"}'::jsonb,
  repeat('6', 64), repeat('7', 64), '{}'::text[], '{}'::text[], 'ADVANCED'
);

insert into policy.provisional_corpus_releases (
  release_id, jurisdiction_code, as_of, knowledge_cutoff, manifest_sha256,
  published_at
) values (
  'provisional:superseding-test:eea:1', 'EEA', now(), now(), repeat('8', 64),
  now()
);

insert into policy.provisional_release_claims (
  release_id, claim_id, claim_fingerprint, assurance_record_id
) values (
  'provisional:superseding-test:eea:1',
  'claim:superseding-test:matching', repeat('5', 64),
  'record:superseding-test:crosscheck'
);

insert into policy.playbook_packages (
  package_id, playbook_id, profile_fingerprint, artifact_object_id,
  artifact_checksum_sha256, integrity_sha256, schema_version, evaluated_at,
  assurance_review_status, corpus_release_id, retrieval_index_release_id,
  dossier_id, rules_version, template_version
) values (
  'package:stablecoin-pre-listing:aaaaaaaaaaaaaaaa',
  'stablecoin-pre-listing', repeat('a', 64),
  'object:superseding-test:base', repeat('2', 64), repeat('9', 64),
  '1.1.0', now(), 'PROVISIONAL', 'provisional:superseding-test:eea:1', null,
  'usdc-eea', '1.0.0', '1.0.0'
);

insert into policy.playbook_package_claim_dependencies (
  package_id, claim_id, dependency_basis
) values (
  'package:stablecoin-pre-listing:aaaaaaaaaaaaaaaa',
  'claim:superseding-test:matching', 'DECISION_EVIDENCE'
);

select policy.create_playbook_package_watchlist(
  'package:stablecoin-pre-listing:aaaaaaaaaaaaaaaa'
);

insert into regulatory.regulatory_events (
  event_id, authority_id, after_version_id, event_type, title, observed_at,
  event_state, reviewed_at
) values
  ('event:superseding-test:first', 'authority:superseding-test',
   'version:superseding-test:1', 'AMENDMENT', 'Sanitized first change', now(),
   'REVIEWED', now()),
  ('event:superseding-test:second', 'authority:superseding-test',
   'version:superseding-test:1', 'CORRECTION', 'Sanitized second change', now(),
   'REVIEWED', now()),
  ('event:superseding-test:after', 'authority:superseding-test',
   'version:superseding-test:1', 'AMENDMENT', 'Sanitized later change', now(),
   'REVIEWED', now());

insert into policy.event_claim_impacts (
  event_id, claim_id, impact_type, review_state
) values
  ('event:superseding-test:first', 'claim:superseding-test:matching',
   'MAY_AFFECT', 'REVIEWED'),
  ('event:superseding-test:second', 'claim:superseding-test:matching',
   'INVALIDATES', 'REVIEWED'),
  ('event:superseding-test:after', 'claim:superseding-test:matching',
   'MAY_AFFECT', 'REVIEWED');

update regulatory.regulatory_events
set event_state = 'PUBLISHED', published_at = now()
where event_id = 'event:superseding-test:first';

select ok(
  not has_table_privilege(
    'service_role', 'policy.playbook_package_rerun_attempts', 'SELECT'
  ),
  'service role cannot bypass rerun attempt RPCs'
);
select ok(
  not has_table_privilege(
    'service_role', 'policy.playbook_package_lineage', 'INSERT'
  ),
  'service role cannot write package lineage directly'
);
select ok(
  not has_table_privilege(
    'service_role', 'policy.playbook_package_delta_coverage', 'INSERT'
  ),
  'service role cannot write delta coverage directly'
);
select ok(
  not has_function_privilege(
    'anon',
    'policy.claim_superseding_playbook_evaluation(text,text,text,text[],text,text)',
    'EXECUTE'
  ),
  'anonymous callers cannot claim paid reruns'
);
select ok(
  has_function_privilege(
    'service_role',
    'policy.claim_superseding_playbook_evaluation(text,text,text,text[],text,text)',
    'EXECUTE'
  ),
  'service role can claim reruns through the controlled RPC'
);
select ok(
  not has_function_privilege(
    'anon', 'policy.get_playbook_monitoring_backup_metadata()', 'EXECUTE'
  ),
  'anonymous callers cannot export private monitoring metadata'
);
select ok(
  has_function_privilege(
    'service_role', 'policy.get_playbook_monitoring_backup_metadata()', 'EXECUTE'
  ),
  'service role can export private monitoring metadata through one RPC'
);

create temporary table superseding_test_context as
select delta_id as first_delta_id
from policy.playbook_watchlist_change_deltas
where event_id = 'event:superseding-test:first';
grant select on superseding_test_context to service_role;

set local role service_role;

select is(
  policy.claim_superseding_playbook_evaluation(
    'package:stablecoin-pre-listing:ffffffffffffffff',
    'stablecoin-pre-listing', repeat('a', 64),
    array[(select first_delta_id from superseding_test_context)],
    repeat('b', 64), repeat('c', 64)
  )->>'status',
  'NOT_FOUND',
  'an unknown base package returns a typed not-found outcome'
);
select is(
  policy.claim_superseding_playbook_evaluation(
    'package:stablecoin-pre-listing:aaaaaaaaaaaaaaaa',
    'stablecoin-pre-listing', repeat('f', 64),
    array[(select first_delta_id from superseding_test_context)],
    repeat('d', 64), repeat('e', 64)
  )->>'status',
  'PROFILE_MISMATCH',
  'a mismatched resubmitted Business Profile fails closed'
);
select is(
  policy.claim_superseding_playbook_evaluation(
    'package:stablecoin-pre-listing:aaaaaaaaaaaaaaaa',
    'business-model-regulatory-boundary', repeat('a', 64),
    array[(select first_delta_id from superseding_test_context)],
    repeat('f', 64), repeat('1', 64)
  )->>'status',
  'PLAYBOOK_MISMATCH',
  'a rerun cannot change the base package playbook'
);
select is(
  policy.claim_superseding_playbook_evaluation(
    'package:stablecoin-pre-listing:aaaaaaaaaaaaaaaa',
    'stablecoin-pre-listing', repeat('a', 64),
    array['delta:ffffffffffffffffffffffffffffffff'],
    repeat('1', 64), repeat('2', 64)
  )->>'status',
  'DELTA_SNAPSHOT_MISMATCH',
  'a foreign or incomplete delta snapshot fails closed'
);
select is(
  policy.claim_superseding_playbook_evaluation(
    'package:stablecoin-pre-listing:aaaaaaaaaaaaaaaa',
    'stablecoin-pre-listing', repeat('a', 64),
    array[(select first_delta_id from superseding_test_context)],
    repeat('3', 64), repeat('4', 64)
  )->>'status',
  'CLAIMED',
  'the exact package, profile, and pending delta snapshot can be claimed'
);
select is(
  policy.claim_superseding_playbook_evaluation(
    'package:stablecoin-pre-listing:aaaaaaaaaaaaaaaa',
    'stablecoin-pre-listing', repeat('a', 64),
    array[(select first_delta_id from superseding_test_context)],
    repeat('3', 64), repeat('4', 64)
  )->>'status',
  'PENDING',
  'an overlapping exact retry observes the active lease'
);

reset role;

update regulatory.regulatory_events
set event_state = 'PUBLISHED', published_at = now()
where event_id = 'event:superseding-test:second';

create temporary table stale_attempt as
select rerun_id
from policy.playbook_package_rerun_attempts
where idempotency_key_sha256 = repeat('3', 64);
grant select on stale_attempt to service_role;

set local role service_role;

select is(
  policy.complete_superseding_playbook_evaluation(
    (select rerun_id from stale_attempt),
    'object:playbook-package:' || left(repeat('b', 64), 32),
    'supabase-storage', 'policy-playbooks',
    'packages/stablecoin-pre-listing/' || repeat('b', 64) || '.json',
    repeat('c', 64), 200, 'application/json',
    'package:stablecoin-pre-listing:bbbbbbbbbbbbbbbb',
    'stablecoin-pre-listing', repeat('a', 64), repeat('b', 64), '1.1.0',
    now(), 'PROVISIONAL', 'provisional:superseding-test:eea:1', null,
    'usdc-eea', '1.0.0', '1.0.0', repeat('3', 64), repeat('4', 64),
    array['claim:superseding-test:matching']
  )->>'status',
  'STALE',
  'a delta arriving after claim prevents stale completion'
);

reset role;

select is(
  (select rerun_state from policy.playbook_package_rerun_attempts
   where idempotency_key_sha256 = repeat('3', 64)),
  'STALE',
  'the rejected stale attempt is preserved for audit'
);
select is(
  (select count(*)::integer from policy.playbook_package_lineage),
  0,
  'stale completion creates no lineage'
);
select is(
  (select count(*)::integer from policy.playbook_packages
   where package_id = 'package:stablecoin-pre-listing:bbbbbbbbbbbbbbbb'),
  0,
  'stale completion registers no successor package metadata'
);
select is(
  (select count(*)::integer from policy.playbook_package_delta_coverage),
  0,
  'stale completion creates no delta coverage'
);
select is(
  (select count(*)::integer from policy.playbook_package_claim_dependencies
   where package_id = 'package:stablecoin-pre-listing:bbbbbbbbbbbbbbbb'),
  0,
  'stale completion creates no successor dependencies'
);
select is(
  (select count(*)::integer from policy.playbook_package_watchlists
   where package_id = 'package:stablecoin-pre-listing:bbbbbbbbbbbbbbbb'),
  0,
  'stale completion creates no successor watchlist'
);
select is(
  (select count(*)::integer from policy.storage_objects
   where object_id = 'object:playbook-package:' || left(repeat('b', 64), 32)),
  0,
  'stale completion creates no successor storage metadata'
);

create temporary table refreshed_snapshot as
select array_agg(delta_id order by delta_id) as delta_ids
from policy.playbook_watchlist_change_deltas;
grant select on refreshed_snapshot to service_role;

set local role service_role;

select is(
  policy.claim_superseding_playbook_evaluation(
    'package:stablecoin-pre-listing:aaaaaaaaaaaaaaaa',
    'stablecoin-pre-listing', repeat('a', 64),
    (select delta_ids from refreshed_snapshot),
    repeat('5', 64), repeat('6', 64)
  )->>'status',
  'CLAIMED',
  'a new request fingerprint can claim the refreshed full snapshot'
);

reset role;

create temporary table refreshed_attempt as
select rerun_id
from policy.playbook_package_rerun_attempts
where idempotency_key_sha256 = repeat('5', 64);
grant select on refreshed_attempt to service_role;

savepoint injected_completion_failure;

insert into policy.storage_objects (
  object_id, provider, bucket, object_key, checksum_sha256, byte_size,
  content_type, encryption_state
) values (
  'object:superseding-test:blocker', 'supabase-storage', 'policy-playbooks',
  'tests/superseding/blocker.json', repeat('d', 64), 100,
  'application/json', 'PROVIDER_ENCRYPTED'
);

insert into policy.playbook_packages (
  package_id, playbook_id, profile_fingerprint, artifact_object_id,
  artifact_checksum_sha256, integrity_sha256, schema_version, evaluated_at,
  assurance_review_status, corpus_release_id, retrieval_index_release_id,
  dossier_id, rules_version, template_version
) values (
  'package:stablecoin-pre-listing:cccccccccccccccc',
  'stablecoin-pre-listing', repeat('a', 64),
  'object:superseding-test:blocker', repeat('d', 64), repeat('e', 64),
  '1.1.0', now(), 'PROVISIONAL', 'provisional:superseding-test:eea:1', null,
  'usdc-eea', '1.0.0', '1.0.0'
);

insert into policy.playbook_package_claim_dependencies (
  package_id, claim_id, dependency_basis
) values (
  'package:stablecoin-pre-listing:cccccccccccccccc',
  'claim:superseding-test:matching', 'DECISION_EVIDENCE'
);

insert into policy.playbook_package_watchlists (
  watchlist_id, package_id, watchlist_state
) values (
  'watchlist:' || substr(encode(extensions.digest(convert_to(
    'playbook-watchlist-v1:package:stablecoin-pre-listing:bbbbbbbbbbbbbbbb',
    'UTF8'
  ), 'sha256'), 'hex'), 1, 32),
  'package:stablecoin-pre-listing:cccccccccccccccc', 'ACTIVE'
);

set local role service_role;

select throws_ok(
  $sql$
    select policy.complete_superseding_playbook_evaluation(
      (select rerun_id from refreshed_attempt),
      'object:playbook-package:' || left(repeat('b', 64), 32),
      'supabase-storage', 'policy-playbooks',
      'packages/stablecoin-pre-listing/' || repeat('b', 64) || '.json',
      repeat('c', 64), 200, 'application/json',
      'package:stablecoin-pre-listing:bbbbbbbbbbbbbbbb',
      'stablecoin-pre-listing', repeat('a', 64), repeat('b', 64), '1.1.0',
      now(), 'PROVISIONAL', 'provisional:superseding-test:eea:1', null,
      'usdc-eea', '1.0.0', '1.0.0', repeat('5', 64), repeat('6', 64),
      array['claim:superseding-test:matching']
    )
  $sql$,
  'query returned no rows',
  'a late successor watchlist failure aborts completion'
);

reset role;

select is(
  (select count(*)::integer from policy.playbook_packages
   where package_id = 'package:stablecoin-pre-listing:bbbbbbbbbbbbbbbb'),
  0,
  'failed completion rolls back successor package metadata'
);
select is(
  (select count(*)::integer from policy.storage_objects
   where object_id = 'object:playbook-package:' || left(repeat('b', 64), 32)),
  0,
  'failed completion rolls back successor storage metadata'
);
select is(
  (select count(*)::integer from policy.playbook_package_lineage),
  0,
  'failed completion rolls back lineage'
);
select is(
  (select count(*)::integer from policy.playbook_package_delta_coverage),
  0,
  'failed completion rolls back delta coverage'
);
select is(
  (select watchlist_state from policy.playbook_package_watchlists
   where package_id = 'package:stablecoin-pre-listing:aaaaaaaaaaaaaaaa'),
  'ACTIVE',
  'failed completion restores the base watchlist state'
);
select is(
  (select state from policy.playbook_package_idempotency
   where idempotency_key_sha256 = repeat('5', 64)),
  'PENDING',
  'failed completion leaves the idempotency record retryable'
);
select is(
  (select rerun_state from policy.playbook_package_rerun_attempts
   where idempotency_key_sha256 = repeat('5', 64)),
  'CLAIMED',
  'failed completion leaves the rerun claim retryable'
);
select is(
  (select count(*)::integer from policy.playbook_package_watchlists
   where package_id = 'package:stablecoin-pre-listing:bbbbbbbbbbbbbbbb'),
  0,
  'failed completion rolls back the successor watchlist'
);
select is(
  (select count(*)::integer from policy.playbook_package_claim_dependencies
   where package_id = 'package:stablecoin-pre-listing:bbbbbbbbbbbbbbbb'),
  0,
  'failed completion rolls back successor dependencies'
);

rollback to savepoint injected_completion_failure;

set local role service_role;

select is(
  policy.complete_superseding_playbook_evaluation(
    (select rerun_id from refreshed_attempt),
    'object:playbook-package:' || left(repeat('b', 64), 32),
    'supabase-storage', 'policy-playbooks',
    'packages/stablecoin-pre-listing/' || repeat('b', 64) || '.json',
    repeat('c', 64), 200, 'application/json',
    'package:stablecoin-pre-listing:bbbbbbbbbbbbbbbb',
    'stablecoin-pre-listing', repeat('a', 64), repeat('b', 64), '1.1.0',
    now(), 'PROVISIONAL', 'provisional:superseding-test:eea:1', null,
    'usdc-eea', '1.0.0', '1.0.0', repeat('5', 64), repeat('6', 64),
    array['claim:superseding-test:matching']
  )->>'status',
  'COMPLETED',
  'the refreshed exact snapshot completes one successor atomically'
);
select is(
  policy.claim_superseding_playbook_evaluation(
    'package:stablecoin-pre-listing:aaaaaaaaaaaaaaaa',
    'stablecoin-pre-listing', repeat('a', 64),
    (select delta_ids from refreshed_snapshot),
    repeat('5', 64), repeat('6', 64)
  )->>'packageId',
  'package:stablecoin-pre-listing:bbbbbbbbbbbbbbbb',
  'an exact completed replay returns the same successor identity'
);
select throws_ok(
  $sql$
    select policy.claim_superseding_playbook_evaluation(
      'package:stablecoin-pre-listing:aaaaaaaaaaaaaaaa',
      'stablecoin-pre-listing', repeat('a', 64),
      (select delta_ids from refreshed_snapshot),
      repeat('5', 64), repeat('7', 64)
    )
  $sql$,
  'playbook idempotency key conflict',
  'changed request reuse of a completed key conflicts'
);

reset role;

select is(
  (select watchlist_state from policy.playbook_package_watchlists
   where package_id = 'package:stablecoin-pre-listing:aaaaaaaaaaaaaaaa'),
  'SUPERSEDED',
  'completion supersedes the base package watchlist'
);
select is(
  (select watchlist_state from policy.playbook_package_watchlists
   where package_id = 'package:stablecoin-pre-listing:bbbbbbbbbbbbbbbb'),
  'ACTIVE',
  'completion activates one successor package watchlist'
);
select is(
  (select count(*)::integer from policy.playbook_package_lineage),
  1,
  'completion records exactly one immutable lineage edge'
);
select is(
  (select count(*)::integer from policy.playbook_package_delta_coverage),
  2,
  'completion covers the complete claimed pending delta snapshot'
);
select is(
  (select count(distinct successor_package_id)::integer
   from policy.playbook_package_delta_coverage),
  1,
  'all covered deltas point to the same successor package'
);
select is(
  (select state from policy.playbook_package_idempotency
   where idempotency_key_sha256 = repeat('5', 64)),
  'COMPLETED',
  'successor persistence completes the shared idempotency record'
);
select is(
  (select count(*)::integer from policy.playbook_package_claim_dependencies
   where package_id = 'package:stablecoin-pre-listing:bbbbbbbbbbbbbbbb'),
  1,
  'successor persistence registers exact decision-evidence dependencies'
);
select is(
  jsonb_array_length(
    policy.get_playbook_monitoring_backup_metadata()->'playbookPackageLineage'
  ),
  1,
  'operator backup includes the immutable successor lineage'
);
select throws_ok(
  $sql$
    update policy.playbook_package_watchlists
    set watchlist_state = 'ACTIVE'
    where package_id = 'package:stablecoin-pre-listing:aaaaaaaaaaaaaaaa'
  $sql$,
  'playbook package watchlist transition is not allowed',
  'a superseded watchlist cannot be reactivated directly'
);
select throws_ok(
  $sql$
    update policy.playbook_package_rerun_attempts
    set rerun_state = 'STALE'
    where rerun_state = 'COMPLETED'
  $sql$,
  'playbook package rerun transition is not allowed',
  'a completed rerun audit cannot be rewritten'
);

update regulatory.regulatory_events
set event_state = 'PUBLISHED', published_at = now()
where event_id = 'event:superseding-test:after';

select is(
  (select count(*)::integer
   from policy.playbook_watchlist_change_deltas
   where package_id = 'package:stablecoin-pre-listing:aaaaaaaaaaaaaaaa'),
  2,
  'a superseded base watchlist receives no later delta'
);
select is(
  (select count(*)::integer
   from policy.playbook_watchlist_change_deltas
   where package_id = 'package:stablecoin-pre-listing:bbbbbbbbbbbbbbbb'),
  1,
  'the active successor watchlist receives the later matching delta'
);
select ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'policy'
      and table_name in (
        'playbook_package_rerun_attempts', 'playbook_package_lineage',
        'playbook_package_delta_coverage'
      )
      and column_name in (
        'customer_id', 'account_id', 'subscription_id', 'entitlement_id',
        'profile', 'webhook_url', 'webhook_secret', 'prompt', 'raw_rule',
        'artifact_body'
      )
  ),
  'rerun persistence stores no customer, raw profile, delivery, rule, prompt, or artifact body'
);

select * from finish();
rollback;
