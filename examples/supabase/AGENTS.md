# Supabase Example

This directory is a miniature Supabase consumer project. Its
`supaschema.config.json` owns the example workflow inputs:

- `schemaPaths`: `supabase/schemas`
- `migrationsDir`: `supabase/migrations`
- `sources.from`: `dump:baseline.sql`
- `sources.to`: `dir:supabase/schemas`

Agents should use the configured zero-source-flag workflow. Do not introduce a
parallel schema tree such as `schemas-next`, and do not hand-author generated
migrations. `baseline.sql` exists only as the configured before-state that makes
the example runnable without a database.
