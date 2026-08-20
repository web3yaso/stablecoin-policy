begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, policy, regulatory;

select plan(29);

insert into policy.storage_objects (
  object_id, provider, bucket, object_key, checksum_sha256, byte_size,
  content_type, encryption_state
) values
  ('object:watchlist-test:matching', 'supabase-storage', 'policy-playbooks',
   'tests/watchlist/matching.json', repeat('1', 64), 100,
   'application/json', 'PROVIDER_ENCRYPTED'),
  ('object:watchlist-test:empty', 'supabase-storage', 'policy-playbooks',
   'tests/watchlist/empty.json', repeat('2', 64), 100,
   'application/json', 'PROVIDER_ENCRYPTED'),
  ('object:watchlist-test:unrelated', 'supabase-storage', 'policy-playbooks',
   'tests/watchlist/unrelated.json', repeat('3', 64), 100,
   'application/json', 'PROVIDER_ENCRYPTED');

insert into regulatory.source_authorities (
  authority_id, name, jurisdiction_code, authority_type, official_domains
) values (
  'authority:watchlist-test', 'Sanitized Watchlist Test Authority', 'EEA',
  'REGULATOR', array['official.watchlist.test']
);

insert into regulatory.source_documents (
  document_id, authority_id, official_document_id, document_type, title,
  canonical_url, language_codes, redistribution_rights
) values (
  'document:watchlist-test', 'authority:watchlist-test', 'WATCHLIST-TEST-1',
  'REGULATION', 'Sanitized Watchlist Test Instrument',
  'https://official.watchlist.test/instrument', array['en'], 'LINK_ONLY'
);

insert into regulatory.source_versions (
  version_id, document_id, version_label, raw_object_id, checksum_sha256,
  official_url, observed_at, retrieved_at, lifecycle_state
) values (
  'version:watchlist-test:1', 'document:watchlist-test', 'test-v1',
  'object:watchlist-test:matching', repeat('4', 64),
  'https://official.watchlist.test/instrument/v1',
  '2026-08-10T00:00:00Z', '2026-08-10T00:00:00Z', 'VERIFIED'
);

insert into policy.legal_claims (
  claim_id, jurisdiction_code, topic, proposition, legal_status,
  review_state, effective_from, knowledge_cutoff
) values
  ('claim:watchlist-test:matching', 'EEA', 'sanitized-watchlist-topic',
   'Sanitized matching watchlist claim.', 'UNDETERMINED', 'PUBLISHED',
   '2026-08-01T00:00:00Z', '2026-08-10T00:00:00Z'),
  ('claim:watchlist-test:unrelated', 'EEA', 'sanitized-other-topic',
   'Sanitized unrelated watchlist claim.', 'UNDETERMINED', 'PUBLISHED',
   '2026-08-01T00:00:00Z', '2026-08-10T00:00:00Z');

insert into policy.playbook_packages (
  package_id, playbook_id, profile_fingerprint, artifact_object_id,
  artifact_checksum_sha256, integrity_sha256, schema_version, evaluated_at,
  assurance_review_status, corpus_release_id, retrieval_index_release_id,
  dossier_id, rules_version, template_version
) values
  ('package:stablecoin-pre-listing:aaaaaaaaaaaaaaaa',
   'stablecoin-pre-listing', repeat('5', 64),
   'object:watchlist-test:matching', repeat('1', 64), repeat('6', 64),
   '1.1.0', '2026-08-12T00:00:00Z', 'PROVISIONAL', null, null,
   'usdc-eea', '1.0.0', '1.0.0'),
  ('package:stablecoin-pre-listing:bbbbbbbbbbbbbbbb',
   'stablecoin-pre-listing', repeat('7', 64),
   'object:watchlist-test:empty', repeat('2', 64), repeat('8', 64),
   '1.1.0', '2026-08-12T00:01:00Z', 'PROVISIONAL', null, null,
   'usdc-eea', '1.0.0', '1.0.0'),
  ('package:stablecoin-pre-listing:cccccccccccccccc',
   'stablecoin-pre-listing', repeat('9', 64),
   'object:watchlist-test:unrelated', repeat('3', 64), repeat('a', 64),
   '1.1.0', '2026-08-12T00:02:00Z', 'PROVISIONAL', null, null,
   'usdc-eea', '1.0.0', '1.0.0');

