# Benchmark Reference Results

This file archives dated benchmark reports outside automatic `AGENTS.md` context.

## Historical Supabase CLI Workarounds

The benchmark harness uses `SUPASCHEMA_COMPARE_SEED_ROLE=postgres` with `supabase_admin` compare URLs because CLI 2.105 behaved differently for `supabase_admin`-owned user objects in a 2026-06-11 bisection:

1. `supabase db diff --from <db1> --to <db2>` returned an empty diff with exit 0 when differing user objects were owned by `supabase_admin`; the same databases diffed correctly after ownership transfer to `postgres`.
2. The CLI appended `&sslmode=...` to bare `--to` URLs without an existing query string, which corrupted the database name under debug output. Benchmark URLs should include an existing query string such as `?sslmode=disable`.

## Archived Reference Results (as of 2026-06-12)

Single sequential reference run, 2026-06-12 (`BENCH_ALL_SEQUENTIAL=1 bash benchmarks/tools/bench-all.sh`), with diff-output accuracy scoring active: Apple Silicon (darwin arm64), Node 24, PostgreSQL 17.6 (Supabase local), Supabase CLI 2.106.0, supaschema 0.1.0 with deparse normalization and generated contracts measured in the workflow lane. Fixture scale: `additive`/`functions-policies` approximately 1 table; `realistic` = 50 tables (~350 objects); `xl` = 1,000 tables (~7,000 objects); `xxl` = 2,500 tables (~17,500 objects). 3 iterations per cell, single-iteration at `xxl`. Regenerate with `benchmarks/tools/bench-all.sh` (parallel by default; `BENCH_ALL_SEQUENTIAL=1` for publication-grade latency medians free of cross-fixture CPU contention); per-fixture rows live in `<fixture>-results.json` and the generated `summary.md`. All durations are seconds.

| Fixture | supaschema (file / live-db) | Supabase engines | Replay-safe (applies twice) | Output F1 (supaschema / engines) |
| --- | --- | --- | --- | --- |
| `additive` | 0.19s / 0.21s | 3.6-4.6s | supaschema only | - (no manifest) |
| `functions-policies` | 0.18s / 0.21s | 3.3-3.7s | all tools | - (no manifest) |
| `realistic` | 0.19s / 0.23s | 4.0-4.4s | supaschema only | 1.000 / 0.982 |
| `xl` | 1.38s / 1.25s | 38.5-39.1s | supaschema only | 1.000 / 0.999 |
| `xxl` | 3.2s / 2.8s | 204.5-210.0s | supaschema only | 1.000 / 0.999 |

The full-workflow lanes from the same run measure the real-world step of producing the migration and regenerated types:

| Fixture | `supaschema-workflow` (sync migration + TS types + Zod) | `supabase-*-workflow` (db diff + apply + gen types) |
| --- | --- | --- |
| `additive` | 0.24s | 5.8-8.1s |
| `functions-policies` | 0.23s | 5.7-6.2s |
| `realistic` | 0.26s | 6.4-7.6s |
| `xl` | 2.25s | 44.8-50.4s |
| `xxl` | 5.22s | 212.6-229.7s |

Regression with schema size: supaschema stays near three seconds through 2,500 tables because its cost is parse/plan/catalog-read bound. All five Supabase shadow-database engines cluster near ~3.5-4.5s even at one table and grow with schema replay cost to ~39s at 1,000 tables and ~3.4-3.5 minutes at 2,500, so the gap grows from ~20x to ~70x. Verification outcomes are scale-independent: Supabase engines emit unguarded DDL, so apply-twice fails on every fixture whose diff contains `ADD COLUMN`/`CREATE INDEX` statements (`additive`, `realistic`, `xl`, `xxl`); `functions-policies` passes everywhere because its diff is entirely `CREATE OR REPLACE`. Accuracy outcomes: supaschema scores F1 1.000 in both modes on every manifest-scored fixture; every Supabase engine misses the policy-predicate change (recall loss to 0.982 at 50 tables, 0.999 at 1,000/2,500 where the larger manifest dilutes the same miss).

The internal threshold suite (`npm run benchmark`) enforces these as regression gates in CI on PostgreSQL 15/16/17. Reference warm-max values from the same machine: `realisticTreeDiff` 15ms, `noDriftDiff` 15ms, `largeInMemoryDiff` 74ms (250 tables), `liveCatalogDiff` 39ms, `liveCatalogDiffXl` 426ms, `endToEndMigration` 11ms, `endToEndMigrationLarge` 185ms, `endToEndMigrationXl` 692ms, `shadowRoundTripDiff` 1019ms, `replayVerification` 132ms.
