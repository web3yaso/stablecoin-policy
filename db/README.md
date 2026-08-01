# Database migrations

SQL migrations are append-only and run in lexical order. They target Supabase PostgreSQL but keep application-facing repository contracts provider-neutral.

Migrations are not applied automatically by the Next.js application. Production application requires an explicit reviewed deployment step, backup verification, and environment-specific credentials. Tables containing customer or paid data enable row-level security by default and are accessed only through the server-side data layer.

Phase 1 requires private `policy-reports` and `policy-datasets` Storage buckets (or the names configured through server-only environment variables). The Supabase API must expose the `policy` schema to the service role. Apply migrations before running `npm run storage:publish`; use `npm run storage:restore` without `--apply` to verify a rollback target before moving an active release pointer.
