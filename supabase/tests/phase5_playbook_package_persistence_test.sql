begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, policy, regulatory;

select plan(27);

select is(
  (select public from storage.buckets where id = 'policy-playbooks'),
  false,
  'playbook package bucket exists and is private'
);
select ok(
  not has_table_privilege('anon', 'policy.playbook_packages', 'SELECT'),
  'anonymous callers cannot read paid package metadata'
);
select ok(
  not has_table_privilege('anon', 'policy.playbook_package_idempotency', 'SELECT'),
  'anonymous callers cannot read package idempotency records'
);
select ok(
  has_table_privilege('service_role', 'policy.playbook_packages', 'SELECT'),
  'service role can read package metadata'
);
select ok(
  not has_table_privilege('service_role', 'policy.playbook_packages', 'INSERT'),
  'service role cannot insert package metadata directly'
);
select ok(
  not has_table_privilege('service_role', 'policy.playbook_packages', 'UPDATE'),
  'service role cannot mutate package metadata directly'
);
select ok(
  not has_table_privilege('service_role', 'policy.playbook_package_idempotency', 'INSERT'),
  'service role cannot insert idempotency records directly'
);
select ok(
  not has_table_privilege('service_role', 'policy.playbook_package_idempotency', 'UPDATE'),
  'service role cannot complete idempotency records directly'
);
select ok(
  not has_function_privilege(
    'anon',
    'policy.claim_playbook_package_idempotency(text,text)',
    'EXECUTE'
  ),
  'anonymous callers cannot claim paid package idempotency keys'
);
select ok(
  not has_function_privilege(
    'anon',
    'policy.register_playbook_package_with_dependencies(text,text,text,text,text,bigint,text,text,text,text,text,text,timestamptz,text,text,text,text,text,text,text,text,text[])',
    'EXECUTE'
  ),
  'anonymous callers cannot register paid package artifacts'
);
select ok(
  not has_function_privilege(
    'service_role',
    'policy.bind_playbook_package_idempotency(text,text,text)',
    'EXECUTE'
  ),
  'service role cannot bypass atomic registration through the internal bind function'
);

set local role service_role;

