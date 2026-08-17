begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, policy, regulatory;

select plan(44);

insert into policy.storage_objects (
  object_id, provider, bucket, object_key, checksum_sha256, byte_size,
  content_type, encryption_state
) values
  ('object:webhook-test:source', 'supabase-storage', 'policy-sources',
   'tests/webhooks/source.json', repeat('1', 64), 100,
   'application/json', 'PROVIDER_ENCRYPTED'),
  ('object:webhook-test:package', 'supabase-storage', 'policy-playbooks',
   'tests/webhooks/package.json', repeat('2', 64), 100,
   'application/json', 'PROVIDER_ENCRYPTED');

insert into regulatory.source_authorities (
  authority_id, name, jurisdiction_code, authority_type, official_domains
) values (
  'authority:webhook-test', 'Sanitized Webhook Test Authority', 'EEA',
  'REGULATOR', array['official.webhook.test']
);

insert into regulatory.source_documents (
  document_id, authority_id, official_document_id, document_type, title,
  canonical_url, language_codes, redistribution_rights
) values (
  'document:webhook-test', 'authority:webhook-test', 'WEBHOOK-TEST-1',
  'REGULATION', 'Sanitized Webhook Test Instrument',
  'https://official.webhook.test/instrument', array['en'], 'LINK_ONLY'
);

insert into regulatory.source_versions (
  version_id, document_id, version_label, raw_object_id, checksum_sha256,
  official_url, observed_at, retrieved_at, lifecycle_state
) values (
  'version:webhook-test:1', 'document:webhook-test', 'test-v1',
  'object:webhook-test:source', repeat('3', 64),
  'https://official.webhook.test/instrument/v1', now(), now(), 'VERIFIED'
);

insert into policy.legal_claims (
  claim_id, jurisdiction_code, topic, proposition, legal_status,
  review_state, effective_from, knowledge_cutoff
) values (
  'claim:webhook-test:first', 'EEA', 'sanitized-webhook-topic',
  'Sanitized webhook claim.', 'UNDETERMINED', 'PUBLISHED', now(), now()
);

insert into policy.playbook_packages (
  package_id, playbook_id, profile_fingerprint, artifact_object_id,
  artifact_checksum_sha256, integrity_sha256, schema_version, evaluated_at,
  assurance_review_status, corpus_release_id, retrieval_index_release_id,
  dossier_id, rules_version, template_version
) values (
  'package:stablecoin-pre-listing:eeeeeeeeeeeeeeee',
  'stablecoin-pre-listing', repeat('4', 64),
  'object:webhook-test:package', repeat('2', 64), repeat('5', 64),
  '1.1.0', now(), 'PROVISIONAL', null, null,
  'usdc-eea', '1.0.0', '1.0.0'
);

insert into policy.playbook_package_claim_dependencies (
  package_id, claim_id, dependency_basis
) values (
  'package:stablecoin-pre-listing:eeeeeeeeeeeeeeee',
  'claim:webhook-test:first', 'DECISION_EVIDENCE'
);

select policy.create_playbook_package_watchlist(
  'package:stablecoin-pre-listing:eeeeeeeeeeeeeeee'
);

insert into regulatory.regulatory_events (
  event_id, authority_id, after_version_id, event_type, title, observed_at,
  event_state, reviewed_at
) values (
  'event:webhook-test:first', 'authority:webhook-test',
  'version:webhook-test:1', 'AMENDMENT',
  'Sanitized webhook published event', now(), 'REVIEWED', now()
);

insert into policy.event_claim_impacts (
  event_id, claim_id, impact_type, review_state
) values (
  'event:webhook-test:first', 'claim:webhook-test:first',
  'MAY_AFFECT', 'REVIEWED'
);

select ok(
  not has_table_privilege(
    'anon', 'policy.playbook_webhook_deliveries', 'SELECT'
  ),
  'anonymous callers cannot read the webhook outbox'
);
select ok(
  not has_table_privilege(
    'authenticated', 'policy.playbook_webhook_deliveries', 'SELECT'
  ),
  'authenticated browsers cannot read the webhook outbox'
);
select ok(
  not has_table_privilege(
    'service_role', 'policy.playbook_webhook_deliveries', 'SELECT'
  ),
  'service role cannot bypass the webhook RPC boundary'
);
select ok(
  not has_table_privilege(
    'service_role', 'policy.playbook_webhook_deliveries', 'UPDATE'
  ),
  'service role cannot mutate delivery state directly'
);
select ok(
  not has_table_privilege(
    'service_role', 'policy.playbook_webhook_delivery_attempts', 'INSERT'
  ),
  'service role cannot forge attempt audit rows'
);
select ok(
  has_function_privilege(
    'service_role',
    'policy.claim_playbook_webhook_deliveries(integer,integer)',
    'EXECUTE'
  ),
  'service role can claim through the controlled RPC'
);
select ok(
  has_function_privilege(
    'service_role',
    'policy.complete_playbook_webhook_delivery(text,text,text,integer,text)',
    'EXECUTE'
  ),
  'service role can complete an active lease through the controlled RPC'
);
select ok(
  not has_function_privilege(
    'service_role',
    'policy.enqueue_playbook_change_delta_webhook()',
    'EXECUTE'
  ),
  'service role cannot invoke the enqueue trigger directly'
);

