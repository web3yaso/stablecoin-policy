begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions, policy, regulatory, retrieval;

select no_plan();

-- Sanitized provisional corpus fixture. It represents workflow shape only,
-- not a legal conclusion or production review.
insert into policy.storage_objects (
  object_id, provider, bucket, object_key, checksum_sha256, byte_size,
  content_type, encryption_state
) values (
  'object:rag-test:1', 'supabase', 'policy-sources',
  'tests/rag/source.bin', repeat('1', 64), 128,
  'application/octet-stream', 'PROVIDER_ENCRYPTED'
);

insert into regulatory.source_authorities (
  authority_id, name, jurisdiction_code, authority_type, official_domains
) values (
  'authority:rag-test', 'Sanitized RAG Test Authority', 'EEA',
  'REGULATOR', array['official.rag.test']
);

insert into regulatory.source_documents (
  document_id, authority_id, official_document_id, document_type, title,
  canonical_url, language_codes, redistribution_rights, licence_identifier
) values (
  'document:rag-test', 'authority:rag-test', 'RAG-TEST-1',
  'REGULATION', 'Sanitized RAG Test Instrument',
  'https://official.rag.test/instrument', array['en'], 'EXCERPT',
  'SANITIZED-TEST-LICENCE'
);

insert into regulatory.source_versions (
  version_id, document_id, version_label, raw_object_id, checksum_sha256,
  official_url, published_at, effective_from, observed_at, retrieved_at,
  lifecycle_state, storage_rights, rights_reviewed_at, rights_basis
) values (
  'version:rag-test:1', 'document:rag-test', 'test-v1',
  'object:rag-test:1', repeat('2', 64),
  'https://official.rag.test/instrument/v1', now() - interval '10 days',
  now() - interval '9 days', now() - interval '2 days',
  now() - interval '2 days', 'OBSERVED', 'ALLOWED',
  now() - interval '3 days', 'Sanitized internal-search rights basis'
);

insert into regulatory.provisions (
  provision_id, version_id, locator, heading, language_code, provision_text,
  text_checksum_sha256, ordinal, excerpt_permission
) values (
  'provision:rag-test:1', 'version:rag-test:1', 'Article 1',
  'Sanitized provision', 'en', 'Sanitized retrieval fixture text.',
  repeat('3', 64), 1, 'ALLOWED'
);

insert into policy.legal_claims (
  claim_id, jurisdiction_code, topic, proposition, legal_status,
  review_state, effective_from, knowledge_cutoff
) values (
  'claim:rag-test:1', 'EEA', 'sanitized-topic',
  'Sanitized retrieval fixture proposition.', 'UNDETERMINED',
  'DRAFT', now() - interval '9 days', now() - interval '1 day'
);

insert into policy.citations (
  citation_id, claim_id, provision_id, support_relation, exact_locator,
  allowed_excerpt
) values (
  'citation:rag-test:1', 'claim:rag-test:1', 'provision:rag-test:1',
  'DIRECT_SUPPORT', 'Article 1', 'Sanitized retrieval fixture text.'
);

insert into policy.machine_assurance_records (
  record_id, subject_type, subject_id, assurance_level,
  source_version_fingerprint, claim_fingerprint,
  model, prompt_template_id, prompt_template_version, parameters_version,
  confidence, checks, input_checksum_sha256, output_checksum_sha256,
  blockers, limitations, outcome
) values (
  'record:rag-test:crosscheck', 'CLAIM_DRAFT', 'claim:rag-test:1',
  'AI_CROSS_CHECKED', repeat('4', 64), repeat('5', 64),
  'sanitized-test-model', 'rag-test', '1', '1', 0.99,
  '{"contradiction":"PASS","freshness":"PASS","rights":"PASS","jurisdiction":"PASS","effectiveDates":"PASS","citationLocator":"PASS"}'::jsonb,
  repeat('6', 64), repeat('7', 64), '{}'::text[], '{}'::text[], 'ADVANCED'
);

insert into policy.provisional_corpus_releases (
  release_id, jurisdiction_code, as_of, knowledge_cutoff, manifest_sha256,
  published_at
) values (
  'provisional:rag-test:eea:1', 'EEA', now() - interval '1 day',
  now() - interval '2 days', repeat('8', 64), now()
);

insert into policy.provisional_release_claims (
  release_id, claim_id, claim_fingerprint, assurance_record_id
) values (
  'provisional:rag-test:eea:1', 'claim:rag-test:1', repeat('5', 64),
  'record:rag-test:crosscheck'
);

insert into policy.provisional_corpus_releases (
  release_id, jurisdiction_code, as_of, knowledge_cutoff, manifest_sha256,
  published_at
) values (
  'provisional:rag-test:eea:2', 'EEA', now(),
  now() - interval '1 day', repeat('a', 64), now()
);

