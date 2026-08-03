-- Provisional coverage must aggregate across releases: a jurisdiction's
-- provisional_claim_count is the number of distinct claims across ALL of its
-- published provisional releases, while the release identifiers still point
-- at the latest one. Without this, publishing a small follow-up release
-- (e.g. a checklist-gap top-up) would make coverage appear to shrink.

begin;

create or replace view policy.public_provisional_coverage as
select distinct on (release.jurisdiction_code)
  release.jurisdiction_code,
  (
    select count(distinct membership.claim_id)::integer
    from policy.provisional_release_claims membership
    join policy.provisional_corpus_releases sibling
      on sibling.release_id = membership.release_id
    where sibling.jurisdiction_code = release.jurisdiction_code
  ) as provisional_claim_count,
  release.release_id as latest_release_id,
  release.as_of,
  release.knowledge_cutoff,
  release.published_at
from policy.provisional_corpus_releases release
order by release.jurisdiction_code, release.published_at desc;

comment on view policy.public_provisional_coverage is
  'Latest provisional release per jurisdiction with the distinct claim count aggregated across all of that jurisdiction''s provisional releases; deliberately has no completenessPercent.';

commit;