select is(
  policy.claim_playbook_package_idempotency(
    repeat('1', 64), repeat('2', 64)
  )->>'status',
  'CLAIMED',
  'the first request atomically claims an idempotency lease'
);
select is(
  policy.claim_playbook_package_idempotency(
    repeat('1', 64), repeat('2', 64)
  )->>'status',
  'PENDING',
  'a concurrent identical request cannot start a duplicate run'
);
select throws_ok(
  $sql$
    select policy.claim_playbook_package_idempotency(
      repeat('1', 64), repeat('3', 64)
    )
  $sql$,
  'playbook idempotency key conflict',
  'the same key cannot be reused for a different request fingerprint'
);
select lives_ok(
  $sql$
    select policy.register_playbook_package_with_dependencies(
      'object:playbook-package:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'supabase-storage', 'policy-playbooks',
      'packages/stablecoin-pre-listing/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json',
      repeat('4', 64),
      2048, 'application/json',
      'package:stablecoin-pre-listing:aaaaaaaaaaaaaaaa',
      'stablecoin-pre-listing', repeat('5', 64), repeat('a', 64),
      '1.1.0', '2026-08-12T00:00:00Z', 'PROVISIONAL',
      'provisional:eea:mica:2026-08-02', null, 'usdc-eea',
      '1.0.0', '1.0.0', repeat('1', 64), repeat('2', 64), '{}'::text[]
    )
  $sql$,
  'one RPC atomically registers storage metadata, package metadata, and idempotency completion'
);
select is(
  (select count(*)::integer from policy.playbook_packages),
  1,
  'one immutable package metadata row is stored'
);
select is(
  (select count(*)::integer from policy.storage_objects
   where bucket = 'policy-playbooks'),
  1,
  'the package metadata references one private Storage object'
);
select is(
  (select state from policy.playbook_package_idempotency
   where idempotency_key_sha256 = repeat('1', 64)),
  'COMPLETED',
  'successful registration completes the claimed idempotency record'
);
select is(
  policy.get_playbook_package_artifact(
    'package:stablecoin-pre-listing:aaaaaaaaaaaaaaaa'
  )->>'objectKey',
  'packages/stablecoin-pre-listing/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json',
  'package lookup returns only the immutable artifact reference and query metadata'
);
select is(
  policy.get_playbook_package_by_idempotency(repeat('1', 64))
    ->>'requestFingerprintSha256',
  repeat('2', 64),
  'idempotency replay returns the hashed request fingerprint'
);
select lives_ok(
  $sql$
    select policy.register_playbook_package_with_dependencies(
      'object:playbook-package:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'supabase-storage', 'policy-playbooks',
      'packages/stablecoin-pre-listing/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json',
      repeat('4', 64),
      2048, 'application/json',
      'package:stablecoin-pre-listing:aaaaaaaaaaaaaaaa',
      'stablecoin-pre-listing', repeat('5', 64), repeat('a', 64),
      '1.1.0', '2026-08-12T00:00:00Z', 'PROVISIONAL',
      'provisional:eea:mica:2026-08-02', null, 'usdc-eea',
      '1.0.0', '1.0.0', repeat('1', 64), repeat('2', 64), '{}'::text[]
    )
  $sql$,
  'replaying the exact registration is idempotent'
);
select is(
  (select count(*)::integer from policy.playbook_packages),
  1,
  'exact replay creates no duplicate package row'
);
select is(
  (select count(*)::integer from policy.playbook_package_idempotency),
  1,
  'exact replay creates no duplicate idempotency row'
);
select throws_ok(
  $sql$
    select policy.register_playbook_package_with_dependencies(
      'object:playbook-package:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'supabase-storage', 'policy-playbooks',
      'packages/stablecoin-pre-listing/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json',
      repeat('f', 64),
      2048, 'application/json',
      'package:stablecoin-pre-listing:aaaaaaaaaaaaaaaa',
      'stablecoin-pre-listing', repeat('5', 64), repeat('a', 64),
      '1.1.0', '2026-08-12T00:00:00Z', 'PROVISIONAL',
      'provisional:eea:mica:2026-08-02', null, 'usdc-eea',
      '1.0.0', '1.0.0', repeat('1', 64), repeat('2', 64), '{}'::text[]
    )
  $sql$,
  'immutable playbook artifact checksum conflict for packages/stablecoin-pre-listing/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json',
  'changed bytes cannot overwrite an immutable package artifact'
);
select throws_ok(
  $sql$
    select policy.register_playbook_package_with_dependencies(
      'object:playbook-package:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'supabase-storage', 'policy-playbooks',
      'packages/stablecoin-pre-listing/wrong.json', repeat('4', 64),
      2048, 'application/json',
      'package:stablecoin-pre-listing:aaaaaaaaaaaaaaaa',
      'stablecoin-pre-listing', repeat('5', 64), repeat('a', 64),
      '1.1.0', '2026-08-12T00:00:00Z', 'PROVISIONAL',
      'provisional:eea:mica:2026-08-02', null, 'usdc-eea',
      '1.0.0', '1.0.0', repeat('1', 64), repeat('2', 64), '{}'::text[]
    )
  $sql$,
  'invalid playbook artifact identity',
  'registration binds provider, bucket, object key, package ID, and integrity hash'
);
select ok(
  not exists (
    select 1
    from information_schema.columns
    where table_schema = 'policy'
      and table_name in ('playbook_packages', 'playbook_package_idempotency')
      and column_name in (
        'profile', 'request_body', 'artifact_json', 'idempotency_key',
        'decision_rules', 'prompt'
      )
  ),
  'database metadata stores no raw profile, artifact, rule, prompt, or idempotency key'
);
select is(
  policy.get_playbook_package_artifact('package:stablecoin-pre-listing:bbbbbbbbbbbbbbbb'),
  null,
  'unknown package lookup returns no metadata'
);

select * from finish();
rollback;
