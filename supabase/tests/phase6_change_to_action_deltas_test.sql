begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, policy, regulatory;

select plan(36);

insert into policy.storage_objects (
  object_id, provider, bucket, object_key, checksum_sha256, byte_size,
  content_type, encryption_state
) values
  ('object:delta-test:source', 'supabase-storage', 'policy-sources',
   'tests/deltas/source.json', repeat('1', 64), 100,
   'application/json', 'PROVIDER_ENCRYPTED'),
  ('object:delta-test:package', 'supabase-storage', 'policy-playbooks',
   'tests/deltas/package.json', repeat('2', 64), 100,
   'application/json', 'PROVIDER_ENCRYPTED');

insert into regulatory.source_authorities (
  authority_id, name, jurisdiction_code, authority_type, official_domains
) values (
  'authority:delta-test', 'Sanitized Delta Test Authority', 'EEA',
  'REGULATOR', array['official.delta.test']
);

insert into regulatory.source_documents (
  document_id, authority_id, official_document_id, document_type, title,
  canonical_url, language_codes, redistribution_rights
) values (
  'document:delta-test', 'authority:delta-test', 'DELTA-TEST-1',
  'REGULATION', 'Sanitized Delta Test Instrument',
  'https://official.delta.test/instrument', array['en'], 'LINK_ONLY'
);

insert into regulatory.source_versions (
  version_id, document_id, version_label, raw_object_id, checksum_sha256,
  official_url, observed_at, retrieved_at, lifecycle_state
) values (
  'version:delta-test:1', 'document:delta-test', 'test-v1',
  'object:delta-test:source', repeat('3', 64),
  'https://official.delta.test/instrument/v1', now(), now(), 'VERIFIED'
);

insert into policy.legal_claims (
  claim_id, jurisdiction_code, topic, proposition, legal_status,
  review_state, effective_from, knowledge_cutoff
) values
  ('claim:delta-test:first', 'EEA', 'sanitized-delta-topic',
   'Sanitized first delta claim.', 'UNDETERMINED', 'PUBLISHED', now(), now()),
  ('claim:delta-test:second', 'EEA', 'sanitized-delta-topic',
   'Sanitized second delta claim.', 'UNDETERMINED', 'PUBLISHED', now(), now()),
  ('claim:delta-test:unrelated', 'EEA', 'sanitized-other-topic',
   'Sanitized unrelated delta claim.', 'UNDETERMINED', 'PUBLISHED', now(), now());

insert into policy.playbook_packages (
  package_id, playbook_id, profile_fingerprint, artifact_object_id,
  artifact_checksum_sha256, integrity_sha256, schema_version, evaluated_at,
  assurance_review_status, corpus_release_id, retrieval_index_release_id,
  dossier_id, rules_version, template_version
) values (
  'package:stablecoin-pre-listing:dddddddddddddddd',
  'stablecoin-pre-listing', repeat('4', 64),
  'object:delta-test:package', repeat('2', 64), repeat('5', 64),
  '1.1.0', now(), 'PROVISIONAL', null, null,
  'usdc-eea', '1.0.0', '1.0.0'
);

insert into policy.playbook_package_claim_dependencies (
  package_id, claim_id, dependency_basis
) values
  ('package:stablecoin-pre-listing:dddddddddddddddd',
   'claim:delta-test:first', 'DECISION_EVIDENCE'),
  ('package:stablecoin-pre-listing:dddddddddddddddd',
   'claim:delta-test:second', 'DECISION_EVIDENCE');

select policy.create_playbook_package_watchlist(
  'package:stablecoin-pre-listing:dddddddddddddddd'
);

insert into regulatory.regulatory_events (
  event_id, authority_id, after_version_id, event_type, title, observed_at,
  event_state, reviewed_at
) values
  ('event:delta-test:first', 'authority:delta-test', 'version:delta-test:1',
   'AMENDMENT', 'Sanitized first published event', now(), 'REVIEWED', now()),
  ('event:delta-test:second', 'authority:delta-test', 'version:delta-test:1',
   'CORRECTION', 'Sanitized second published event', now(), 'REVIEWED', now()),
  ('event:delta-test:unrelated', 'authority:delta-test', 'version:delta-test:1',
   'AMENDMENT', 'Sanitized unrelated published event', now(), 'REVIEWED', now());

insert into policy.event_claim_impacts (
  event_id, claim_id, impact_type, review_state
) values
  ('event:delta-test:first', 'claim:delta-test:first',
   'MAY_AFFECT', 'REVIEWED'),
  ('event:delta-test:second', 'claim:delta-test:first',
   'INVALIDATES', 'REVIEWED'),
  ('event:delta-test:second', 'claim:delta-test:second',
   'DEADLINE', 'REVIEWED'),
  ('event:delta-test:unrelated', 'claim:delta-test:unrelated',
   'MAY_AFFECT', 'REVIEWED');

