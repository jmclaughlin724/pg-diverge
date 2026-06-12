---
title: "Support matrix"
description: "The PostgreSQL object types supaschema extracts, renders, checks, and intentionally blocks."
---

# Support Matrix

`supaschema` is fail-closed: unsupported DDL blocks migration generation instead of guessing. Extraction and checking are AST-only — every statement is classified through the PostgreSQL parser, never regex.

| Object | Extract | Render | Notes |
| --- | --- | --- | --- |
| Schemas | Yes | `CREATE SCHEMA IF NOT EXISTS` / `DROP SCHEMA IF EXISTS` | Supabase-managed schemas are blocked in `supabase-auto`. |
| Extensions | Yes | `CREATE EXTENSION IF NOT EXISTS` | Extension schema is fingerprint metadata. |
| Types/enums | Yes | `DO` catalog guard / `DROP TYPE IF EXISTS`; appended enum values render as `ALTER TYPE ... ADD VALUE IF NOT EXISTS` | Enum narrowing, removal, or reordering is destructive. |
| Domains | Yes | `DO` catalog guard / `DROP DOMAIN IF EXISTS` | Domain replacement is destructive. |
| Tables | Yes | `CREATE TABLE IF NOT EXISTS`; additive columns use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` | Unsafe column changes, table replacement, and table drop block. Standalone `ALTER COLUMN ... SET/DROP DEFAULT` folds into the table's canonical shape. |
| Foreign data wrappers | Yes (whole-object) | `DO` catalog guard (no `IF NOT EXISTS` form upstream) / `DROP FOREIGN DATA WRAPPER IF EXISTS` | Drops and replaces are destructive-gated. Extension-owned wrappers are excluded from catalogs. |
| Foreign servers | Yes (whole-object) | `CREATE SERVER IF NOT EXISTS` / `DROP SERVER IF EXISTS` | Drops and replaces are destructive-gated. |
| Foreign tables | Yes (whole-object) | `CREATE FOREIGN TABLE IF NOT EXISTS` / `DROP FOREIGN TABLE IF EXISTS` | No column-level diffing; user mappings are excluded (credentials). |
| Constraints | Yes | `DO` catalog guard / `DROP CONSTRAINT IF EXISTS` | External `ALTER TABLE ADD CONSTRAINT` is modeled separately. |
| Indexes | Yes | `CREATE INDEX IF NOT EXISTS` | `CONCURRENTLY` emits transaction metadata. |
| Sequences | Yes | `CREATE SEQUENCE IF NOT EXISTS` | Drop requires destructive hint. |
| Functions/procedures | Yes | `CREATE OR REPLACE` / `DROP ... IF EXISTS` | Return-type incompatible replacements fail verification. |
| Views | Yes | `CREATE OR REPLACE VIEW` | PostgreSQL-compatible replacement shape must be verified. |
| Materialized views | Yes | `CREATE MATERIALIZED VIEW IF NOT EXISTS` | Replacement/drop requires destructive hint. |
| Triggers | Yes | `DROP TRIGGER IF EXISTS` then create | Replacement is explicit. |
| RLS | Yes | `ALTER TABLE ... ROW LEVEL SECURITY` | Removal/replacement is destructive. |
| Policies | Yes | `DROP POLICY IF EXISTS` then create | PostgreSQL has no `CREATE OR REPLACE POLICY`. |
| Grants/default privileges | Yes (structured per target × grantee) | Canonical `GRANT`; hinted removal renders `REVOKE` / reverse `ALTER DEFAULT PRIVILEGES ... REVOKE` | Split statements for one target × grantee aggregate into one privilege-set identity (full-set unions collapse to `ALL`); mixed `WITH GRANT OPTION` splits stay duplicate errors. |
| Comments | Yes (keyed by structured descriptor) | `COMMENT ON ...`; removal renders `COMMENT ON ... IS NULL` | Live catalogs extract relation, column, function, and schema comments. |
| Side-effect statements | Blocks | No | `INSERT`, `UPDATE`, `DELETE`, `DO`, and control-plane `SELECT` statements belong in explicit reviewed migrations. |

## Supabase Adapter

With `adapter: "supabase-auto"`, objects in these platform-owned schemas are blocked: `auth`, `storage`, `realtime`, `vault`, `extensions`, `cron`, `net`, `supabase_functions`, `graphql`, and `graphql_public`.

## Verify Environment Stub

`verify --ensure-environment` (the default under `adapter: "supabase-auto"`) provisions a minimal stand-in for the Supabase-provisioned surface so a declarative tree that *references* managed schemas can apply against bare PostgreSQL:

- `auth.users` with the stable GoTrue column set (`id`, `aud`, `role`, `email`, `phone`, `raw_app_meta_data`, `raw_user_meta_data`, `last_sign_in_at`, `is_anonymous`, …).
- The `auth.uid()`, `auth.role()`, `auth.jwt()`, and `auth.email()` helper functions.
- The `cron.job` and `cron.job_run_details` tables.

The stub is symmetric across both temporary databases and subtracted from the reconvergence check, so it never affects catalog parity. It is an **approximation**: other managed objects (`storage.*`, `realtime.*`, `vault.*`, `auth.identities`, `auth.sessions`, …) are not stubbed. A migration that references an un-stubbed managed object fails verify with `SUPA_VERIFY_FAILED` plus a `SUPA_VERIFY_STUB_REFERENCE` warning naming the schema — that failure may be a stub limitation rather than a real defect; confirm by applying the migration to a real disposable Supabase database (a local stack via `supabase db push`, or a preview branch) — `verify` always creates fresh temporary databases, so `--no-ensure-environment` helps only when the verification server itself provisions the managed surface in new databases.

## Examples

- `examples/supabase/schemas` demonstrates Supabase-style declarative schema input with RLS and policies; `examples/supabase/schemas-next` is the evolved tree, so a full diff runs out of the box:

  ```bash
  cd examples/supabase
  npx supaschema diff --from dir:schemas --to dir:schemas-next --out stdout
  ```

- `examples/postgres/schemas` demonstrates a generic PostgreSQL schema tree without Supabase-managed schema rules.

## Rename Policy

Rename detection is hints-only. The planner does not infer renames from similar definitions because a false positive can destroy data.

Explicit hints render guarded idempotent renames for schemas, tables, sequences, indexes, functions, procedures, views, and materialized views. Unsupported rename kinds, schema moves, and kind mismatches block.