insert into policy.provisional_release_claims (
  release_id, claim_id, claim_fingerprint, assurance_record_id
) values (
  'provisional:rag-test:eea:2', 'claim:rag-test:1', repeat('5', 64),
  'record:rag-test:crosscheck'
);

set local role service_role;

select ok(
  not has_schema_privilege('anon', 'retrieval', 'USAGE'),
  'anonymous callers cannot use the retrieval schema'
);
select ok(
  has_schema_privilege('service_role', 'retrieval', 'USAGE'),
  'service role can use the private retrieval schema'
);
select ok(
  not has_table_privilege('service_role', 'retrieval.index_releases', 'INSERT'),
  'service role cannot directly insert index releases'
);
select ok(
  not has_table_privilege('service_role', 'retrieval.evidence_chunks', 'INSERT'),
  'service role cannot directly insert evidence chunks'
);
select ok(
  not has_table_privilege('service_role', 'retrieval.rag_retrieval_runs', 'INSERT'),
  'service role cannot directly forge retrieval audit rows'
);
select ok(
  not has_function_privilege(
    'anon',
    'policy.prepare_retrieval_corpus_snapshot(text,text,text,text[])',
    'EXECUTE'
  ),
  'anonymous callers cannot prepare private corpus snapshots'
);
select is(
  (policy.prepare_retrieval_corpus_snapshot(
    'snapshot:rag-test:aggregate', 'stablecoin', 'PROVISIONAL',
    array['provisional:rag-test:eea:1', 'provisional:rag-test:eea:2']
  )->>'sourceReleaseCount')::integer,
  2,
  'snapshot preparation pins both source releases'
);
select is(
  (policy.prepare_retrieval_corpus_snapshot(
    'snapshot:rag-test:aggregate', 'stablecoin', 'PROVISIONAL',
    array['provisional:rag-test:eea:1', 'provisional:rag-test:eea:2']
  )->>'claimCount')::integer,
  1,
  'snapshot preparation deduplicates overlapping claims'
);
select throws_ok(
  $sql$
    select policy.create_retrieval_corpus_snapshot(
      'snapshot:rag-test:aggregate', 'stablecoin', 'PROVISIONAL',
      array['provisional:rag-test:eea:1', 'provisional:rag-test:eea:2'],
      repeat('0', 64)
    )
  $sql$,
  'retrieval corpus snapshot fingerprint is stale',
  'snapshot creation fails closed on a stale prepared fingerprint'
);
select lives_ok(
  $sql$
    select policy.create_retrieval_corpus_snapshot(
      'snapshot:rag-test:aggregate', 'stablecoin', 'PROVISIONAL',
      array['provisional:rag-test:eea:1', 'provisional:rag-test:eea:2'],
      policy.prepare_retrieval_corpus_snapshot(
        'snapshot:rag-test:aggregate', 'stablecoin', 'PROVISIONAL',
        array['provisional:rag-test:eea:1', 'provisional:rag-test:eea:2']
      )->>'manifestSha256'
    )
  $sql$,
  'exact prepared fingerprint creates the immutable aggregate snapshot'
);
select is(
  (select count(*)::integer from retrieval.corpus_snapshot_releases
   where snapshot_id = 'snapshot:rag-test:aggregate'),
  2,
  'aggregate snapshot stores exact source release membership'
);
select is(
  (select count(*)::integer from retrieval.corpus_snapshot_claims
   where snapshot_id = 'snapshot:rag-test:aggregate'),
  1,
  'aggregate snapshot stores deduplicated claim membership'
);
select is(
  jsonb_array_length(policy.get_retrieval_snapshot_build_input(
    'snapshot:rag-test:aggregate'
  )->'sources'),
  1,
  'snapshot build input exposes exact deduplicated citation membership'
);
select ok(
  not has_table_privilege('service_role', 'retrieval.corpus_snapshots', 'INSERT'),
  'service role cannot bypass the snapshot creation boundary'
);

select lives_ok(
  $sql$
    select policy.create_retrieval_index_release(
      'index:rag-test:1', 'stablecoin', 'provisional:rag-test:eea:1',
      'PROVISIONAL', now() + interval '30 days',
      '{"language":"english","version":"1"}'::jsonb,
      '{"distance":"cosine","fusion":"rrf","version":"1"}'::jsonb,
      'sanitized-embedding', '1', 3
    )
  $sql$,
  'service RPC creates a draft index pinned to a provisional corpus'
);

select throws_ok(
  $sql$
    select policy.create_retrieval_index_release(
      'index:rag-test:bad-tier', 'stablecoin',
      'provisional:rag-test:eea:1', 'HUMAN_REVIEWED',
      now() + interval '30 days', '{}'::jsonb, '{}'::jsonb,
      'sanitized-embedding', '1', 3
    )
  $sql$,
  'eligible corpus release does not exist',
  'a provisional corpus cannot be promoted into a human-reviewed index'
);

