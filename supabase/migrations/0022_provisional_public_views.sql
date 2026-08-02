-- Presentation-safe public views for provisional (machine-assured) evidence.
--
-- Every row is labeled by construction: assurance_level comes from the
-- machine lane, and human_reviewed can only become true through an APPROVED
-- named-human review record — the view exposes no way to mislabel machine
-- rows as reviewed. No reviewer identity, prompt/template identifiers,
-- model names, private notes, or decision-rule data appear in any column.
-- Reviewed-only views and workflows are untouched.

begin;

create view policy.public_provisional_claims as
select
  claim.claim_id,
  claim.jurisdiction_code,
  claim.topic,
  claim.proposition,
  claim.legal_status,
  claim.effective_from,
  claim.effective_to,
  release.release_id,
  release.as_of,
  release.knowledge_cutoff,
  release.published_at,
  'PROVISIONAL_PUBLISHED'::text as assurance_level,
  exists (
    select 1
    from policy.review_records review
    where review.claim_id = claim.claim_id
      and review.outcome = 'APPROVED'
  ) as human_reviewed,
  crosscheck.confidence,
  crosscheck.limitations,
  array['PROVISIONAL_EVIDENCE_REVIEW_RECOMMENDED']::text[] as counsel_triggers,
  source_version.version_id as source_version_id,
  source_version.checksum_sha256 as source_checksum_sha256,
  source_version.retrieved_at as source_retrieved_at,
  source_version.official_url as source_official_url,
  (
    select jsonb_agg(
      jsonb_build_object(
        'provisionId', citation.provision_id,
        'locator', citation.exact_locator
      ) order by citation.citation_id
    )
    from policy.citations citation
    where citation.claim_id = claim.claim_id
  ) as citations
from policy.provisional_release_claims membership
join policy.provisional_corpus_releases release
  on release.release_id = membership.release_id
join policy.legal_claims claim
  on claim.claim_id = membership.claim_id
join policy.machine_assurance_records crosscheck
  on crosscheck.record_id = membership.assurance_record_id
join lateral (
  select version.version_id, version.checksum_sha256,
         version.retrieved_at, version.official_url
  from policy.citations citation
  join regulatory.provisions provision
    on provision.provision_id = citation.provision_id
  join regulatory.source_versions version
    on version.version_id = provision.version_id
  where citation.claim_id = claim.claim_id
  order by version.version_id
  limit 1
) as source_version on true;

create view policy.public_provisional_coverage as
select distinct on (release.jurisdiction_code)
  release.jurisdiction_code,
  (
    select count(*)::integer
    from policy.provisional_release_claims membership
    where membership.release_id = release.release_id
  ) as provisional_claim_count,
  release.release_id as latest_release_id,
  release.as_of,
  release.knowledge_cutoff,
  release.published_at
from policy.provisional_corpus_releases release
order by release.jurisdiction_code, release.published_at desc;

revoke all on table policy.public_provisional_claims
from public, anon, authenticated, service_role;
grant select on table policy.public_provisional_claims to service_role;

revoke all on table policy.public_provisional_coverage
from public, anon, authenticated, service_role;
grant select on table policy.public_provisional_coverage to service_role;

comment on view policy.public_provisional_claims is
  'Presentation-safe provisional claims: mandatory assurance envelope fields, human_reviewed only via APPROVED named-human review records, no reviewer/prompt/model/private data.';
comment on view policy.public_provisional_coverage is
  'Latest provisional release per jurisdiction; deliberately has no completenessPercent because machine publication cannot claim reviewed completeness.';

commit;