update regulatory.regulatory_events
set event_state = 'PUBLISHED', published_at = now()
where event_id = 'event:webhook-test:first';

select is(
  (select count(*)::integer from policy.playbook_watchlist_change_deltas),
  1,
  'publishing an eligible event creates one immutable delta'
);
select is(
  (select count(*)::integer from policy.playbook_webhook_deliveries),
  1,
  'delta materialization atomically creates one pending webhook delivery'
);
select is(
  (select delivery_state from policy.playbook_webhook_deliveries),
  'PENDING',
  'a new webhook delivery starts pending'
);
select matches(
  (select delivery_id from policy.playbook_webhook_deliveries),
  '^webhook-delivery:[0-9a-f]{32}$',
  'the outbox receives a deterministic opaque identity'
);
select is(
  (select count(distinct delta_id)::integer
   from policy.playbook_webhook_deliveries),
  1,
  'one delta has exactly one outbox identity'
);

create temporary table webhook_delta_context as
select delta_id from policy.playbook_watchlist_change_deltas;
grant select on webhook_delta_context to service_role;

set local role service_role;

create temporary table webhook_first_claim as
select policy.claim_playbook_webhook_deliveries(1, 60) as result;

select is(
  jsonb_array_length((select result->'items' from webhook_first_claim)),
  1,
  'the first dispatcher claims one due delivery'
);
select is(
  (select result->'items'->0->>'attemptNumber' from webhook_first_claim),
  '1',
  'the first lease receives attempt number one'
);
select is(
  (select result->'items'->0->'delta'->>'deltaId' from webhook_first_claim),
  (select delta_id from webhook_delta_context),
  'the claim contains the immutable delta event identity'
);
select is(
  jsonb_array_length(
    policy.claim_playbook_webhook_deliveries(1, 60)->'items'
  ),
  0,
  'an active lease prevents an overlapping claim'
);
select is(
  policy.complete_playbook_webhook_delivery(
    (select result->'items'->0->>'deliveryId' from webhook_first_claim),
    'lease:ffffffffffffffffffffffffffffffff',
    'SUCCEEDED', 204, null
  )->>'status',
  'LEASE_CONFLICT',
  'a foreign lease token cannot complete the delivery'
);
select is(
  policy.complete_playbook_webhook_delivery(
    (select result->'items'->0->>'deliveryId' from webhook_first_claim),
    (select result->'items'->0->>'leaseToken' from webhook_first_claim),
    'RETRYABLE_FAILURE', 503, 'HTTP_503'
  )->>'deliveryState',
  'PENDING',
  'a retryable response returns the delivery to pending'
);

reset role;

select is(
  (select count(*)::integer
   from policy.playbook_webhook_delivery_attempts),
  1,
  'a retryable failure appends one immutable attempt audit'
);
select is(
  (select outcome from policy.playbook_webhook_delivery_attempts),
  'RETRYABLE_FAILURE',
  'the attempt audit stores the typed outcome'
);
select cmp_ok(
  (select next_attempt_at from policy.playbook_webhook_deliveries),
  '>', now(),
  'a retryable failure schedules a future attempt'
);

update policy.playbook_webhook_deliveries
set next_attempt_at = clock_timestamp() - interval '1 second';

set local role service_role;

create temporary table webhook_second_claim as
select policy.claim_playbook_webhook_deliveries(1, 60) as result;

select is(
  (select result->'items'->0->>'attemptNumber' from webhook_second_claim),
  '2',
  'a due retry receives the next monotonic attempt number'
);
select is(
  policy.complete_playbook_webhook_delivery(
    (select result->'items'->0->>'deliveryId' from webhook_second_claim),
    (select result->'items'->0->>'leaseToken' from webhook_second_claim),
    'PERMANENT_FAILURE', 400, 'HTTP_400'
  )->>'deliveryState',
  'DEAD_LETTER',
  'a permanent response dead-letters immediately'
);
select is(
  policy.replay_playbook_webhook_delivery(
    (select result->'items'->0->'delta'->>'deltaId' from webhook_second_claim)
  )->>'status',
  'REQUEUED',
  'an authorized replay requeues a dead-letter delivery'
);

create temporary table webhook_replay_claim as
select policy.claim_playbook_webhook_deliveries(1, 60) as result;

select is(
  (select result->'items'->0->>'replayNumber' from webhook_replay_claim),
  '1',
  'the replayed claim exposes its replay generation'
);
select is(
  policy.complete_playbook_webhook_delivery(
    (select result->'items'->0->>'deliveryId' from webhook_replay_claim),
    (select result->'items'->0->>'leaseToken' from webhook_replay_claim),
    'SUCCEEDED', 204, null
  )->>'deliveryState',
  'DELIVERED',
  'a successful replay reaches delivered state'
);