select lives_ok(
  $sql$
    select policy.add_retrieval_index_chunk(
      'index:rag-test:1', 'chunk:rag-test:1', 'claim:rag-test:1',
      'citation:rag-test:1', 'provision:rag-test:1',
      'version:rag-test:1', 'en', 'Sanitized retrieval fixture text.',
      encode(digest(convert_to('Sanitized retrieval fixture text.', 'UTF8'), 'sha256'), 'hex'),
      'ALLOWED', 'embedding:rag-test:1', 'sanitized-embedding', '1',
      3, '[1,0,0]', repeat('9', 64), 0
    )
  $sql$,
  'service RPC atomically adds a rights-checked chunk, embedding, and membership'
);

select lives_ok(
  $sql$
    select policy.build_retrieval_index_release(jsonb_build_object(
      'schemaVersion', '1.0.0',
      'indexReleaseId', 'index:rag-test:snapshot',
      'policyDomain', 'stablecoin',
      'corpusReleaseId', 'snapshot:rag-test:aggregate',
      'corpusReleaseKind', 'PROVISIONAL',
      'freshThrough', now() + interval '30 days',
      'lexicalConfig', '{"language":"english","version":"1"}'::jsonb,
      'vectorConfig', '{"distance":"cosine","fusion":"rrf","version":"1"}'::jsonb,
      'embeddingModel', 'sanitized-embedding',
      'embeddingModelVersion', '1',
      'embeddingDimensions', 3,
      'chunks', jsonb_build_array(jsonb_build_object(
        'ordinal', 0,
        'chunkId', 'chunk:rag-test:1',
        'claimId', 'claim:rag-test:1',
        'citationId', 'citation:rag-test:1',
        'provisionId', 'provision:rag-test:1',
        'sourceVersionId', 'version:rag-test:1',
        'languageCode', 'en',
        'chunkText', 'Sanitized retrieval fixture text.',
        'chunkChecksumSha256', encode(digest(convert_to(
          'Sanitized retrieval fixture text.', 'UTF8'
        ), 'sha256'), 'hex'),
        'excerptPermission', 'ALLOWED',
        'embeddingId', 'embedding:rag-test:1',
        'embeddingModel', 'sanitized-embedding',
        'embeddingModelVersion', '1',
        'embeddingDimensions', 3,
        'embedding', jsonb_build_array(1, 0, 0),
        'embeddingChecksumSha256', repeat('9', 64)
      ))
    ))
  $sql$,
  'builder consumes a complete immutable aggregate snapshot'
);
select is(
  (select count(*)::integer from retrieval.index_build_records
   where index_release_id = 'index:rag-test:snapshot'),
  1,
  'snapshot build records one exact consumed plan'
);
select ok(
  not has_function_privilege(
    'anon', 'policy.get_retrieval_draft_corpus_pin(text)', 'EXECUTE'
  ),
  'anonymous callers cannot read the private DRAFT corpus pin'
);
select is(
  policy.get_retrieval_draft_corpus_pin('index:rag-test:snapshot')->>'manifestSha256',
  (select manifest_sha256 from retrieval.corpus_snapshots
   where snapshot_id = 'snapshot:rag-test:aggregate'),
  'DRAFT eval corpus pin returns the exact aggregate snapshot manifest'
);

select throws_ok(
  $sql$
    select policy.activate_retrieval_index_release(
      'index:rag-test:1', repeat('0', 64), clock_timestamp()
    )
  $sql$,
  'retrieval index manifest fingerprint is stale',
  'activation fails closed on a stale manifest fingerprint'
);

select throws_ok(
  $sql$
    select policy.activate_retrieval_index_release(
      'index:rag-test:1',
      encode(digest(convert_to(retrieval.build_index_manifest('index:rag-test:1')::text, 'UTF8'), 'sha256'), 'hex'),
      clock_timestamp()
    )
  $sql$,
  'retrieval index lacks a passing exact-manifest eval',
  'an exact manifest remains blocked without a passing eval'
);

select lives_ok(
  $sql$
    select policy.record_retrieval_index_eval(
      'eval:rag-test:1', 'index:rag-test:1',
      encode(digest(convert_to(retrieval.build_index_manifest('index:rag-test:1')::text, 'UTF8'), 'sha256'), 'hex'),
      'MACHINE_ASSURED', 'PASSED', repeat('b', 64),
      '{"recallAt10":1,"mrrAt10":1,"citationPrecision":1,"versionIsolation":1,"checklistTopicCoverage":1,"rightsLeaks":0,"assuranceLeaks":0,"promptInstructionLeaks":0,"unsafeBuildsAccepted":0}'::jsonb,
      now()
    )
  $sql$,
  'a passing machine-assured eval is recorded for the exact provisional manifest'
);

select lives_ok(
  $sql$
    select policy.activate_retrieval_index_release(
      'index:rag-test:1',
      encode(digest(convert_to(retrieval.build_index_manifest('index:rag-test:1')::text, 'UTF8'), 'sha256'), 'hex'),
      clock_timestamp()
    )
  $sql$,
  'exact manifest activates the retrieval index atomically'
);

