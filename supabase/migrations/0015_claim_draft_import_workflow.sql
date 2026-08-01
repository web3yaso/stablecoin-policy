begin;

create table policy.claim_draft_imports (
  batch_id text primary key check (batch_id ~ '^[a-z0-9][a-z0-9._:-]{2,160}$'),
  jurisdiction_code text not null references policy.coverage_scopes(jurisdiction_code),
  manifest_sha256 text not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  claim_count integer not null check (claim_count > 0),
  citation_count integer not null check (citation_count > 0),
  imported_at timestamptz not null default now()
);

create trigger protect_claim_draft_import_trigger
before update or delete on policy.claim_draft_imports
for each row execute function regulatory.reject_immutable_row_change();

alter table policy.claim_draft_imports enable row level security;

create function policy.import_legal_claim_draft_bundle(p_bundle jsonb)
returns jsonb
language plpgsql
security definer
set search_path = policy, regulatory, public, extensions
as $$
declare
  v_batch_id text := p_bundle->>'batchId';
  v_jurisdiction text := p_bundle->>'jurisdictionCode';
  v_claims jsonb := p_bundle->'claims';
  v_manifest_sha256 text;
  v_existing policy.claim_draft_imports%rowtype;
  v_claim jsonb;
  v_citation jsonb;
  v_claim_count integer;
  v_distinct_claim_count integer;
  v_citation_count integer := 0;
begin
  if jsonb_typeof(p_bundle) is distinct from 'object'
     or p_bundle->>'schemaVersion' <> '1.0.0'
     or v_batch_id !~ '^[a-z0-9][a-z0-9._:-]{2,160}$'
     or not exists (
       select 1 from policy.coverage_scopes
       where jurisdiction_code = v_jurisdiction
     )
     or jsonb_typeof(v_claims) is distinct from 'array'
     or jsonb_array_length(v_claims) = 0 then
    raise exception 'invalid legal claim draft bundle';
  end if;

  v_manifest_sha256 := encode(
    extensions.digest(convert_to(p_bundle::text, 'UTF8'), 'sha256'), 'hex'
  );
  select * into v_existing from policy.claim_draft_imports
  where batch_id = v_batch_id;
  if found then
    if v_existing.manifest_sha256 is distinct from v_manifest_sha256 then
      raise exception 'legal claim draft batch id conflicts with another manifest';
    end if;
    return jsonb_build_object(
      'batchId', v_existing.batch_id,
      'jurisdictionCode', v_existing.jurisdiction_code,
      'manifestSha256', v_existing.manifest_sha256,
      'claimCount', v_existing.claim_count,
      'citationCount', v_existing.citation_count,
      'reviewState', 'DRAFT',
      'idempotentReplay', true
    );
  end if;

  select count(*), count(distinct claim->>'claimId')
  into v_claim_count, v_distinct_claim_count
  from jsonb_array_elements(v_claims) claim;
  if v_claim_count <> v_distinct_claim_count then
    raise exception 'legal claim draft bundle contains duplicate claim ids';
  end if;

  for v_claim in select value from jsonb_array_elements(v_claims) loop
    if v_claim->>'claimId' !~ '^[a-z0-9][a-z0-9._:-]{2,160}$'
       or nullif(btrim(v_claim->>'topic'), '') is null
       or nullif(btrim(v_claim->>'proposition'), '') is null
       or v_claim->>'legalStatus' not in (
         'REQUIREMENT', 'PERMISSION', 'PROHIBITION', 'EXEMPTION',
         'GUIDANCE', 'UNDETERMINED'
       )
       or jsonb_typeof(v_claim->'actorTypes') is distinct from 'array'
       or jsonb_typeof(v_claim->'activityCodes') is distinct from 'array'
       or jsonb_typeof(v_claim->'citations') is distinct from 'array'
       or jsonb_array_length(v_claim->'citations') = 0
       or v_claim ?| array['reviewState', 'reviewedAt', 'publishedAt'] then
      raise exception 'invalid legal claim draft';
    end if;

    insert into policy.legal_claims (
      claim_id, policy_domain, jurisdiction_code, topic, proposition,
      legal_status, review_state, effective_from, effective_to,
      knowledge_cutoff, actor_types, activity_codes, supersedes_claim_id
    ) values (
      v_claim->>'claimId', 'stablecoin', v_jurisdiction,
      btrim(v_claim->>'topic'), btrim(v_claim->>'proposition'),
      v_claim->>'legalStatus', 'DRAFT',
      (v_claim->>'effectiveFrom')::timestamptz,
      nullif(v_claim->>'effectiveTo', '')::timestamptz,
      (v_claim->>'knowledgeCutoff')::timestamptz,
      array(select jsonb_array_elements_text(v_claim->'actorTypes')),
      array(select jsonb_array_elements_text(v_claim->'activityCodes')),
      nullif(v_claim->>'supersedesClaimId', '')
    );

    for v_citation in select value from jsonb_array_elements(v_claim->'citations') loop
      if v_citation->>'citationId' !~ '^[a-z0-9][a-z0-9._:-]{2,160}$'
         or v_citation->>'provisionId' !~ '^[a-z0-9][a-z0-9._:-]{2,200}$'
         or v_citation->>'supportRelation' not in (
           'DIRECT_SUPPORT', 'INDIRECT_SUPPORT', 'CONTRADICTS'
         )
         or nullif(btrim(v_citation->>'exactLocator'), '') is null then
        raise exception 'invalid legal claim draft citation';
      end if;
      insert into policy.citations (
        citation_id, claim_id, provision_id, support_relation,
        exact_locator, allowed_excerpt
      ) values (
        v_citation->>'citationId', v_claim->>'claimId',
        v_citation->>'provisionId', v_citation->>'supportRelation',
        btrim(v_citation->>'exactLocator'),
        nullif(btrim(v_citation->>'allowedExcerpt'), '')
      );
      v_citation_count := v_citation_count + 1;
    end loop;
  end loop;

  insert into policy.claim_draft_imports (
    batch_id, jurisdiction_code, manifest_sha256, claim_count, citation_count
  ) values (
    v_batch_id, v_jurisdiction, v_manifest_sha256,
    v_claim_count, v_citation_count
  );

  return jsonb_build_object(
    'batchId', v_batch_id,
    'jurisdictionCode', v_jurisdiction,
    'manifestSha256', v_manifest_sha256,
    'claimCount', v_claim_count,
    'citationCount', v_citation_count,
    'reviewState', 'DRAFT',
    'idempotentReplay', false
  );
end;
$$;

revoke all on table policy.claim_draft_imports
from public, anon, authenticated, service_role;
grant select on table policy.claim_draft_imports to service_role;

revoke all on function policy.import_legal_claim_draft_bundle(jsonb)
from public, anon, authenticated;
grant execute on function policy.import_legal_claim_draft_bundle(jsonb)
to service_role;

comment on table policy.claim_draft_imports is
  'Immutable private audit records for atomic sanitized legal-claim draft batches.';
comment on function policy.import_legal_claim_draft_bundle is
  'Atomically imports claim and citation drafts only; it never submits, reviews, or publishes them.';

commit;