create temporary table webhook_audit as
select policy.get_playbook_webhook_delivery_audit(
  (select result->'items'->0->'delta'->>'deltaId' from webhook_replay_claim)
) as result;

select is(
  jsonb_array_length((select result->'attempts' from webhook_audit)),
  3,
  'delivery audit preserves every pre-replay and replay attempt'
);
select is(
  jsonb_array_length((select result->'replays' from webhook_audit)),
  1,
  'delivery audit includes the immutable replay record'
);
select is(
  (select result->'delivery'->>'deliveryState' from webhook_audit),
  'DELIVERED',
  'delivery audit exposes the current terminal state'
);

reset role;

select is(
  (select replay_count from policy.playbook_webhook_deliveries),
  1,
  'replay increments its monotonic counter without replacing prior audit'
);
select is(
  (select attempt_count from policy.playbook_webhook_deliveries),
  3,
  'total attempt count remains append-only across replay'
);

set local role service_role;

select is(
  policy.replay_playbook_webhook_delivery(
    (select delta_id from webhook_delta_context)
  )->>'status',
  'REQUEUED',
  'a delivered event can be replayed again with the same delta identity'
);

create temporary table webhook_expiring_claim as
select policy.claim_playbook_webhook_deliveries(1, 10) as result;

reset role;

update policy.playbook_webhook_deliveries
set lease_expires_at = clock_timestamp() - interval '1 second';

set local role service_role;

select is(
  jsonb_array_length(
    policy.claim_playbook_webhook_deliveries(1, 10)->'items'
  ),
  0,
  'claim reconciliation audits an expired lease before its backoff is due'
);

reset role;

select is(
  (select outcome from policy.playbook_webhook_delivery_attempts
   where attempt_number = 4),
  'LEASE_EXPIRED',
  'an expired worker lease becomes an immutable typed audit outcome'
);
select is(
  (select delivery_state from policy.playbook_webhook_deliveries),
  'PENDING',
  'an expired first-cycle lease returns to pending'
);

update policy.playbook_webhook_deliveries
set next_attempt_at = clock_timestamp() - interval '1 second';

set local role service_role;

create temporary table webhook_bounded_second_claim as
select policy.claim_playbook_webhook_deliveries(1, 60) as result;

select is(
  policy.complete_playbook_webhook_delivery(
    (select result->'items'->0->>'deliveryId'
     from webhook_bounded_second_claim),
    (select result->'items'->0->>'leaseToken'
     from webhook_bounded_second_claim),
    'RETRYABLE_FAILURE', 503, 'HTTP_503'
  )->>'deliveryState',
  'PENDING',
  'the second retry-cycle failure remains retryable'
);

reset role;

update policy.playbook_webhook_deliveries
set next_attempt_at = clock_timestamp() - interval '1 second';

set local role service_role;

create temporary table webhook_bounded_third_claim as
select policy.claim_playbook_webhook_deliveries(1, 60) as result;

select is(
  policy.complete_playbook_webhook_delivery(
    (select result->'items'->0->>'deliveryId'
     from webhook_bounded_third_claim),
    (select result->'items'->0->>'leaseToken'
     from webhook_bounded_third_claim),
    'RETRYABLE_FAILURE', 503, 'HTTP_503'
  )->>'deliveryState',
  'DEAD_LETTER',
  'the third retry-cycle failure reaches dead-letter state'
);

reset role;

select is(
  (select cycle_attempt_count from policy.playbook_webhook_deliveries),
  3,
  'the retry cycle stops at the fixed attempt bound'
);
select is(
  (select attempt_count from policy.playbook_webhook_deliveries),
  6,
  'total attempt identity remains monotonic through lease recovery'
);
select is(
  (select count(*)::integer
   from policy.playbook_webhook_delivery_attempts),
  6,
  'every claimed attempt has exactly one immutable audit row'
);
select throws_ok(
  $sql$
    update policy.playbook_webhook_delivery_attempts
    set outcome = outcome
  $sql$,
  'playbook_webhook_delivery_attempts rows are immutable; create a new version',
  'attempt audit cannot be updated'
);
select throws_ok(
  $sql$
    delete from policy.playbook_webhook_delivery_replays
  $sql$,
  'playbook_webhook_delivery_replays rows are immutable; create a new version',
  'replay audit cannot be deleted'
);
select ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'policy'
      and table_name in (
        'playbook_webhook_deliveries',
        'playbook_webhook_delivery_attempts',
        'playbook_webhook_delivery_replays'
      )
      and column_name in (
        'customer_id', 'account_id', 'subscription_id', 'entitlement_id',
        'profile', 'webhook_url', 'webhook_secret', 'response_body',
        'prompt', 'raw_rule', 'artifact_body'
      )
  ),
  'webhook tables store no customer, destination, secret, response body, rule, prompt, or artifact body'
);

select * from finish();
rollback;