select is(
  (select release_state from retrieval.index_releases where index_release_id = 'index:rag-test:1'),
  'ACTIVE',
  'activated index is ACTIVE'
);
select is(
  (select active_index_release_id from retrieval.active_index_pointers
   where policy_domain = 'stablecoin' and assurance_tier = 'PROVISIONAL'),
  'index:rag-test:1',
  'activation updates the domain and assurance pointer'
);
select matches(
  (select manifest_sha256 from retrieval.index_releases where index_release_id = 'index:rag-test:1'),
  '^[0-9a-f]{64}$',
  'active index stores its immutable manifest fingerprint'
);

reset role;
select throws_ok(
  $sql$
    insert into retrieval.index_releases (
      index_release_id, policy_domain, corpus_release_id,
      corpus_release_kind, assurance_tier, as_of, knowledge_cutoff,
      fresh_through, lexical_config, vector_config, embedding_model,
      embedding_model_version, embedding_dimensions
    ) values (
      'index:rag-test:bad-freshness', 'stablecoin',
      'provisional:rag-test:eea:1', 'PROVISIONAL', 'PROVISIONAL',
      now() - interval '2 days', now() + interval '2 days',
      now() + interval '1 day', '{}'::jsonb, '{}'::jsonb,
      'sanitized-embedding', '1', 3
    )
  $sql$,
  '23514', null,
  'retrieval freshness cannot predate either corpus timestamp'
);
select throws_ok(
  $sql$update retrieval.evidence_chunks
       set chunk_text = 'mutated'
       where chunk_id = 'chunk:rag-test:1'$sql$,
  'evidence_chunks rows are immutable; create a new version',
  'owner writes are still blocked by the immutable-row trigger'
);
set local role service_role;

select throws_ok(
  $sql$
    select policy.add_retrieval_index_chunk(
      'index:rag-test:1', 'chunk:rag-test:late', 'claim:rag-test:1',
      'citation:rag-test:1', 'provision:rag-test:1',
      'version:rag-test:1', 'en', 'Late membership.',
      encode(digest(convert_to('Late membership.', 'UTF8'), 'sha256'), 'hex'),
      'ALLOWED', 'embedding:rag-test:late', 'sanitized-embedding', '1',
      3, '[0,1,0]', repeat('a', 64), 1
    )
  $sql$,
  'retrieval index membership is frozen after activation',
  'active index membership cannot be changed'
);

select throws_ok(
  $sql$
    select policy.create_retrieval_index_release(
      'index:rag-test:missing-corpus', 'stablecoin',
      'provisional:rag-test:missing', 'PROVISIONAL',
      now() + interval '30 days', '{}'::jsonb, '{}'::jsonb,
      'sanitized-embedding', '1', 3
    )
  $sql$,
  'eligible corpus release does not exist',
  'index creation requires a real eligible corpus release'
);

select throws_ok(
  $sql$insert into retrieval.rag_retrieval_runs (
    run_id, policy_domain, query_sha256, filters,
    requested_assurance_tier, outcome, ranked_hits, result_sha256
  ) values (
    'rag-run:0000000000000000:0000000000000000', 'stablecoin',
    repeat('b', 64), '{}'::jsonb, 'PROVISIONAL',
    'SUCCESS', '[]'::jsonb, repeat('c', 64)
  )$sql$,
  'permission denied for table rag_retrieval_runs',
  'service role cannot bypass the retrieval-run write boundary'
);

select is(
  (select count(*)::integer from retrieval.index_release_chunks
   where index_release_id = 'index:rag-test:1'),
  1,
  'activated index has exactly the committed sanitized member'
);

select ok(
  not has_function_privilege(
    'anon',
    'policy.resolve_retrieval_index_release(text,text,text,text)',
    'EXECUTE'
  ),
  'anonymous callers cannot resolve private retrieval indexes'
);
select ok(
  not has_function_privilege(
    'anon',
    'policy.list_retrieval_index_chunks(text)',
    'EXECUTE'
  ),
  'anonymous callers cannot list private retrieval chunks'
);
select is(
  policy.resolve_retrieval_index_release(
    'stablecoin', 'PROVISIONAL', null, null
  )->>'indexReleaseId',
  'index:rag-test:1',
  'query boundary resolves the active domain and assurance index'
);
select is(
  jsonb_array_length(policy.list_retrieval_index_chunks('index:rag-test:1')),
  1,
  'query boundary returns the pinned index membership'
);
select is(
  policy.list_retrieval_index_chunks('index:rag-test:1')->0->>'embedding',
  '[1,0,0]',
  'query boundary returns the pinned pgvector value for hybrid ranking'
);
select lives_ok(
  $sql$
    select policy.record_rag_retrieval_run(
      'rag-run:0000000000000000:1111111111111111',
      'stablecoin', repeat('b', 64),
      '{"assuranceTier":"PROVISIONAL"}'::jsonb, 'PROVISIONAL',
      'index:rag-test:1', 'provisional:rag-test:eea:1', 'SUCCESS',
      array['chunk:rag-test:1'], repeat('c', 64), null, null
    )
  $sql$,
  'service RPC appends a valid pinned retrieval audit'
);
select throws_ok(
  $sql$
    select policy.record_rag_retrieval_run(
      'rag-run:0000000000000000:2222222222222222',
      'stablecoin', repeat('d', 64), '{}'::jsonb, 'PROVISIONAL',
      'index:rag-test:1', 'provisional:rag-test:eea:1', 'SUCCESS',
      array['chunk:rag-test:not-member'], repeat('e', 64), null, null
    )
  $sql$,
  'retrieval run contains a chunk outside the pinned index',
  'retrieval audit rejects cross-index or fabricated hits'
);
select is(
  (select count(*)::integer from retrieval.rag_retrieval_runs),
  1,
  'only the valid retrieval audit was committed'
);