insert into policy.playbook_package_claim_dependencies (
  package_id, claim_id, dependency_basis
) values
  ('package:stablecoin-pre-listing:aaaaaaaaaaaaaaaa',
   'claim:watchlist-test:matching', 'DECISION_EVIDENCE'),
  ('package:stablecoin-pre-listing:cccccccccccccccc',
   'claim:watchlist-test:unrelated', 'DECISION_EVIDENCE');

insert into regulatory.regulatory_events (
  event_id, authority_id, after_version_id, event_type, title, observed_at,
  event_state, reviewed_at, published_at
) values
  ('event:watchlist-test:published', 'authority:watchlist-test',
   'version:watchlist-test:1', 'AMENDMENT', 'Sanitized published event',
   '2026-08-12T00:00:00Z', 'PUBLISHED', '2026-08-12T01:00:00Z',
   '2026-08-12T02:00:00Z'),
  ('event:watchlist-test:candidate', 'authority:watchlist-test',
   'version:watchlist-test:1', 'AMENDMENT', 'Sanitized candidate event',
   '2026-08-12T00:00:00Z', 'CANDIDATE', null, null),
  ('event:watchlist-test:dismissed', 'authority:watchlist-test',
   'version:watchlist-test:1', 'AMENDMENT', 'Sanitized dismissed event',
   '2026-08-12T00:00:00Z', 'PUBLISHED', '2026-08-12T01:00:00Z',
   '2026-08-12T02:00:00Z'),
  ('event:watchlist-test:unrelated', 'authority:watchlist-test',
   'version:watchlist-test:1', 'AMENDMENT', 'Sanitized unrelated event',
   '2026-08-12T00:00:00Z', 'PUBLISHED', '2026-08-12T01:00:00Z',
   '2026-08-12T02:00:00Z');

insert into policy.event_claim_impacts (
  event_id, claim_id, impact_type, review_state
) values
  ('event:watchlist-test:published', 'claim:watchlist-test:matching',
   'MAY_AFFECT', 'REVIEWED'),
  ('event:watchlist-test:candidate', 'claim:watchlist-test:matching',
   'MAY_AFFECT', 'REVIEWED'),
  ('event:watchlist-test:dismissed', 'claim:watchlist-test:matching',
   'MAY_AFFECT', 'DISMISSED'),
  ('event:watchlist-test:unrelated', 'claim:watchlist-test:unrelated',
   'MAY_AFFECT', 'REVIEWED');

select ok(
  not has_table_privilege('anon', 'policy.playbook_package_watchlists', 'SELECT'),
  'anonymous callers cannot read paid watchlists'
);
select ok(
  not has_table_privilege(
    'authenticated', 'policy.playbook_package_watchlists', 'SELECT'
  ),
  'authenticated browsers cannot read paid watchlists'
);
select ok(
  not has_table_privilege(
    'service_role', 'policy.playbook_package_watchlists', 'SELECT'
  ),
  'service role cannot bypass the watchlist RPC boundary'
);
select ok(
  not has_table_privilege(
    'service_role', 'policy.playbook_package_watchlists', 'INSERT'
  ),
  'service role cannot insert watchlists directly'
);
select ok(
  not has_function_privilege(
    'anon', 'policy.create_playbook_package_watchlist(text)', 'EXECUTE'
  ),
  'anonymous callers cannot create paid watchlists'
);
select ok(
  not has_function_privilege(
    'authenticated', 'policy.create_playbook_package_watchlist(text)', 'EXECUTE'
  ),
  'authenticated browsers cannot create paid watchlists'
);
select ok(
  has_function_privilege(
    'service_role', 'policy.create_playbook_package_watchlist(text)', 'EXECUTE'
  ),
  'service role can create package watchlists through the controlled RPC'
);
select ok(
  has_function_privilege(
    'service_role', 'policy.get_affected_playbook_watchlists(text)', 'EXECUTE'
  ),
  'service role can resolve affected watchlists through the controlled RPC'
);
select ok(
  not has_function_privilege(
    'authenticated', 'policy.get_affected_playbook_watchlists(text)', 'EXECUTE'
  ),
  'authenticated browsers cannot query affected watchlists'
);

set local role service_role;

