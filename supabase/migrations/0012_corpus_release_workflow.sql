begin;

alter table policy.corpus_releases
  drop constraint corpus_releases_release_state_check;
alter table policy.corpus_releases
  add constraint corpus_releases_release_state_check
  check (release_state in (
    'DRAFT', 'IN_REVIEW', 'REVIEWED', 'PUBLISHED', 'SUPERSEDED', 'RETRACTED'
  ));
alter table policy.corpus_releases
  add column submitted_at timestamptz;

create table policy.corpus_release_review_records (
  release_review_id text primary key
    check (release_review_id ~ '^[a-z0-9][a-z0-9._:-]{2,160}$'),
  release_id text not null references policy.corpus_releases(release_id),
  outcome text not null check (outcome in ('APPROVED', 'CHANGES_REQUESTED', 'REJECTED')),
  reviewer_role text not null check (nullif(btrim(reviewer_role), '') is not null),
  reviewer_ref text not null check (nullif(btrim(reviewer_ref), '') is not null),
  manifest_sha256 text not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  reviewed_at timestamptz not null,
  private_notes text,
  created_at timestamptz not null default now()
);

create unique index corpus_release_one_approval_idx
  on policy.corpus_release_review_records (release_id)
  where outcome = 'APPROVED';

create trigger protect_corpus_release_review_record_trigger
before update or delete on policy.corpus_release_review_records
for each row execute function regulatory.reject_immutable_row_change();

alter table policy.corpus_release_review_records enable row level security;

create function policy.build_corpus_release_manifest(p_release_id text)
returns jsonb
language sql
stable
set search_path = policy, regulatory, public, extensions
as $$
  select jsonb_build_object(
    'schemaVersion', '1.0.0',
    'releaseId', release.release_id,
    'asOf', release.as_of,
    'knowledgeCutoff', release.knowledge_cutoff,
    'claims', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'claimId', claim.claim_id,
          'claimManifest', policy.build_legal_claim_review_manifest(claim.claim_id),
          'claimManifestSha256', encode(
            extensions.digest(
              convert_to(
                policy.build_legal_claim_review_manifest(claim.claim_id)::text,
                'UTF8'
              ),
              'sha256'
            ),
            'hex'
          )
        ) order by claim.claim_id
      )
      from policy.corpus_release_claims membership
      join policy.legal_claims claim on claim.claim_id = membership.claim_id
      where membership.release_id = release.release_id
    ), '[]'::jsonb)
  )
  from policy.corpus_releases release
  where release.release_id = p_release_id;
$$;

create function policy.get_corpus_release_review_manifest(p_release_id text)
returns jsonb
language plpgsql
stable
set search_path = policy, regulatory, public, extensions
as $$
declare
  v_release policy.corpus_releases%rowtype;
  v_manifest jsonb;
  v_readiness_errors text[];
begin
  select * into strict v_release
  from policy.corpus_releases
  where release_id = p_release_id;
  v_manifest := policy.build_corpus_release_manifest(p_release_id);

  select array_remove(array[
    case when count(*) = 0 then 'claims_missing' end,
    case when count(*) filter (
      where claim.review_state not in ('REVIEWED', 'PUBLISHED')
    ) > 0 then 'unreviewed_claim' end,
    case when count(*) filter (
      where not exists (
        select 1
        from policy.review_records review
        where review.claim_id = claim.claim_id
          and review.outcome = 'APPROVED'
          and review.evidence_fingerprint_sha256 = encode(
            extensions.digest(
              convert_to(
                policy.build_legal_claim_review_manifest(claim.claim_id)::text,
                'UTF8'
              ),
              'sha256'
            ),
            'hex'
          )
      )
    ) > 0 then 'claim_approval_missing_or_stale' end,
    case when count(*) filter (
      where claim.effective_from > v_release.as_of
        or (claim.effective_to is not null and claim.effective_to <= v_release.as_of)
    ) > 0 then 'claim_outside_as_of' end,
    case when count(*) filter (
      where claim.knowledge_cutoff > v_release.knowledge_cutoff
    ) > 0 then 'claim_after_knowledge_cutoff' end
  ], null)
  into v_readiness_errors
  from policy.corpus_release_claims membership
  join policy.legal_claims claim on claim.claim_id = membership.claim_id
  where membership.release_id = p_release_id;

  return jsonb_build_object(
    'manifest', v_manifest,
    'manifestSha256', encode(
      extensions.digest(convert_to(v_manifest::text, 'UTF8'), 'sha256'),
      'hex'
    ),
    'releaseState', v_release.release_state,
    'submittedAt', v_release.submitted_at,
    'publishedAt', v_release.published_at,
    'readinessErrors', to_jsonb(v_readiness_errors)
  );
end;
$$;