select ok(
  not has_function_privilege(
    'anon',
    'policy.get_retrieval_index_build_input(text,text,text)',
    'EXECUTE'
  ),
  'anonymous callers cannot read retrieval index build input'
);
select is(
  policy.get_retrieval_index_build_input(
    'stablecoin', 'provisional:rag-test:eea:1', 'PROVISIONAL'
  )->>'corpusReleaseId',
  'provisional:rag-test:eea:1',
  'builder input pins the selected provisional corpus release'
);
select is(
  jsonb_array_length(policy.get_retrieval_index_build_input(
    'stablecoin', 'provisional:rag-test:eea:1', 'PROVISIONAL'
  )->'sources'),
  1,
  'builder input exposes exactly one provision-aligned citation source'
);
select is(
  policy.get_retrieval_index_build_input(
    'stablecoin', 'provisional:rag-test:eea:1', 'PROVISIONAL'
  )->'sources'->0->>'provisionText',
  'Sanitized retrieval fixture text.',
  'rights-authorized builder input includes the provision text'
);

select lives_ok(
  $sql$
    select policy.build_retrieval_index_release(jsonb_build_object(
      'schemaVersion', '1.0.0',
      'indexReleaseId', 'index:rag-test:builder',
      'policyDomain', 'stablecoin',
      'corpusReleaseId', 'provisional:rag-test:eea:1',
      'corpusReleaseKind', 'PROVISIONAL',
      'freshThrough', now() + interval '30 days',
      'lexicalConfig', '{"language":"english","version":"1"}'::jsonb,
      'vectorConfig', '{"distance":"cosine","fusion":"rrf","version":"1"}'::jsonb,
      'embeddingModel', 'sanitized-embedding',
      'embeddingModelVersion', '1',
      'embeddingDimensions', 3,
      'chunks', jsonb_build_array(jsonb_build_object(
        'ordinal', 0,
        'chunkId', 'chunk:rag-test:1',
        'claimId', 'claim:rag-test:1',
        'citationId', 'citation:rag-test:1',
        'provisionId', 'provision:rag-test:1',
        'sourceVersionId', 'version:rag-test:1',
        'languageCode', 'en',
        'chunkText', 'Sanitized retrieval fixture text.',
        'chunkChecksumSha256', encode(digest(convert_to(
          'Sanitized retrieval fixture text.', 'UTF8'
        ), 'sha256'), 'hex'),
        'excerptPermission', 'ALLOWED',
        'embeddingId', 'embedding:rag-test:builder',
        'embeddingModel', 'sanitized-embedding',
        'embeddingModelVersion', '1',
        'embeddingDimensions', 3,
        'embedding', jsonb_build_array(0, 1, 0),
        'embeddingChecksumSha256', repeat('f', 64)
      ))
    ))
  $sql$,
  'single builder RPC atomically creates a complete draft index'
);
select is(
  (select release_state from retrieval.index_releases
   where index_release_id = 'index:rag-test:builder'),
  'DRAFT',
  'builder never activates the newly created index'
);
select is(
  (select count(*)::integer from retrieval.index_release_chunks
   where index_release_id = 'index:rag-test:builder'),
  1,
  'builder commits the exact plan membership'
);
select is(
  (select count(*)::integer from retrieval.index_build_records
   where index_release_id = 'index:rag-test:builder'),
  1,
  'builder records one immutable idempotency fingerprint'
);
select lives_ok(
  $sql$
    select policy.build_retrieval_index_release(
      (select jsonb_build_object(
        'schemaVersion', '1.0.0',
        'indexReleaseId', release.index_release_id,
        'policyDomain', release.policy_domain,
        'corpusReleaseId', release.corpus_release_id,
        'corpusReleaseKind', release.corpus_release_kind,
        'freshThrough', release.fresh_through,
        'lexicalConfig', release.lexical_config,
        'vectorConfig', release.vector_config,
        'embeddingModel', release.embedding_model,
        'embeddingModelVersion', release.embedding_model_version,
        'embeddingDimensions', release.embedding_dimensions,
        'chunks', jsonb_build_array(jsonb_build_object(
          'ordinal', member.ordinal,
          'chunkId', chunk.chunk_id,
          'claimId', chunk.claim_id,
          'citationId', chunk.citation_id,
          'provisionId', chunk.provision_id,
          'sourceVersionId', chunk.source_version_id,
          'languageCode', chunk.language_code,
          'chunkText', chunk.chunk_text,
          'chunkChecksumSha256', chunk.chunk_checksum_sha256,
          'excerptPermission', chunk.excerpt_permission,
          'embeddingId', embedding.embedding_id,
          'embeddingModel', embedding.model_identifier,
          'embeddingModelVersion', embedding.model_version,
          'embeddingDimensions', embedding.dimensions,
          'embedding', embedding.embedding::text::jsonb,
          'embeddingChecksumSha256', embedding.embedding_checksum_sha256
        ))
      )
      from retrieval.index_releases release
      join retrieval.index_release_chunks member
        on member.index_release_id = release.index_release_id
      join retrieval.evidence_chunks chunk on chunk.chunk_id = member.chunk_id
      join retrieval.embedding_records embedding
        on embedding.embedding_id = member.embedding_id
      where release.index_release_id = 'index:rag-test:builder')
    )
  $sql$,
  'an identical builder plan replay is idempotent'
);
select is(
  (select count(*)::integer from retrieval.index_release_chunks
   where index_release_id = 'index:rag-test:builder'),
  1,
  'idempotent replay creates no duplicate membership'
);
select matches(
  policy.get_retrieval_index_manifest('index:rag-test:builder')->>'manifestSha256',
  '^[0-9a-f]{64}$',
  'draft builder manifest has an exact server-side fingerprint'
);
select is(
  (select active_index_release_id from retrieval.active_index_pointers
   where policy_domain = 'stablecoin' and assurance_tier = 'PROVISIONAL'),
  'index:rag-test:1',
  'building a draft cannot move the active index pointer'
);
select throws_ok(
  $sql$
    select policy.build_retrieval_index_release(jsonb_build_object(
      'schemaVersion', '1.0.0',
      'indexReleaseId', 'index:rag-test:builder',
      'policyDomain', 'stablecoin',
      'corpusReleaseId', 'provisional:rag-test:eea:1',
      'corpusReleaseKind', 'PROVISIONAL',
      'freshThrough', now() + interval '31 days',
      'lexicalConfig', '{}'::jsonb,
      'vectorConfig', '{}'::jsonb,
      'embeddingModel', 'sanitized-embedding',
      'embeddingModelVersion', '1',
      'embeddingDimensions', 3,
      'chunks', jsonb_build_array(jsonb_build_object(
        'ordinal', 0, 'citationId', 'citation:rag-test:1'
      ))
    ))
  $sql$,
  'retrieval index identifier was already used for a different plan',
  'changed plan replay fails closed before mutating the draft'
);

