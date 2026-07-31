# Database migrations

SQL migrations are append-only and run in lexical order. They target Supabase PostgreSQL but keep application-facing repository contracts provider-neutral.

Migrations are not applied automatically by the Next.js application. Production application requires an explicit reviewed deployment step, backup verification, and environment-specific credentials. Tables containing customer or paid data enable row-level security by default and are accessed only through the server-side data layer.