select ok(
  not has_table_privilege(
    'anon', 'policy.playbook_watchlist_change_deltas', 'SELECT'
  ),
  'anonymous callers cannot read paid change deltas'
);
select ok(
  not has_table_privilege(
    'authenticated', 'policy.playbook_watchlist_change_deltas', 'SELECT'
  ),
  'authenticated browsers cannot read paid change deltas'
);
select ok(
  not has_table_privilege(
    'service_role', 'policy.playbook_watchlist_change_deltas', 'SELECT'
  ),
  'service role cannot bypass the delta RPC boundary'
);
select ok(
  not has_table_privilege(
    'service_role', 'policy.playbook_watchlist_change_deltas', 'INSERT'
  ),
  'service role cannot insert deltas directly'
);
select ok(
  not has_function_privilege(
    'anon',
    'policy.get_playbook_watchlist_change_deltas(text,bigint,text,integer)',
    'EXECUTE'
  ),
  'anonymous callers cannot poll package deltas'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'policy.get_playbook_watchlist_change_deltas(text,bigint,text,integer)',
    'EXECUTE'
  ),
  'authenticated browsers cannot poll package deltas'
);
select ok(
  has_function_privilege(
    'service_role',
    'policy.get_playbook_watchlist_change_deltas(text,bigint,text,integer)',
    'EXECUTE'
  ),
  'service role can poll through the controlled delta RPC'
);
select ok(
  not has_function_privilege(
    'service_role', 'policy.materialize_playbook_watchlist_change_deltas()',
    'EXECUTE'
  ),
  'service role cannot invoke the trigger function directly'
);

update regulatory.regulatory_events
set event_state = 'PUBLISHED', published_at = now()
where event_id = 'event:delta-test:first';

select is(
  (select count(*)::integer from policy.playbook_watchlist_change_deltas),
  1,
  'publishing one reviewed exact impact atomically creates one delta'
);
select matches(
  (select delta_id from policy.playbook_watchlist_change_deltas),
  '^delta:[0-9a-f]{32}$',
  'the delta receives a deterministic opaque identity'
);
select is(
  (select count(*)::integer from policy.playbook_watchlist_delta_claim_impacts),
  1,
  'the exact reviewed impact is snapshotted with the delta'
);
select is(
  (select actions from policy.playbook_watchlist_change_deltas),
  array['REVIEW_EVIDENCE_CHANGE', 'REQUEST_PLAYBOOK_RERUN']::text[],
  'the delta stores only the approved operational actions'
);
select is(
  (select required_customer_response
   from policy.playbook_watchlist_change_deltas),
  'ACKNOWLEDGE_AND_RERUN',
  'the delta requires acknowledgement and a new playbook run'
);
select is(
  (select package_assurance_review_status
   from policy.playbook_watchlist_change_deltas),
  'PROVISIONAL',
  'the original package assurance is preserved in the snapshot'
);

update regulatory.regulatory_events
set event_state = 'PUBLISHED', published_at = now()
where event_id = 'event:delta-test:unrelated';

select is(
  (select count(*)::integer from policy.playbook_watchlist_change_deltas),
  1,
  'an unrelated reviewed event creates no package delta'
);

update regulatory.regulatory_events
set event_state = 'PUBLISHED', published_at = now()
where event_id = 'event:delta-test:second';

select is(
  (select count(*)::integer from policy.playbook_watchlist_change_deltas),
  2,
  'a second matching publication creates exactly one additional delta'
);
select is(
  (select count(distinct delta_sequence)::integer
   from policy.playbook_watchlist_change_deltas),
  2,
  'materialized deltas have unique monotonic cursor sequences'
);
select is(
  (select count(*)::integer
   from policy.playbook_watchlist_delta_claim_impacts
   where delta_id = (
     select delta_id from policy.playbook_watchlist_change_deltas
     where event_id = 'event:delta-test:second'
   )),
  2,
  'all matching reviewed impacts are frozen in canonical delta evidence'
);

update regulatory.regulatory_events
set event_state = 'PUBLISHED'
where event_id = 'event:delta-test:second';

select is(
  (select count(*)::integer from policy.playbook_watchlist_change_deltas),
  2,
  'replaying a published event transition is idempotent'
);

create temporary table delta_test_cursor_context as
select
  watchlist.watchlist_id,
  min(delta.delta_sequence) as first_sequence,
  max(delta.delta_sequence) as last_sequence
from policy.playbook_package_watchlists watchlist
join policy.playbook_watchlist_change_deltas delta
  on delta.watchlist_id = watchlist.watchlist_id
where watchlist.package_id = 'package:stablecoin-pre-listing:dddddddddddddddd'
group by watchlist.watchlist_id;

grant select on delta_test_cursor_context to service_role;

set local role service_role;