-- Suspension regression: extend the same fully built/evaluated real fixture.
reset role;
create function pg_temp.suspend_test(op text default 'suspend:rag:test', rev bigint default 1,
  hash text default null, domain text default 'stablecoin', tier text default 'PROVISIONAL',
  target text default 'index:rag-test:1', reason text default 'sanitized drill') returns jsonb
language sql as $$
  select policy.suspend_retrieval_index_release(op, domain, tier, target,
    coalesce(hash, policy.get_retrieval_index_manifest(target)->>'manifestSha256'), rev, reason)
$$;
create function pg_temp.evidence_fingerprint() returns text language sql as $$
  select md5(jsonb_build_array(
    (select jsonb_agg(to_jsonb(x) order by chunk_id) from retrieval.evidence_chunks x),
    (select jsonb_agg(to_jsonb(x) order by embedding_id) from retrieval.embedding_records x),
    (select jsonb_agg(to_jsonb(x) order by claim_id) from policy.legal_claims x),
    (select jsonb_agg(to_jsonb(x) order by citation_id) from policy.citations x),
    (select jsonb_agg(to_jsonb(x) order by run_id) from retrieval.rag_retrieval_runs x),
    (select jsonb_agg(to_jsonb(x) order by index_release_id, ordinal) from retrieval.index_release_chunks x)
  )::text)
$$;
create temp table suspension_before as select pg_temp.evidence_fingerprint() as fingerprint;
grant select on suspension_before to service_role;
set local role service_role;
select ok(not has_function_privilege('anon',
  'policy.suspend_retrieval_index_release(text,text,text,text,text,bigint,text)', 'EXECUTE'), 'anon cannot suspend');
select ok(not has_function_privilege('authenticated',
  'policy.suspend_retrieval_index_release(text,text,text,text,text,bigint,text)', 'EXECUTE'), 'authenticated cannot suspend');
