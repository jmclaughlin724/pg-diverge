# src/catalog - live catalog extraction

## Contract

This directory reads PostgreSQL catalogs and converts live database state into the supaschema schema model. It is included because diff, verify, and typegen must compare declarative source against what Postgres actually stores.

## Contents

- `query.ts` defines the read-only catalog query adapter and shared row coercion.
- `extract.ts` orchestrates live model extraction.
- `tables.ts`, `types.ts`, `sequences.ts`, `foreign.ts`, `grants.ts`, and `comments.ts` collect specific object families.

## Working Rules

- Catalog collectors must be read-only and use `pg_catalog` facts rather than inferred SQL text.
- Keep schema filtering in the catalog query path so managed schemas stay out of downstream models.
- Add new object support by collecting facts here, finalizing them through `src/sql/facts.ts`, and planning/rendering them explicitly.

## Verification

Run the focused catalog or generated-output test for changed collectors, then `npm run typecheck`.
