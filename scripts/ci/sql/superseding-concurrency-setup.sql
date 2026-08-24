\set ON_ERROR_STOP on

insert into policy.storage_objects (
  object_id, provider, bucket, object_key, checksum_sha256, byte_size,
  content_type, encryption_state
) values
  ('object:superseding-concurrency:source', 'supabase-storage', 'policy-sources',
   'tests/superseding-concurrency/source.json', repeat('1', 64), 100,
   'application/json', 'PROVIDER_ENCRYPTED'),
  ('object:superseding-concurrency:base', 'supabase-storage', 'policy-playbooks',
   'tests/superseding-concurrency/base.json', repeat('2', 64), 100,
   'application/json', 'PROVIDER_ENCRYPTED');

insert into regulatory.source_authorities (
  authority_id, name, jurisdiction_code, authority_type, official_domains
) values (
  'authority:superseding-concurrency',
  'Sanitized Superseding Concurrency Authority', 'EEA', 'REGULATOR',
  array['official.superseding-concurrency.test']
);

insert into regulatory.source_documents (
  document_id, authority_id, official_document_id, document_type, title,
  canonical_url, language_codes, redistribution_rights
) values (
  'document:superseding-concurrency', 'authority:superseding-concurrency',
  'SUPERSEDING-CONCURRENCY-1', 'REGULATION',
  'Sanitized Superseding Concurrency Instrument',
  'https://official.superseding-concurrency.test/instrument',
  array['en'], 'LINK_ONLY'
);

insert into regulatory.source_versions (
  version_id, document_id, version_label, raw_object_id, checksum_sha256,
  official_url, observed_at, retrieved_at, lifecycle_state
) values (
  'version:superseding-concurrency:1', 'document:superseding-concurrency',
  'test-v1', 'object:superseding-concurrency:source', repeat('3', 64),
  'https://official.superseding-concurrency.test/instrument/v1',
  now(), now(), 'VERIFIED'
);

insert into regulatory.regulatory_events (
  event_id, authority_id, after_version_id, event_type, title, observed_at,
  event_state, reviewed_at
) values (
  'event:superseding-concurrency:1', 'authority:superseding-concurrency',
  'version:superseding-concurrency:1', 'AMENDMENT',
  'Sanitized concurrent change', now(), 'REVIEWED', now()
);

insert into policy.legal_claims (
  claim_id, jurisdiction_code, topic, proposition, legal_status,
  review_state, effective_from, knowledge_cutoff
) values (
  'claim:superseding-concurrency:1', 'EEA',
  'sanitized-superseding-concurrency-topic',
  'Sanitized superseding concurrency claim.', 'UNDETERMINED', 'PUBLISHED',
  now(), now()
);

insert into policy.playbook_packages (
  package_id, playbook_id, profile_fingerprint, artifact_object_id,
  artifact_checksum_sha256, integrity_sha256, schema_version, evaluated_at,
  assurance_review_status, corpus_release_id, retrieval_index_release_id,
  dossier_id, rules_version, template_version
) values (
  'package:stablecoin-pre-listing:dddddddddddddddd',
  'stablecoin-pre-listing', repeat('a', 64),
  'object:superseding-concurrency:base', repeat('2', 64), repeat('9', 64),
  '1.1.0', now(), 'PROVISIONAL', null, null, null, '1.0.0', '1.0.0'
);

insert into policy.playbook_package_claim_dependencies (
  package_id, claim_id, dependency_basis
) values (
  'package:stablecoin-pre-listing:dddddddddddddddd',
  'claim:superseding-concurrency:1', 'DECISION_EVIDENCE'
);

select policy.create_playbook_package_watchlist(
  'package:stablecoin-pre-listing:dddddddddddddddd'
);

insert into policy.playbook_watchlist_change_deltas (
  delta_id, watchlist_id, package_id, event_id, event_type, event_title,
  event_published_at, delta_status, package_assurance_review_status,
  actions, required_customer_response
)
select
  'delta:dddddddddddddddddddddddddddddddd', watchlist.watchlist_id,
  watchlist.package_id, 'event:superseding-concurrency:1', 'AMENDMENT',
  'Sanitized concurrent change', now(), 'REVIEW_REQUIRED', 'PROVISIONAL',
  array['REVIEW_EVIDENCE_CHANGE', 'REQUEST_PLAYBOOK_RERUN']::text[],
  'ACKNOWLEDGE_AND_RERUN'
from policy.playbook_package_watchlists watchlist
where watchlist.package_id = 'package:stablecoin-pre-listing:dddddddddddddddd';