select ok(not has_function_privilege('anon',
  'policy.inspect_retrieval_index_pointer(text,text)', 'EXECUTE'), 'anon cannot inspect pointer');
select ok(not has_function_privilege('service_role',
  'retrieval.activate_index_under_scope_lock(text,text,timestamptz)', 'EXECUTE'), 'cannot bypass activation scope lock');
select ok(not has_function_privilege('service_role',
  'retrieval.rollback_index_under_scope_lock(text,text,timestamptz)', 'EXECUTE'), 'cannot bypass rollback scope lock');
select ok(not has_table_privilege('service_role', 'retrieval.index_suspension_operations', 'INSERT'), 'audit is RPC-only');
select is(policy.inspect_retrieval_index_pointer('stablecoin','PROVISIONAL')->>'revision', '1', 'first activation revision');
select is(policy.inspect_retrieval_index_pointer('absent-domain','PROVISIONAL'), null::jsonb, 'absent scope inspection does not create row');
select throws_ok($$select pg_temp.suspend_test(null)$$, 'invalid retrieval suspension request', 'null operation rejected');
select throws_ok($$select pg_temp.suspend_test(rev => null)$$, 'invalid retrieval suspension request', 'null revision rejected');
select throws_ok($$select pg_temp.suspend_test(rev => 0)$$, 'invalid retrieval suspension request', 'zero revision rejected');
select throws_ok($$select pg_temp.suspend_test(domain => null)$$, 'invalid retrieval scope', 'null scope rejected');
select throws_ok($$select pg_temp.suspend_test(tier => null)$$, 'invalid retrieval scope', 'null tier rejected');
select throws_ok($$select pg_temp.suspend_test(reason => ' ')$$, 'invalid retrieval suspension request', 'blank reason rejected');
select throws_ok($$select pg_temp.suspend_test(reason => repeat('x',501))$$, 'invalid retrieval suspension request', 'long reason rejected');
select throws_ok($$select pg_temp.suspend_test(hash => repeat('0',64))$$, 'retrieval suspension target is stale', 'wrong manifest rejected');
select throws_ok($$select pg_temp.suspend_test(rev => 2)$$, 'retrieval suspension pointer is stale', 'wrong revision rejected');
select throws_ok($$select pg_temp.suspend_test(domain => 'other-domain')$$, 'retrieval suspension pointer is stale', 'cross domain rejected');
select throws_ok($$select pg_temp.suspend_test(tier => 'HUMAN_REVIEWED')$$, 'retrieval suspension pointer is stale', 'cross assurance rejected');
select throws_ok($$select pg_temp.suspend_test(target => 'index:rag-test:builder')$$, 'retrieval suspension pointer is stale', 'wrong index rejected');
select is((select count(*)::int from retrieval.index_suspension_operations), 0, 'invalid requests wrote no audit');

-- Fail after pointer and release updates; the entire statement must roll back.
reset role;
create function pg_temp.reject_suspension_audit() returns trigger language plpgsql as $$
begin raise exception 'injected late suspension failure'; end $$;
create trigger injected_suspension_failure before insert on retrieval.index_suspension_operations
for each row execute function pg_temp.reject_suspension_audit();
set local role service_role;
select throws_ok($$select pg_temp.suspend_test()$$, 'injected late suspension failure', 'late audit failure rolls back');
select is(policy.get_retrieval_index_manifest('index:rag-test:1')->>'releaseState', 'ACTIVE', 'failure preserves ACTIVE');
select is(policy.inspect_retrieval_index_pointer('stablecoin','PROVISIONAL')->>'revision', '1', 'failure preserves revision');
select is((select count(*)::int from retrieval.index_suspension_operations), 0, 'failure leaves zero audit rows');
reset role;
drop trigger injected_suspension_failure on retrieval.index_suspension_operations;
set local role service_role;
select lives_ok($$select pg_temp.suspend_test()$$, 'first active index can be suspended without previous index');
select is(policy.get_retrieval_index_manifest('index:rag-test:1')->>'releaseState', 'SUSPENDED', 'explicit suspension phase');
select is(policy.inspect_retrieval_index_pointer('stablecoin','PROVISIONAL')->>'revision', '2', 'retained pointer increments revision');
select is(policy.inspect_retrieval_index_pointer('stablecoin','PROVISIONAL')->>'activeIndexReleaseId', null::text, 'empty active pointer');
select is(policy.inspect_retrieval_index_pointer('stablecoin','PROVISIONAL')->>'previousIndexReleaseId', null::text, 'no automatic fallback');
select is(policy.resolve_retrieval_index_release('stablecoin','PROVISIONAL'), null::jsonb, 'default resolution unavailable');
select is(policy.resolve_retrieval_index_release('stablecoin','PROVISIONAL',null,'index:rag-test:1'), null::jsonb, 'pinned resolution unavailable');
select is(policy.list_retrieval_index_chunks('index:rag-test:1'), '[]'::jsonb, 'pinned chunk listing denied');
select is(pg_temp.evidence_fingerprint(), (select fingerprint from suspension_before), 'evidence and recorded historical results unchanged');
select is(pg_temp.suspend_test(), (select result from retrieval.index_suspension_operations where operation_id='suspend:rag:test'), 'exact replay returns stored result');
select is((select count(*)::int from retrieval.index_suspension_operations), 1, 'exact replay does not duplicate audit');
select throws_ok($$select pg_temp.suspend_test(reason => 'changed')$$, 'retrieval suspension operation replay conflict', 'reason conflict rejected');
select throws_ok($$select pg_temp.suspend_test(rev => 2)$$, 'retrieval suspension operation replay conflict', 'revision replay conflict rejected');
select throws_ok($$select pg_temp.suspend_test(op => 'suspend:rag:new')$$, 'retrieval suspension pointer is stale', 'new stale request rejected');
select throws_ok($$select policy.activate_retrieval_index_release('index:rag-test:1',
  policy.get_retrieval_index_manifest('index:rag-test:1')->>'manifestSha256',clock_timestamp())$$,
  'only a DRAFT retrieval index can be activated', 'suspended index cannot reactivate');
