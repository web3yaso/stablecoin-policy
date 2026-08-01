begin;

insert into storage.buckets (id, name, public)
values ('policy-sources', 'policy-sources', false)
on conflict (id) do update set public = false;

-- Cross-domain official evidence. AI Policy and Web3 Policy can reuse this
-- schema without copying official documents or provisions.
create schema if not exists regulatory;

create table regulatory.source_authorities (
  authority_id text primary key check (authority_id ~ '^[a-z0-9][a-z0-9._:-]{2,160}$'),
  name text not null,
  jurisdiction_code text not null check (jurisdiction_code ~ '^[A-Z][A-Z0-9-]{1,15}$'),
  authority_type text not null
    check (authority_type in ('LEGISLATURE', 'REGULATOR', 'COURT', 'GOVERNMENT', 'OFFICIAL_REGISTER')),
  official_domains text[] not null check (cardinality(official_domains) > 0),
  status text not null default 'ACTIVE'
    check (status in ('ACTIVE', 'INACTIVE', 'SUCCESSOR')),
  created_at timestamptz not null default now()
);

create table regulatory.source_documents (
  document_id text primary key check (document_id ~ '^[a-z0-9][a-z0-9._:-]{2,160}$'),
  authority_id text not null references regulatory.source_authorities(authority_id),
  official_document_id text not null,
  document_type text not null,
  title text not null,
  canonical_url text not null check (canonical_url ~ '^https://'),
  language_codes text[] not null check (cardinality(language_codes) > 0),
  evidence_layer text not null default 'OFFICIAL_SOURCE'
    check (evidence_layer = 'OFFICIAL_SOURCE'),
  redistribution_rights text not null default 'LINK_ONLY'
    check (redistribution_rights in ('FULL_TEXT', 'EXCERPT', 'LINK_ONLY', 'UNKNOWN')),
  licence_identifier text,
  created_at timestamptz not null default now(),
  unique (authority_id, official_document_id)
);

create table regulatory.source_versions (
  version_id text primary key check (version_id ~ '^[a-z0-9][a-z0-9._:-]{2,160}$'),
  document_id text not null references regulatory.source_documents(document_id),
  version_label text not null,
  raw_object_id text not null references policy.storage_objects(object_id),
  checksum_sha256 text not null check (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  official_url text not null check (official_url ~ '^https://'),
  published_at timestamptz,
  effective_from timestamptz,
  effective_to timestamptz,
  observed_at timestamptz not null,
  retrieved_at timestamptz not null,
  verified_at timestamptz,
  corrected_at timestamptz,
  lifecycle_state text not null default 'OBSERVED'
    check (lifecycle_state in ('OBSERVED', 'VERIFIED', 'SUPERSEDED', 'CORRECTED', 'RETRACTED')),
  supersedes_version_id text references regulatory.source_versions(version_id),
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_from is null or effective_to > effective_from),
  check (supersedes_version_id is null or supersedes_version_id <> version_id),
  unique (document_id, version_label, checksum_sha256)
);

