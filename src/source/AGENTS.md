# src/source - declarative source extraction

## Contract

This directory resolves declarative sources and turns SQL trees into normalized schema models. It is included so file-based source, runtime source defaults, schema filtering, and normalization all feed the same planner model.

## Contents

- `resolve.ts` resolves source defaults and migration directories from config.
- `extract.ts` reads source trees and extracts schema models.
- `normalize.ts` normalizes extracted source objects.
- `replay.ts` reconstructs a typegen model from `migrations:` histories.

## Working Rules

- Use parser-backed SQL extraction through `src/sql`, not ad hoc text matching.
- Keep schema filters and managed-schema exclusions before planner input.
- Normalize source models deterministically so generated diffs are stable.
- `migrations:` is a runtime source kind for `types --from`. Do not route `diff`, `verify`, or drift targets through it until migration-replay fingerprints are proven planner-grade.
- `replay.ts` reads migration files in filename order and mutates the in-memory model. Keep column and enum mutations in the reducer; do not refactor `alterTableObjects` into this lane unless it can return per-subtype mutation results.
- Replay hard-fails shape-corrupting gaps with named diagnostics: missing directories, duplicate `CREATE` objects, absent non-optional `DROP` targets, absent non-ignored `ALTER TABLE` targets, and absent enum neighbors use `SUPA_REPLAY_ORDER_GAP`; unsupported top-level DDL, unsupported `ALTER TABLE` subtypes, unsupported `DROP` kinds, and unsupported rename targets use `SUPA_REPLAY_UNSUPPORTED`.
- Replay skips configured managed or excluded schemas before planner input, so Supabase-managed history noise such as `auth` DDL can be omitted without emitting `unknown` shapes.
- Simple schema DDL inside idempotent `DO` blocks is replayed from the block body when it can be parsed. Other data and control-plane statements do not mutate schema shape.

## Verification

Run focused source, normalization, or generated-output tests for changed behavior, then `npm run typecheck`.
