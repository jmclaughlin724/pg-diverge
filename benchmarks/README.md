# Comparison Benchmarks

This harness compares `supaschema` against Supabase CLI schema diff engines. It writes machine-readable JSON and SVG charts.

## Run

```bash
SUPASCHEMA_COMPARE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
  npm run bench:compare

npm run bench:plot
```

`bench:plot` accepts any number of result JSON files plus an optional output directory and emits one artifact set per fixture (sample size), so each scale is saved and read separately:

```bash
node benchmarks/plot.js benchmarks/results/comparison.json benchmarks/results/comparison-xl.json
```

Outputs:

- `benchmarks/results/comparison.json` — raw rows from `bench:compare` (use `SUPASCHEMA_COMPARE_OUT` to direct separate runs to separate files, e.g. `comparison-xl.json`)
- per fixture: `<fixture>-latency.svg`, `<fixture>-correctness.svg`, and `<fixture>-results.json` (that fixture's rows plus source-run metadata)
- `summary.md` — per-fixture result tables plus a cross-fixture scaling table (each tool's median and its ratio vs its own smallest fixture)

## Tool Selection

By default the harness attempts `supaschema` plus every Supabase `db diff` engine available in the installed CLI. Limit the run with comma-separated filters:

```bash
SUPASCHEMA_COMPARE_TOOLS=supaschema-file,supaschema-db,supabase-pg-delta \
SUPASCHEMA_COMPARE_FIXTURES=additive \
SUPASCHEMA_COMPARE_ITERATIONS=10 \
SUPASCHEMA_COMPARE_TIMEOUT_MS=30000 \
SUPASCHEMA_COMPARE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
  npm run bench:compare
```

The harness refuses non-local database hosts by default because it creates and drops temporary databases. Set `SUPASCHEMA_COMPARE_ALLOW_REMOTE=1` only for disposable remote benchmark clusters. Use `SUPASCHEMA_COMPARE_PORT_BASE` to move the per-run Supabase temp project ports away from local conflicts.

Real-project fixtures: `node benchmarks/tools/build-project-fixture.mjs --tree <schemas dir> --out <fixture dir>` turns an actual declarative tree into a fixture (fixpoint statement ordering, Supabase auth stubs, support-surface filtering with a `dropped.log`, and a `fixture.json` carrying the schema list + supaschema adapter). Point the harness at it with `SUPASCHEMA_COMPARE_FIXTURE_DIRS=<fixture dir>` so private schemas never enter the package tree.

When the compare admin URL is `supabase_admin` (required to install most extensions on a local Supabase stack), also set `SUPASCHEMA_COMPARE_SEED_ROLE=postgres`: after seeding, the harness transfers ownership of every user-schema object to that role. This works around two Supabase CLI behaviors found while benchmarking real schemas (CLI 2.105, verified by direct bisection 2026-06-11):

1. **Silent empty diffs for supabase_admin-owned objects.** `supabase db diff --from <db1> --to <db2>` returns an empty diff with exit 0 — no warning — when the differing objects are owned by `supabase_admin`, regardless of the connecting user. The same databases diff correctly after `ALTER ... OWNER TO postgres`. A diff tool reporting "no changes" against databases that differ by a whole table is the failure mode supaschema's `SUPA_PLAN_EMPTY_WITH_DRIFT` invariant exists to make impossible.
2. **`&sslmode=` URL corruption.** The CLI appends `&sslmode=...` to a bare `--to` URL with no query string, corrupting the database name (`FATAL: database "...&sslmode=" does not exist`) — visible only under `--debug`. Work around it by always passing URLs with an existing query string (e.g. `?sslmode=disable`).

The default is 10 measured iterations plus 1 warmup per adapter/fixture pair. A full default run across all adapters and fixtures takes tens of minutes because Supabase engines and realistic-fixture seeding dominate; use the filters above for quick local passes.

Fixtures: the on-disk pairs under `benchmarks/fixtures/` (`additive`, `functions-policies`) plus a generated `realistic` fixture — a deterministic 50-table Supabase-shaped schema (FKs, RLS policies, triggers, views, materialized views, functions, grants, comments) with a mixed change set, materialized at run time from the shared `dist/benchmark-fixtures.js` generator. Set `SUPASCHEMA_COMPARE_XL_TABLES` (for example `1000` for ~7000 objects) to add an `xl` fixture at that table count; it is opt-in because shadow-database engines take minutes per run at that scale — raise `SUPASCHEMA_COMPARE_TIMEOUT_MS` accordingly.

Adapters:

- `supaschema-file` — `diff` between two SQL dumps (diff only)
- `supaschema-db` — `diff` between two live catalogs (diff only)
- `supabase-default` / `supabase-migra` / `supabase-pg-delta` / `supabase-pg-schema` / `supabase-pgadmin` — `supabase db diff` per engine (diff only)
- `supaschema-workflow` — the full real-world step measured as one command: `diff` writes the migration and refreshes seeded `database.types.ts` + `database.zod.ts` (TypeScript types **and** runtime Zod validators) in the same invocation
- `supabase-*-workflow` — the same real-world step for each Supabase engine: `db diff`, apply the generated migration to the database (types cannot regenerate from unapplied SQL), then `supabase gen types --lang=typescript --db-url` (TypeScript only; no validators)

Both workflow lanes are spawned through the same `tools/run-workflow.mjs` wrapper, so per-process overhead is identical on both sides. Workflow rows are charted separately (`workflow-latency.svg`) and excluded from the diff-only charts; never average the two lanes together. The captured output of a workflow run is still the generated migration, so verification and accuracy scoring apply to workflow rows unchanged.

## Reading Results

Use latency charts for speed and correctness charts for whether generated output:

- applied once,
- applied twice,
- matched the target catalog fingerprint after the first and second apply.

`matchesTargetAfterFirstApply` and `matchesTargetAfterSecondApply` are recorded separately in the JSON. `matchesTargetFingerprint` is true only when first apply matches, second apply succeeds, and second apply still matches. Command failures, skips, and unsupported adapters remain visible in the correctness chart.

Timing fields: `elapsedMs` is the final command attempt only and is what the latency chart plots; `totalElapsedMs` additionally includes retry sleeps and failed environmental attempts (for example Supabase shadow-port conflicts), with `attempts` recording how many runs happened.

Accuracy fields (generated fixtures only, which carry a ground-truth change manifest): `outputRecall`, `outputPrecision`, and `outputF1` score the generated SQL's content against the manifest, with `outputMissedSample`/`outputExcessSample` naming up to 8 missed or spurious object keys. Every emitted statement is classified through the PostgreSQL parser (supaschema guard `DO` blocks are unwrapped and classified too). Precision penalizes operations beyond the manifest and destructive drop+create of data-bearing objects (tables, materialized views, sequences, schemas, types/domains); drop+create of recreateable metadata (policies, triggers, views, indexes, functions) is the standard PostgreSQL change lane and is not penalized. `summary.md` reports the per-tool mean as the Output F1 column.

Verification applies the fixture `from` state per statement, then applies the generated migration in one transaction per apply — mirroring runners like `supabase db push` — so transactional failures are not masked by autocommit.

Do not average all modes together. Source-file diff, live-catalog diff, and replay verification measure different work.

## Measured Results (as of 2026-06-12)

Single sequential reference run, 2026-06-12 (`BENCH_ALL_SEQUENTIAL=1 bash benchmarks/tools/bench-all.sh`), with diff-output accuracy scoring active: Apple Silicon (darwin arm64), Node 24, PostgreSQL 17.6 (Supabase local), Supabase CLI 2.106.0, supaschema 0.1.0 with deparse normalization and type generation in the default diff path. Fixture scale: `additive`/`functions-policies` ≈ 1 table; `realistic` = 50 tables (~350 objects); `xl` = 1,000 tables (~7,000 objects); `xxl` = 2,500 tables (~17,500 objects). 3 iterations per cell, single-iteration at `xxl`. Regenerate with `benchmarks/tools/bench-all.sh` (parallel by default; `BENCH_ALL_SEQUENTIAL=1` for publication-grade latency medians free of cross-fixture CPU contention); per-fixture rows live in `<fixture>-results.json` and the generated `summary.md`. All durations are seconds.

| Fixture | supaschema (file / live-db) | Supabase engines | Replay-safe (applies twice) | Output F1 (supaschema / engines) |
| --- | --- | --- | --- | --- |
| `additive` | 0.19s / 0.21s | 3.6–4.6s | supaschema only | — (no manifest) |
| `functions-policies` | 0.18s / 0.21s | 3.3–3.7s | all tools | — (no manifest) |
| `realistic` | 0.19s / 0.23s | 4.0–4.4s | supaschema only | 1.000 / 0.982 |
| `xl` | 1.38s / 1.25s | 38.5–39.1s | supaschema only | 1.000 / 0.999 |
| `xxl` | 3.2s / 2.8s | 204.5–210.0s | supaschema only | 1.000 / 0.999 |

The full-workflow lanes (same run) measure the real-world step of producing the migration **and** regenerated types:

| Fixture | `supaschema-workflow` (migration + TS types + Zod) | `supabase-*-workflow` (db diff + apply + gen types) |
| --- | --- | --- |
| `additive` | 0.24s | 5.8–8.1s |
| `functions-policies` | 0.23s | 5.7–6.2s |
| `realistic` | 0.26s | 6.4–7.6s |
| `xl` | 2.25s | 44.8–50.4s |
| `xxl` | 5.22s | 212.6–229.7s |

Regression with schema size: supaschema stays near three seconds through 2,500 tables because its cost is parse/plan/catalog-read bound. All five Supabase shadow-database engines cluster near ~3.5–4.5s even at one table and grow with schema replay cost to ~39s at 1,000 tables and ~3.4–3.5 minutes at 2,500 — the gap grows from ~20× to ~70×. Verification outcomes are scale-independent: Supabase engines emit unguarded DDL, so apply-twice fails on every fixture whose diff contains `ADD COLUMN`/`CREATE INDEX` statements (`additive`, `realistic`, `xl`, `xxl`); `functions-policies` passes everywhere because its diff is entirely `CREATE OR REPLACE`. Accuracy outcomes: supaschema scores F1 1.000 in both modes on every manifest-scored fixture; every Supabase engine misses the policy-predicate change (recall loss → 0.982 at 50 tables, 0.999 at 1,000/2,500 where the larger manifest dilutes the same miss).

The internal threshold suite (`npm run benchmark`) enforces these as regression gates in CI on PostgreSQL 15/16/17 — every lane fails the build past its `SUPASCHEMA_*_MS` threshold. Reference warm-max values from the same machine: `realisticTreeDiff` 15ms, `noDriftDiff` 15ms, `largeInMemoryDiff` 74ms (250 tables), `liveCatalogDiff` 39ms, `liveCatalogDiffXl` 426ms, `endToEndMigration` 11ms, `endToEndMigrationLarge` 185ms, `endToEndMigrationXl` 692ms, `shadowRoundTripDiff` 1019ms, `replayVerification` 132ms.
