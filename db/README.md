# Database migrations

SQL migrations are append-only, run in lexical order, and live in the
Supabase CLI canonical directory `supabase/migrations/`. They target Supabase
PostgreSQL but keep application-facing repository contracts provider-neutral.

Migrations are not applied automatically by the Next.js application. Production application requires an explicit reviewed deployment step, backup verification, and environment-specific credentials. Tables containing customer or paid data enable row-level security by default and are accessed only through the server-side data layer.

Phase 1 requires private `policy-reports` and `policy-datasets` Storage buckets (or the names configured through server-only environment variables). The Supabase API must expose the `policy` schema to the service role. Apply migrations before running `npm run storage:publish`; use `npm run storage:restore` without `--apply` to verify a rollback target before moving an active release pointer.

Phase 2 adds a `regulatory` schema for official-source records shared across
Citely policy domains and keeps Stablecoin-specific claims, citations, reviews,
and corpus releases in `policy`. Both schemas remain RLS-protected and are read
by public endpoints only through presentation-safe views and the server-side
service role. It also requires a private `policy-sources` Storage bucket (or
the bucket configured by `SUPABASE_SOURCES_BUCKET`); migration `0003` creates
the default bucket. Migrations are not applied by application startup.