create function policy.create_corpus_release(
  p_release_id text,
  p_as_of timestamptz,
  p_knowledge_cutoff timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = policy, regulatory, public
as $$
begin
  if p_release_id !~ '^[a-z0-9][a-z0-9._:-]{2,160}$' then
    raise exception 'invalid corpus release id';
  end if;
  if p_as_of is null or p_knowledge_cutoff is null or p_knowledge_cutoff < p_as_of then
    raise exception 'invalid corpus release time boundary';
  end if;
  insert into policy.corpus_releases (
    release_id, as_of, knowledge_cutoff, manifest_checksum_sha256, release_state
  ) values (
    p_release_id, p_as_of, p_knowledge_cutoff, repeat('0', 64), 'DRAFT'
  );
  return jsonb_build_object('releaseId', p_release_id, 'releaseState', 'DRAFT');
end;
$$;

create function policy.submit_corpus_release_for_review(p_release_id text)
returns jsonb
language plpgsql
security definer
set search_path = policy, regulatory, public, extensions
as $$
declare
  v_release policy.corpus_releases%rowtype;
  v_manifest jsonb;
  v_manifest_sha256 text;
begin
  select * into strict v_release
  from policy.corpus_releases
  where release_id = p_release_id
  for update;
  if v_release.release_state <> 'DRAFT' then
    raise exception 'only DRAFT corpus releases may be submitted for review';
  end if;
  if not exists (
    select 1 from policy.corpus_release_claims where release_id = p_release_id
  ) then
    raise exception 'corpus release review requires at least one claim';
  end if;
  v_manifest := policy.build_corpus_release_manifest(p_release_id);
  v_manifest_sha256 := encode(
    extensions.digest(convert_to(v_manifest::text, 'UTF8'), 'sha256'),
    'hex'
  );
  update policy.corpus_releases
  set release_state = 'IN_REVIEW',
      manifest_checksum_sha256 = v_manifest_sha256,
      submitted_at = now()
  where release_id = p_release_id;
  return jsonb_build_object(
    'releaseId', p_release_id,
    'releaseState', 'IN_REVIEW',
    'manifestSha256', v_manifest_sha256
  );
end;
$$;

create function policy.review_corpus_release(
  p_release_review_id text,
  p_release_id text,
  p_outcome text,
  p_reviewer_role text,
  p_reviewer_ref text,
  p_manifest_sha256 text,
  p_reviewed_at timestamptz,
  p_private_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = policy, regulatory, public, extensions
as $$
declare
  v_release policy.corpus_releases%rowtype;
  v_envelope jsonb;
  v_actual_manifest_sha256 text;
  v_readiness_errors jsonb;
  v_next_state text;
begin
  if p_release_review_id !~ '^[a-z0-9][a-z0-9._:-]{2,160}$' then
    raise exception 'invalid corpus release review id';
  end if;
  if p_outcome not in ('APPROVED', 'CHANGES_REQUESTED', 'REJECTED') then
    raise exception 'invalid corpus release review outcome';
  end if;
  if nullif(btrim(p_reviewer_role), '') is null
     or nullif(btrim(p_reviewer_ref), '') is null
     or lower(btrim(p_reviewer_ref)) in ('ai', 'llm', 'system', 'automation', 'unknown') then
    raise exception 'corpus release review requires an identified human reviewer';
  end if;
  if p_manifest_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid corpus release manifest checksum';
  end if;
  if p_reviewed_at is null or p_reviewed_at > now() + interval '5 minutes' then
    raise exception 'invalid corpus release review time';
  end if;

  select * into strict v_release
  from policy.corpus_releases
  where release_id = p_release_id
  for update;
  if v_release.release_state <> 'IN_REVIEW' then
    raise exception 'only IN_REVIEW corpus releases may be reviewed';
  end if;
  if p_reviewed_at < v_release.submitted_at then
    raise exception 'corpus release review cannot predate submission';
  end if;

  v_envelope := policy.get_corpus_release_review_manifest(p_release_id);
  v_actual_manifest_sha256 := v_envelope->>'manifestSha256';
  v_readiness_errors := v_envelope->'readinessErrors';
  if v_actual_manifest_sha256 is distinct from p_manifest_sha256
     or v_release.manifest_checksum_sha256 is distinct from p_manifest_sha256 then
    raise exception 'corpus release manifest checksum mismatch';
  end if;
  if p_outcome = 'APPROVED' and jsonb_array_length(v_readiness_errors) > 0 then
    raise exception 'corpus release is not ready for approval';
  end if;

  insert into policy.corpus_release_review_records (
    release_review_id, release_id, outcome, reviewer_role, reviewer_ref,
    manifest_sha256, reviewed_at, private_notes
  ) values (
    p_release_review_id, p_release_id, p_outcome, btrim(p_reviewer_role),
    btrim(p_reviewer_ref), p_manifest_sha256, p_reviewed_at,
    nullif(btrim(p_private_notes), '')
  );

  v_next_state := case p_outcome
    when 'APPROVED' then 'REVIEWED'
    when 'CHANGES_REQUESTED' then 'DRAFT'
    else 'RETRACTED'
  end;
  update policy.corpus_releases
  set release_state = v_next_state,
      submitted_at = case when v_next_state = 'DRAFT' then null else submitted_at end
  where release_id = p_release_id;
  return jsonb_build_object(
    'releaseReviewId', p_release_review_id,
    'releaseId', p_release_id,
    'outcome', p_outcome,
    'releaseState', v_next_state,
    'manifestSha256', p_manifest_sha256,
    'reviewedAt', p_reviewed_at
  );
end;
$$;

create function policy.publish_corpus_release(
  p_release_id text,
  p_manifest_sha256 text,
  p_published_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = policy, regulatory, public, extensions
as $$
declare
  v_release policy.corpus_releases%rowtype;
  v_envelope jsonb;
begin
  select * into strict v_release
  from policy.corpus_releases
  where release_id = p_release_id
  for update;
  if v_release.release_state <> 'REVIEWED' then
    raise exception 'only REVIEWED corpus releases may be published';
  end if;
  if p_published_at is null or p_published_at > now() + interval '5 minutes' then
    raise exception 'invalid corpus release publication time';
  end if;
  v_envelope := policy.get_corpus_release_review_manifest(p_release_id);
  if p_manifest_sha256 is distinct from v_release.manifest_checksum_sha256
     or p_manifest_sha256 is distinct from v_envelope->>'manifestSha256'
     or jsonb_array_length(v_envelope->'readinessErrors') > 0
     or not exists (
       select 1 from policy.corpus_release_review_records review
       where review.release_id = p_release_id
         and review.outcome = 'APPROVED'
         and review.manifest_sha256 = p_manifest_sha256
     ) then
    raise exception 'corpus release approval is missing, stale, or invalid';
  end if;
  update policy.corpus_releases
  set release_state = 'PUBLISHED', published_at = p_published_at
  where release_id = p_release_id;
  return jsonb_build_object(
    'releaseId', p_release_id,
    'releaseState', 'PUBLISHED',
    'manifestSha256', p_manifest_sha256,
    'publishedAt', p_published_at
  );
end;
$$;

create function policy.validate_corpus_release_approval()
returns trigger
language plpgsql
set search_path = policy, regulatory, public, extensions
as $$
declare
  v_manifest jsonb;
  v_manifest_sha256 text;
begin
  if new.release_state = 'PUBLISHED' and (
    tg_op = 'INSERT' or old.release_state <> 'PUBLISHED'
  ) then
    v_manifest := policy.build_corpus_release_manifest(new.release_id);
    v_manifest_sha256 := encode(
      extensions.digest(convert_to(v_manifest::text, 'UTF8'), 'sha256'),
      'hex'
    );
    if new.manifest_checksum_sha256 is distinct from v_manifest_sha256
       or not exists (
         select 1 from policy.corpus_release_review_records review
         where review.release_id = new.release_id
           and review.outcome = 'APPROVED'
           and review.manifest_sha256 = v_manifest_sha256
       ) then
      raise exception 'corpus release % lacks a current approval', new.release_id;
    end if;
  end if;
  return new;
end;
$$;

create trigger validate_corpus_release_approval_trigger
before insert or update on policy.corpus_releases
for each row execute function policy.validate_corpus_release_approval();

revoke insert, update, delete on table policy.corpus_releases from service_role;
grant select on table policy.corpus_releases to service_role;
revoke all on table policy.corpus_release_review_records
from public, anon, authenticated;
grant select on table policy.corpus_release_review_records to service_role;

revoke all on function policy.build_corpus_release_manifest(text)
from public, anon, authenticated;
grant execute on function policy.build_corpus_release_manifest(text) to service_role;
revoke all on function policy.get_corpus_release_review_manifest(text)
from public, anon, authenticated;
grant execute on function policy.get_corpus_release_review_manifest(text) to service_role;
revoke all on function policy.create_corpus_release(text, timestamptz, timestamptz)
from public, anon, authenticated;
grant execute on function policy.create_corpus_release(text, timestamptz, timestamptz)
to service_role;
revoke all on function policy.submit_corpus_release_for_review(text)
from public, anon, authenticated;
grant execute on function policy.submit_corpus_release_for_review(text) to service_role;
revoke all on function policy.review_corpus_release(
  text, text, text, text, text, text, timestamptz, text
) from public, anon, authenticated;
grant execute on function policy.review_corpus_release(
  text, text, text, text, text, text, timestamptz, text
) to service_role;
revoke all on function policy.publish_corpus_release(text, text, timestamptz)
from public, anon, authenticated;
grant execute on function policy.publish_corpus_release(text, text, timestamptz)
to service_role;

comment on table policy.corpus_release_review_records is
  'Immutable private named-human review records for exact corpus release manifests.';
comment on function policy.publish_corpus_release is
  'Publishes only a currently approved, readiness-clean corpus release manifest.';

commit;