create table regulatory.provisions (
  provision_id text primary key check (provision_id ~ '^[a-z0-9][a-z0-9._:-]{2,200}$'),
  version_id text not null references regulatory.source_versions(version_id),
  locator text not null,
  heading text,
  language_code text not null,
  provision_text text,
  text_checksum_sha256 text not null check (text_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  ordinal integer not null check (ordinal >= 0),
  excerpt_permission text not null default 'UNKNOWN'
    check (excerpt_permission in ('ALLOWED', 'LINK_ONLY', 'UNKNOWN')),
  created_at timestamptz not null default now(),
  unique (version_id, locator, language_code)
);

create table regulatory.regulatory_events (
  event_id text primary key check (event_id ~ '^[a-z0-9][a-z0-9._:-]{2,160}$'),
  authority_id text not null references regulatory.source_authorities(authority_id),
  before_version_id text references regulatory.source_versions(version_id),
  after_version_id text references regulatory.source_versions(version_id),
  event_type text not null
    check (event_type in ('PUBLICATION', 'AMENDMENT', 'EFFECTIVE_DATE', 'DEADLINE', 'CORRECTION', 'REPEAL')),
  title text not null,
  observed_at timestamptz not null,
  effective_at timestamptz,
  event_state text not null default 'CANDIDATE'
    check (event_state in ('CANDIDATE', 'REVIEWED', 'PUBLISHED', 'RETRACTED')),
  created_at timestamptz not null default now(),
  check (before_version_id is not null or after_version_id is not null)
);

-- Stablecoin-domain interpretation and review. No DecisionRule or
-- PlaybookAction data belongs in these public-corpus tables.
create table policy.legal_claims (
  claim_id text primary key check (claim_id ~ '^[a-z0-9][a-z0-9._:-]{2,160}$'),
  policy_domain text not null default 'stablecoin' check (policy_domain = 'stablecoin'),
  jurisdiction_code text not null check (jurisdiction_code ~ '^[A-Z][A-Z0-9-]{1,15}$'),
  topic text not null,
  proposition text not null,
  legal_status text not null
    check (legal_status in ('REQUIREMENT', 'PERMISSION', 'PROHIBITION', 'EXEMPTION', 'GUIDANCE', 'UNDETERMINED')),
  review_state text not null default 'DRAFT'
    check (review_state in ('DRAFT', 'IN_REVIEW', 'REVIEWED', 'PUBLISHED', 'SUPERSEDED', 'RETRACTED')),
  effective_from timestamptz not null,
  effective_to timestamptz,
  knowledge_cutoff timestamptz not null,
  actor_types text[] not null default '{}'::text[],
  activity_codes text[] not null default '{}'::text[],
  supersedes_claim_id text references policy.legal_claims(claim_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from),
  check (supersedes_claim_id is null or supersedes_claim_id <> claim_id)
);

create table policy.citations (
  citation_id text primary key check (citation_id ~ '^[a-z0-9][a-z0-9._:-]{2,160}$'),
  claim_id text not null references policy.legal_claims(claim_id),
  provision_id text not null references regulatory.provisions(provision_id),
  support_relation text not null
    check (support_relation in ('DIRECT_SUPPORT', 'INDIRECT_SUPPORT', 'CONTRADICTS')),
  exact_locator text not null check (length(btrim(exact_locator)) > 0),
  allowed_excerpt text,
  created_at timestamptz not null default now(),
  unique (claim_id, provision_id, support_relation)
);

create table policy.review_records (
  review_id text primary key check (review_id ~ '^[a-z0-9][a-z0-9._:-]{2,160}$'),
  claim_id text not null references policy.legal_claims(claim_id),
  outcome text not null check (outcome in ('APPROVED', 'CHANGES_REQUESTED', 'REJECTED')),
  reviewer_role text not null,
  reviewer_ref text not null,
  evidence_fingerprint_sha256 text not null check (evidence_fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
  private_notes text,
  reviewed_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table policy.corpus_releases (
  release_id text primary key check (release_id ~ '^[a-z0-9][a-z0-9._:-]{2,160}$'),
  as_of timestamptz not null,
  knowledge_cutoff timestamptz not null,
  manifest_checksum_sha256 text not null check (manifest_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  release_state text not null default 'DRAFT'
    check (release_state in ('DRAFT', 'REVIEWED', 'PUBLISHED', 'SUPERSEDED', 'RETRACTED')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  check (knowledge_cutoff >= as_of),
  check ((release_state = 'PUBLISHED') = (published_at is not null))
);

create table policy.corpus_release_claims (
  release_id text not null references policy.corpus_releases(release_id),
  claim_id text not null references policy.legal_claims(claim_id),
  primary key (release_id, claim_id)
);

create table policy.event_claim_impacts (
  event_id text not null references regulatory.regulatory_events(event_id),
  claim_id text not null references policy.legal_claims(claim_id),
  impact_type text not null check (impact_type in ('MAY_AFFECT', 'INVALIDATES', 'SUPERSEDES', 'DEADLINE')),
  review_state text not null default 'PENDING'
    check (review_state in ('PENDING', 'REVIEWED', 'DISMISSED')),
  primary key (event_id, claim_id)
);

create table policy.coverage_scopes (
  jurisdiction_code text primary key check (jurisdiction_code ~ '^[A-Z][A-Z0-9-]{1,15}$'),
  display_name text not null,
  coverage_state text not null default 'IN_PROGRESS'
    check (coverage_state in ('UNSUPPORTED', 'IN_PROGRESS', 'REVIEWED')),
  completeness_percent integer not null default 0
    check (completeness_percent between 0 and 100),
  freshness_state text not null default 'UNKNOWN'
    check (freshness_state in ('CURRENT', 'STALE', 'UNKNOWN')),
  reviewed_at timestamptz,
  public_note text,
  updated_at timestamptz not null default now(),
  check (
    coverage_state <> 'REVIEWED'
    or (
      completeness_percent = 100
      and reviewed_at is not null
      and freshness_state = 'CURRENT'
    )
  )
);

insert into policy.coverage_scopes (
  jurisdiction_code, display_name, coverage_state, completeness_percent,
  freshness_state, public_note
) values
  ('EEA', 'European Economic Area', 'IN_PROGRESS', 0, 'UNKNOWN', 'Baseline legal corpus under review.'),
  ('HK', 'Hong Kong', 'IN_PROGRESS', 0, 'UNKNOWN', 'Baseline legal corpus under review.'),
  ('SG', 'Singapore', 'IN_PROGRESS', 0, 'UNKNOWN', 'Baseline legal corpus under review.');

create index source_versions_document_retrieved_idx
  on regulatory.source_versions (document_id, retrieved_at desc);
create index provisions_version_ordinal_idx
  on regulatory.provisions (version_id, ordinal);
create index legal_claims_scope_effective_idx
  on policy.legal_claims (jurisdiction_code, topic, effective_from, effective_to);
create index legal_claims_review_state_idx
  on policy.legal_claims (review_state, jurisdiction_code);
create index citations_claim_idx on policy.citations (claim_id);
create index corpus_releases_as_of_idx
  on policy.corpus_releases (release_state, as_of desc, knowledge_cutoff desc);

create function regulatory.protect_verified_source_version()
returns trigger
language plpgsql
set search_path = regulatory, policy, public
as $$
begin
  if old.lifecycle_state <> 'OBSERVED' and (
    new.version_id is distinct from old.version_id
    or new.document_id is distinct from old.document_id
    or new.version_label is distinct from old.version_label
    or new.raw_object_id is distinct from old.raw_object_id
    or new.checksum_sha256 is distinct from old.checksum_sha256
    or new.official_url is distinct from old.official_url
    or new.published_at is distinct from old.published_at
    or new.effective_from is distinct from old.effective_from
    or new.effective_to is distinct from old.effective_to
    or new.observed_at is distinct from old.observed_at
    or new.retrieved_at is distinct from old.retrieved_at
    or new.supersedes_version_id is distinct from old.supersedes_version_id
  ) then
    raise exception 'verified source version % is immutable; create a superseding version', old.version_id;
  end if;
  return new;
end;
$$;

create trigger protect_verified_source_version_trigger
before update on regulatory.source_versions
for each row execute function regulatory.protect_verified_source_version();

create function regulatory.reject_immutable_row_change()
returns trigger
language plpgsql
as $$
begin
  raise exception '% rows are immutable; create a new version', tg_table_name;
end;
$$;

create trigger protect_provision_trigger
before update or delete on regulatory.provisions
for each row execute function regulatory.reject_immutable_row_change();

create function policy.protect_reviewed_claim()
returns trigger
language plpgsql
set search_path = policy, regulatory, public
as $$
begin
  if old.review_state in ('REVIEWED', 'PUBLISHED', 'SUPERSEDED', 'RETRACTED') and (
    new.claim_id is distinct from old.claim_id
    or new.policy_domain is distinct from old.policy_domain
    or new.jurisdiction_code is distinct from old.jurisdiction_code
    or new.topic is distinct from old.topic
    or new.proposition is distinct from old.proposition
    or new.legal_status is distinct from old.legal_status
    or new.effective_from is distinct from old.effective_from
    or new.effective_to is distinct from old.effective_to
    or new.knowledge_cutoff is distinct from old.knowledge_cutoff
    or new.actor_types is distinct from old.actor_types
    or new.activity_codes is distinct from old.activity_codes
    or new.supersedes_claim_id is distinct from old.supersedes_claim_id
  ) then
    raise exception 'reviewed claim % is immutable; create a superseding claim', old.claim_id;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger protect_reviewed_claim_trigger
before update on policy.legal_claims
for each row execute function policy.protect_reviewed_claim();

create function policy.protect_reviewed_citation()
returns trigger
language plpgsql
set search_path = policy, public
as $$
declare
  v_claim_id text;
  v_state text;
begin
  if tg_op = 'DELETE' then
    v_claim_id := old.claim_id;
  else
    v_claim_id := new.claim_id;
  end if;
  select review_state into v_state from policy.legal_claims where claim_id = v_claim_id;
  if v_state in ('REVIEWED', 'PUBLISHED', 'SUPERSEDED', 'RETRACTED') then
    raise exception 'citations for reviewed claim % are immutable', v_claim_id;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger protect_reviewed_citation_trigger
before insert or update or delete on policy.citations
for each row execute function policy.protect_reviewed_citation();

create trigger protect_review_record_trigger
before update or delete on policy.review_records
for each row execute function regulatory.reject_immutable_row_change();

create function policy.validate_corpus_publication()
returns trigger
language plpgsql
set search_path = policy, regulatory, public
as $$
begin
  if new.release_state = 'PUBLISHED' and (
    tg_op = 'INSERT' or old.release_state <> 'PUBLISHED'
  ) then
    if not exists (
      select 1 from policy.corpus_release_claims crc where crc.release_id = new.release_id
    ) then
      raise exception 'corpus release % has no claims', new.release_id;
    end if;

    if exists (
      select 1
      from policy.corpus_release_claims crc
      join policy.legal_claims c on c.claim_id = crc.claim_id
      where crc.release_id = new.release_id
        and c.review_state not in ('REVIEWED', 'PUBLISHED')
    ) then
      raise exception 'corpus release % contains an unreviewed claim', new.release_id;
    end if;

    if exists (
      select 1
      from policy.corpus_release_claims crc
      where crc.release_id = new.release_id
        and not exists (
          select 1
          from policy.review_records review
          where review.claim_id = crc.claim_id and review.outcome = 'APPROVED'
        )
    ) then
      raise exception 'corpus release % contains a claim without approval', new.release_id;
    end if;

    if exists (
      select 1
      from policy.corpus_release_claims crc
      join policy.legal_claims c on c.claim_id = crc.claim_id
      where crc.release_id = new.release_id
        and (
          not exists (select 1 from policy.citations ci where ci.claim_id = c.claim_id)
          or exists (
            select 1 from policy.citations ci
            where ci.claim_id = c.claim_id and ci.support_relation = 'CONTRADICTS'
          )
          or (
            c.legal_status = 'PERMISSION'
            and not exists (
              select 1
              from policy.citations ci
              join regulatory.provisions p on p.provision_id = ci.provision_id
              join regulatory.source_versions sv on sv.version_id = p.version_id
              join regulatory.source_documents sd on sd.document_id = sv.document_id
              where ci.claim_id = c.claim_id
                and ci.support_relation = 'DIRECT_SUPPORT'
                and sd.evidence_layer = 'OFFICIAL_SOURCE'
                and sv.lifecycle_state = 'VERIFIED'
            )
          )
        )
    ) then
      raise exception 'corpus release % contains insufficient or conflicting evidence', new.release_id;
    end if;
  end if;
  return new;
end;
$$;

create trigger validate_corpus_publication_trigger
before insert or update on policy.corpus_releases
for each row execute function policy.validate_corpus_publication();

create function policy.protect_corpus_membership()
returns trigger
language plpgsql
set search_path = policy, public
as $$
declare
  v_release_id text;
  v_state text;
begin
  if tg_op = 'DELETE' then
    v_release_id := old.release_id;
  else
    v_release_id := new.release_id;
  end if;
  select release_state into v_state
  from policy.corpus_releases
  where release_id = v_release_id;
  if v_state <> 'DRAFT' then
    raise exception 'corpus release % membership is immutable outside DRAFT', v_release_id;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger protect_corpus_membership_trigger
before insert or update or delete on policy.corpus_release_claims
for each row execute function policy.protect_corpus_membership();

alter table regulatory.source_authorities enable row level security;
alter table regulatory.source_documents enable row level security;
alter table regulatory.source_versions enable row level security;
alter table regulatory.provisions enable row level security;
alter table regulatory.regulatory_events enable row level security;
alter table policy.legal_claims enable row level security;
alter table policy.citations enable row level security;
alter table policy.review_records enable row level security;
alter table policy.corpus_releases enable row level security;
alter table policy.corpus_release_claims enable row level security;
alter table policy.event_claim_impacts enable row level security;
alter table policy.coverage_scopes enable row level security;

-- Public APIs query allowlisted views through the server-side service role.
-- Reviewer identities, notes, raw rules, and customer data are absent.
create view policy.public_legal_evidence
with (security_invoker = true)
as
select
  c.claim_id,
  c.jurisdiction_code,
  c.topic,
  c.proposition,
  c.legal_status,
  c.review_state,
  c.effective_from,
  c.effective_to,
  c.knowledge_cutoff,
  ci.citation_id,
  ci.support_relation,
  ci.exact_locator,
  ci.allowed_excerpt,
  p.provision_id,
  p.version_id,
  p.language_code,
  sv.checksum_sha256 as version_checksum_sha256,
  sv.published_at,
  sv.retrieved_at,
  sv.verified_at,
  sd.document_id,
  sd.title as document_title,
  sd.document_type,
  sd.canonical_url,
  sa.authority_id,
  sa.name as authority_name
from policy.legal_claims c
join policy.citations ci on ci.claim_id = c.claim_id
join regulatory.provisions p on p.provision_id = ci.provision_id
join regulatory.source_versions sv on sv.version_id = p.version_id
join regulatory.source_documents sd on sd.document_id = sv.document_id
join regulatory.source_authorities sa on sa.authority_id = sd.authority_id
where c.review_state in ('REVIEWED', 'PUBLISHED')
  and sv.lifecycle_state in ('VERIFIED', 'SUPERSEDED', 'CORRECTED');

create view policy.public_corpus_claims
with (security_invoker = true)
as
select
  cr.release_id,
  cr.as_of,
  cr.knowledge_cutoff as release_knowledge_cutoff,
  evidence.*
from policy.corpus_releases cr
join policy.corpus_release_claims crc on crc.release_id = cr.release_id
join policy.public_legal_evidence evidence on evidence.claim_id = crc.claim_id
where cr.release_state = 'PUBLISHED'
  and evidence.effective_from <= cr.as_of
  and (evidence.effective_to is null or evidence.effective_to > cr.as_of);

create view policy.public_coverage
with (security_invoker = true)
as
select
  scope.jurisdiction_code,
  scope.display_name,
  scope.coverage_state,
  scope.completeness_percent,
  scope.freshness_state,
  scope.reviewed_at,
  scope.public_note,
  corpus.release_id,
  corpus.as_of,
  corpus.knowledge_cutoff,
  coalesce(corpus.reviewed_claim_count, 0)::integer as reviewed_claim_count,
  coalesce(corpus.source_document_count, 0)::integer as source_document_count,
  corpus.last_verified_at
from policy.coverage_scopes scope
left join lateral (
  select
    claims.release_id,
    claims.as_of,
    claims.release_knowledge_cutoff as knowledge_cutoff,
    count(distinct claims.claim_id) as reviewed_claim_count,
    count(distinct claims.document_id) as source_document_count,
    max(claims.verified_at) as last_verified_at
  from policy.public_corpus_claims claims
  where claims.jurisdiction_code = scope.jurisdiction_code
  group by claims.release_id, claims.as_of, claims.release_knowledge_cutoff
  order by claims.as_of desc, claims.release_knowledge_cutoff desc
  limit 1
) corpus on true;

create view policy.public_regulatory_changes
with (security_invoker = true)
as
select distinct
  event.event_id,
  event.event_type,
  event.title,
  event.observed_at,
  event.effective_at,
  event.before_version_id,
  event.after_version_id,
  authority.authority_id,
  authority.name as authority_name,
  impact.claim_id,
  impact.impact_type,
  claim.jurisdiction_code,
  claim.topic
from regulatory.regulatory_events event
join regulatory.source_authorities authority on authority.authority_id = event.authority_id
join policy.event_claim_impacts impact on impact.event_id = event.event_id
join policy.legal_claims claim on claim.claim_id = impact.claim_id
where event.event_state = 'PUBLISHED'
  and impact.review_state = 'REVIEWED'
  and exists (
    select 1
    from policy.public_corpus_claims corpus
    where corpus.claim_id = claim.claim_id
  );

revoke all on schema regulatory from anon, authenticated;
revoke all on all tables in schema regulatory from anon, authenticated;
revoke all on table
  policy.legal_claims,
  policy.citations,
  policy.review_records,
  policy.corpus_releases,
  policy.corpus_release_claims,
  policy.event_claim_impacts,
  policy.coverage_scopes,
  policy.public_legal_evidence,
  policy.public_corpus_claims,
  policy.public_coverage,
  policy.public_regulatory_changes
from anon, authenticated;

grant usage on schema regulatory, policy to service_role;
grant select, insert, update, delete on all tables in schema regulatory to service_role;
grant select, insert, update, delete on table
  policy.legal_claims,
  policy.citations,
  policy.review_records,
  policy.corpus_releases,
  policy.corpus_release_claims,
  policy.event_claim_impacts,
  policy.coverage_scopes
to service_role;
grant select on table
  policy.public_legal_evidence,
  policy.public_corpus_claims,
  policy.public_coverage,
  policy.public_regulatory_changes
to service_role;
grant execute on all functions in schema regulatory to service_role;
grant execute on function
  policy.protect_reviewed_claim(),
  policy.protect_reviewed_citation(),
  policy.validate_corpus_publication(),
  policy.protect_corpus_membership()
to service_role;

comment on schema regulatory is
  'Cross-domain official authorities, immutable source versions, provisions, and regulatory events.';
comment on table policy.review_records is
  'Private human-review audit records; never query this table from a public endpoint.';
comment on view policy.public_corpus_claims is
  'Presentation-safe reviewed legal evidence pinned to a published corpus release and as-of date.';

commit;