select is(
  policy.create_playbook_package_watchlist(
    'package:stablecoin-pre-listing:dddddddddddddddd'
  )->>'status',
  'NOT_FOUND',
  'unknown packages return a typed not-found outcome without a write'
);
select is(
  policy.create_playbook_package_watchlist(
    'package:stablecoin-pre-listing:bbbbbbbbbbbbbbbb'
  )->>'status',
  'NOT_WATCHLISTABLE',
  'a package without decision-evidence dependencies fails closed'
);
select is(
  policy.create_playbook_package_watchlist(
    'package:stablecoin-pre-listing:aaaaaaaaaaaaaaaa'
  )->>'status',
  'CREATED',
  'a completed package with exact dependencies creates one watchlist'
);
select matches(
  policy.create_playbook_package_watchlist(
    'package:stablecoin-pre-listing:aaaaaaaaaaaaaaaa'
  )#>>'{watchlist,watchlistId}',
  '^watchlist:[0-9a-f]{32}$',
  'the exact retry returns a stable opaque watchlist identity'
);
select is(
  policy.create_playbook_package_watchlist(
    'package:stablecoin-pre-listing:aaaaaaaaaaaaaaaa'
  )->>'status',
  'REPLAYED',
  'watchlist creation is idempotent by immutable package'
);
select throws_ok(
  $sql$
    select policy.get_affected_playbook_watchlists(
      'event:watchlist-test:candidate'
    )
  $sql$,
  'regulatory event is not published',
  'candidate events cannot expose affected watchlists'
);
select is(
  jsonb_array_length(
    policy.get_affected_playbook_watchlists('event:watchlist-test:published')
      ->'watchlists'
  ),
  1,
  'one published reviewed exact impact resolves one active watchlist'
);
select is(
  policy.get_affected_playbook_watchlists('event:watchlist-test:published')
    #>>'{watchlists,0,packageId}',
  'package:stablecoin-pre-listing:aaaaaaaaaaaaaaaa',
  'the affected watchlist remains bound to the exact immutable package'
);
select is(
  policy.get_affected_playbook_watchlists('event:watchlist-test:published')
    #>>'{watchlists,0,claimImpacts,0,impactType}',
  'MAY_AFFECT',
  'the affected watchlist includes the reviewed impact type'
);
select is(
  jsonb_array_length(
    policy.get_affected_playbook_watchlists('event:watchlist-test:dismissed')
      ->'watchlists'
  ),
  0,
  'a dismissed impact cannot expose a watchlist'
);
select is(
  jsonb_array_length(
    policy.get_affected_playbook_watchlists('event:watchlist-test:unrelated')
      ->'watchlists'
  ),
  0,
  'an unrelated reviewed impact cannot expose the matching package watchlist'
);
select is(
  policy.create_playbook_package_watchlist(
    'package:stablecoin-pre-listing:cccccccccccccccc'
  )->>'status',
  'CREATED',
  'a second package creates its own one-to-one watchlist'
);
select is(
  policy.get_affected_playbook_watchlists('event:watchlist-test:unrelated')
    #>>'{watchlists,0,packageId}',
  'package:stablecoin-pre-listing:cccccccccccccccc',
  'the unrelated event resolves only the package with the exact claim dependency'
);
select throws_ok(
  $sql$
    select policy.get_affected_playbook_watchlists(
      'event:watchlist-test:unknown'
    )
  $sql$,
  'unknown regulatory event event:watchlist-test:unknown',
  'unknown regulatory events fail closed'
);

reset role;

select is(
  (select count(*)::integer from policy.playbook_package_watchlists),
  2,
  'retries and rejected packages create no duplicate watchlist rows'
);
select is(
  (select count(distinct package_id)::integer
   from policy.playbook_package_watchlists),
  2,
  'every persisted watchlist has a unique package binding'
);
select throws_ok(
  $sql$
    update policy.playbook_package_watchlists set watchlist_state = 'ACTIVE'
  $sql$,
  'playbook package watchlist transition is not allowed',
  'direct watchlist state writes remain forbidden'
);
select throws_ok(
  $sql$
    delete from policy.playbook_package_watchlists
  $sql$,
  'playbook package watchlists cannot be deleted',
  'watchlist rows cannot be deleted in place'
);
select ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'policy'
      and table_name = 'playbook_package_watchlists'
      and column_name in (
        'customer_id', 'account_id', 'subscription_id', 'entitlement_id',
        'profile', 'webhook_url', 'webhook_secret', 'delivery_state',
        'actions', 'decision_rules', 'prompt'
      )
  ),
  'watchlists store no customer, commercial, profile, delivery, rule, or action data'
);
select is(
  (select count(*)::integer
   from policy.playbook_package_watchlists
   where watchlist_state <> 'ACTIVE'),
  0,
  'the first slice persists only ACTIVE watchlists'
);

select * from finish();
rollback;
