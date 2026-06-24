# src/migrations - migration files and replay lane

## Contract

This directory owns migration file discovery, lineage, staging, history status, runner execution, and source-intent extraction. It is included so generated migrations form a replay-safe lane that can be checked against existing pending migrations.

## Contents

- `files.ts` names and discovers migration files.
- `lineage.ts` reads and writes supaschema lineage markers.
- `stage.ts` stages generated migrations.
- `status.ts` compares local files and database migration history.
- `runners.ts` runs direct and Supabase CLI migration flows.
- `intent.ts` reads reviewed destructive intent from existing migration SQL.

## Working Rules

- Preserve lineage checks unless the caller explicitly asks for a bypass.
- Treat generated migration files as artifacts; change source or planner behavior instead of hand-patching output.
- Migration intent may disclose reviewed destructive behavior, but it must not silently erase real replay risk.

## Verification

Run focused lineage, migration-corpus, or runner tests for changed behavior, then `npm run typecheck`.
