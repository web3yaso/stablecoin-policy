\set ON_ERROR_STOP on

begin;
set local session_replication_role = replica;

delete from policy.playbook_webhook_delivery_attempts
where delivery_id in (
  select delivery_id from policy.playbook_webhook_deliveries
  where delta_id = 'delta:dddddddddddddddddddddddddddddddd'
);
delete from policy.playbook_webhook_delivery_replays
where delivery_id in (
  select delivery_id from policy.playbook_webhook_deliveries
  where delta_id = 'delta:dddddddddddddddddddddddddddddddd'
);
delete from policy.playbook_webhook_deliveries
where delta_id = 'delta:dddddddddddddddddddddddddddddddd';
delete from policy.playbook_package_delta_coverage
where base_package_id = 'package:stablecoin-pre-listing:dddddddddddddddd';
delete from policy.playbook_package_lineage
where base_package_id = 'package:stablecoin-pre-listing:dddddddddddddddd';
delete from policy.playbook_package_rerun_attempts
where base_package_id = 'package:stablecoin-pre-listing:dddddddddddddddd';
delete from policy.playbook_package_idempotency
where idempotency_key_sha256 = repeat('7', 64);
delete from policy.playbook_watchlist_delta_claim_impacts
where delta_id = 'delta:dddddddddddddddddddddddddddddddd';
delete from policy.playbook_watchlist_change_deltas
where delta_id = 'delta:dddddddddddddddddddddddddddddddd';
delete from policy.playbook_package_watchlists
where package_id = 'package:stablecoin-pre-listing:dddddddddddddddd';
delete from policy.playbook_package_claim_dependencies
where package_id = 'package:stablecoin-pre-listing:dddddddddddddddd';
delete from policy.playbook_packages
where package_id = 'package:stablecoin-pre-listing:dddddddddddddddd';
delete from regulatory.regulatory_events
where event_id = 'event:superseding-concurrency:1';
delete from policy.legal_claims
where claim_id = 'claim:superseding-concurrency:1';
delete from regulatory.source_versions
where version_id = 'version:superseding-concurrency:1';
delete from regulatory.source_documents
where document_id = 'document:superseding-concurrency';
delete from regulatory.source_authorities
where authority_id = 'authority:superseding-concurrency';
delete from policy.storage_objects
where object_id in (
  'object:superseding-concurrency:source',
  'object:superseding-concurrency:base'
);

commit;
