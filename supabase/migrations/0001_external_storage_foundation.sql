begin;

create schema if not exists policy;

create table policy.storage_objects (
  object_id text primary key,
  provider text not null,
  bucket text not null,
  object_key text not null,
  checksum_sha256 text not null check (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  byte_size bigint not null check (byte_size >= 0),
  content_type text not null,
  encryption_state text not null default 'APPLICATION_ENCRYPTED'
    check (encryption_state in ('NONE', 'PROVIDER_ENCRYPTED', 'APPLICATION_ENCRYPTED')),
  created_at timestamptz not null default now(),
  unique (provider, bucket, object_key)
);

create table policy.reports (
  report_id text primary key,
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{5,80}$'),
  active_release_id text,
  created_at timestamptz not null default now()
);

create table policy.report_releases (
  release_id text primary key,
  report_id text not null references policy.reports(report_id),
  artifact_object_id text not null references policy.storage_objects(object_id),
  title text not null,
  title_en text,
  summary text not null,
  category text not null
    check (category in ('enforcement', 'policy', 'licensing', 'sanctions', 'analysis')),
  jurisdictions text[] not null check (cardinality(jurisdictions) > 0),
  published_at timestamptz not null,
  word_count integer not null check (word_count >= 0),
  price_usd numeric(12, 2) not null check (price_usd > 0),
  source_url text,
  publication_state text not null default 'DRAFT'
    check (publication_state in ('DRAFT', 'REVIEWED', 'PUBLISHED', 'SUPERSEDED', 'RETRACTED')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (report_id, published_at)
);

alter table policy.reports
  add constraint reports_active_release_fk
  foreign key (active_release_id)
  references policy.report_releases(release_id);

create index report_releases_report_published_idx
  on policy.report_releases (report_id, published_at desc);

create index report_releases_publication_state_idx
  on policy.report_releases (publication_state, published_at desc);

alter table policy.storage_objects enable row level security;
alter table policy.reports enable row level security;
alter table policy.report_releases enable row level security;

comment on table policy.storage_objects is
  'Immutable object references and integrity metadata; object bodies remain in object storage.';
comment on table policy.report_releases is
  'Versioned report metadata linked to an immutable artifact; rows are never updated in place after publication.';

commit;
