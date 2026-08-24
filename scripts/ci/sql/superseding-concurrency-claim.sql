\set ON_ERROR_STOP on

begin;
set local role service_role;
select policy.claim_superseding_playbook_evaluation(
  'package:stablecoin-pre-listing:dddddddddddddddd',
  'stablecoin-pre-listing', repeat('a', 64),
  array['delta:dddddddddddddddddddddddddddddddd'],
  repeat('7', 64), repeat('8', 64)
)->>'status';
select pg_sleep(1);
commit;