select is(
  policy.get_playbook_watchlist_change_deltas(
    'package:stablecoin-pre-listing:eeeeeeeeeeeeeeee', 0, null, 1
  )->>'status',
  'NOT_FOUND',
  'an unknown package returns a typed not-found outcome'
);
select is(
  jsonb_array_length(policy.get_playbook_watchlist_change_deltas(
    'package:stablecoin-pre-listing:dddddddddddddddd', 0, null, 1
  )->'items'),
  1,
  'the first bounded poll returns one item'
);
select is(
  policy.get_playbook_watchlist_change_deltas(
    'package:stablecoin-pre-listing:dddddddddddddddd', 0, null, 1
  )->>'hasMore',
  'true',
  'the first bounded poll reports the remaining delta'
);
select is(
  (policy.get_playbook_watchlist_change_deltas(
    'package:stablecoin-pre-listing:dddddddddddddddd', 0, null, 1
  )->>'nextSequence')::bigint,
  (select first_sequence from delta_test_cursor_context),
  'the first page advances to its last returned cursor'
);
select is(
  jsonb_array_length(policy.get_playbook_watchlist_change_deltas(
    'package:stablecoin-pre-listing:dddddddddddddddd',
    (select first_sequence from delta_test_cursor_context),
    (select watchlist_id from delta_test_cursor_context),
    1
  )->'items'),
  1,
  'the next cursor returns the second delta without duplication'
);
select is(
  policy.get_playbook_watchlist_change_deltas(
    'package:stablecoin-pre-listing:dddddddddddddddd',
    (select last_sequence from delta_test_cursor_context),
    (select watchlist_id from delta_test_cursor_context),
    1
  )->>'hasMore',
  'false',
  'the final page reports no remaining delta'
);
select is(
  jsonb_array_length(policy.get_playbook_watchlist_change_deltas(
    'package:stablecoin-pre-listing:dddddddddddddddd',
    (select last_sequence from delta_test_cursor_context),
    (select watchlist_id from delta_test_cursor_context),
    1
  )->'items'),
  0,
  'polling the final cursor returns a stable empty page'
);
select is(
  policy.get_playbook_watchlist_change_deltas(
    'package:stablecoin-pre-listing:dddddddddddddddd',
    (select first_sequence from delta_test_cursor_context),
    'watchlist:ffffffffffffffffffffffffffffffff', 1
  )->>'status',
  'INVALID_CURSOR',
  'a cursor bound to another watchlist fails closed'
);
select is(
  policy.get_playbook_watchlist_change_deltas(
    'package:stablecoin-pre-listing:dddddddddddddddd', 0,
    (select watchlist_id from delta_test_cursor_context), 1
  )->>'status',
  'OK',
  'the bound zero cursor returned for an empty checkpoint remains reusable'
);
select is(
  policy.get_playbook_watchlist_change_deltas(
    'package:stablecoin-pre-listing:dddddddddddddddd', 999999,
    (select watchlist_id from delta_test_cursor_context),
    1
  )->>'status',
  'INVALID_CURSOR',
  'a future or nonexistent cursor fails closed'
);
select throws_ok(
  $sql$
    select policy.get_playbook_watchlist_change_deltas(
      'package:stablecoin-pre-listing:dddddddddddddddd', 0, null, 101
    )
  $sql$,
  'change delta page limit is invalid',
  'page limits above the contract maximum are rejected'
);

reset role;

select is(
  (select event_title from policy.playbook_watchlist_change_deltas
   where event_id = 'event:delta-test:first'),
  'Sanitized first published event',
  'the event title is frozen in the delta snapshot'
);
select throws_ok(
  $sql$
    update policy.playbook_watchlist_change_deltas
    set delta_status = 'REVIEW_REQUIRED'
  $sql$,
  'playbook_watchlist_change_deltas rows are immutable; create a new version',
  'delta rows cannot be updated in place'
);
select throws_ok(
  $sql$
    delete from policy.playbook_watchlist_change_deltas
  $sql$,
  'playbook_watchlist_change_deltas rows are immutable; create a new version',
  'delta rows cannot be deleted in place'
);
select throws_ok(
  $sql$
    update policy.playbook_watchlist_delta_claim_impacts
    set impact_type = impact_type
  $sql$,
  'playbook_watchlist_delta_claim_impacts rows are immutable; create a new version',
  'delta impact snapshots cannot be changed in place'
);
select ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'policy'
      and table_name in (
        'playbook_watchlist_change_deltas',
        'playbook_watchlist_delta_claim_impacts'
      )
      and column_name in (
        'customer_id', 'account_id', 'subscription_id', 'entitlement_id',
        'profile', 'webhook_url', 'webhook_secret', 'prompt', 'raw_rule',
        'artifact_body'
      )
  ),
  'delta tables store no customer, commercial, delivery, profile, rule, prompt, or artifact body'
);
select is(
  (select count(*)::integer
   from policy.playbook_watchlist_change_deltas
   where delta_status <> 'REVIEW_REQUIRED'),
  0,
  'the first slice emits only REVIEW_REQUIRED deltas'
);

select * from finish();
rollback;