select throws_ok($$select policy.rollback_retrieval_index_release('stablecoin','PROVISIONAL',clock_timestamp())$$,
  'no eligible previous retrieval index is available for rollback', 'suspension cannot rollback');
reset role;
select throws_ok($$update retrieval.index_releases set release_state='ACTIVE', suspended_at=null
  where index_release_id='index:rag-test:1'$$,
  'suspended retrieval index is immutable; build a new DRAFT', 'even owner cannot unsuspend');
select throws_ok($$delete from retrieval.active_index_pointers where policy_domain='stablecoin'$$,
  'retrieval scope pointer cannot be deleted', 'revision cannot reset through deletion');
select throws_ok($$delete from retrieval.index_suspension_operations$$,
  'index_suspension_operations rows are immutable; create a new version', 'audit immutable');
set local role service_role;

-- Recover through evaluated DRAFTs, then prove ABA rejection.
select policy.record_retrieval_index_eval('eval:rag-test:builder', 'index:rag-test:builder',
  policy.get_retrieval_index_manifest('index:rag-test:builder')->>'manifestSha256',
  'MACHINE_ASSURED','PASSED',repeat('a',64),
  '{"recallAt10":1,"mrrAt10":1,"citationPrecision":1,"versionIsolation":1,"checklistTopicCoverage":1,"rightsLeaks":0,"assuranceLeaks":0,"promptInstructionLeaks":0,"unsafeBuildsAccepted":0}',clock_timestamp());
select lives_ok($$select policy.activate_retrieval_index_release('index:rag-test:builder',
  policy.get_retrieval_index_manifest('index:rag-test:builder')->>'manifestSha256',clock_timestamp())$$, 'new evaluated DRAFT recovers');
select is(policy.inspect_retrieval_index_pointer('stablecoin','PROVISIONAL')->>'revision','3','recovery preserves monotonic revision');
select lives_ok($$select pg_temp.suspend_test()$$,'old exact retry still succeeds after recovery');
select is(policy.inspect_retrieval_index_pointer('stablecoin','PROVISIONAL')->>'activeIndexReleaseId','index:rag-test:builder','old retry does not suspend replacement');
select policy.record_retrieval_index_eval('eval:rag-test:snapshot', 'index:rag-test:snapshot',
  policy.get_retrieval_index_manifest('index:rag-test:snapshot')->>'manifestSha256',
  'MACHINE_ASSURED','PASSED',repeat('b',64),
  '{"recallAt10":1,"mrrAt10":1,"citationPrecision":1,"versionIsolation":1,"checklistTopicCoverage":1,"rightsLeaks":0,"assuranceLeaks":0,"promptInstructionLeaks":0,"unsafeBuildsAccepted":0}',clock_timestamp());
select policy.activate_retrieval_index_release('index:rag-test:snapshot',
  policy.get_retrieval_index_manifest('index:rag-test:snapshot')->>'manifestSha256',clock_timestamp());
select lives_ok($$select policy.rollback_retrieval_index_release('stablecoin','PROVISIONAL',clock_timestamp())$$, 'eligible retired rollback preserved');
select is(policy.inspect_retrieval_index_pointer('stablecoin','PROVISIONAL')->>'revision','5','rollback increments revision');
select throws_ok($$select pg_temp.suspend_test(op=>'suspend:rag:aba',rev=>3,target=>'index:rag-test:builder')$$,
  'retrieval suspension pointer is stale','same index and hash after ABA cannot accept old revision');
select is((select count(*)::int from retrieval.index_suspension_operations),1,'ABA rejection writes nothing');

select * from finish();
rollback;
