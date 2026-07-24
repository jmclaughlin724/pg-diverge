# Benchmark Reference Results

This file archives dated benchmark reports outside automatic `AGENTS.md` context.

## Historical Supabase CLI Workarounds

The benchmark harness uses `SUPASCHEMA_COMPARE_SEED_ROLE=postgres` with `supabase_admin` compare URLs because CLI 2.105 behaved differently for `supabase_admin`-owned user objects in a 2026-06-11 bisection:

1. `supabase db diff --from <db1> --to <db2>` returned an empty diff with exit 0 when differing user objects were owned by `supabase_admin`; the same databases diffed correctly after ownership transfer to `postgres`.
2. The CLI appended `&sslmode=...` to bare `--to` URLs without an existing query string, which corrupted the database name under debug output. Benchmark URLs should include an existing query string such as `?sslmode=disable`.

## Current Reference Results (as of 2026-07-21)

Single sequential advisory run on a MacBook Pro (Mac16,6) with an Apple M4 Max (14 cores) and 36 GB RAM: macOS 26.5.1 (25F80), darwin arm64, Node 24.18.0, PostgreSQL server 17.6 in a disposable local Supabase stack, Supabase CLI 2.109.1, and supaschema 0.4.3. Fixture scale: `additive`/`functions-policies` approximately 1 table; `realistic` = 50 tables (~350 objects); `xl` = 1,000 tables (~7,000 objects); `xxl` = 2,500 tables (~17,500 objects). Every adapter received 1 warmup; there were 3 measured iterations per cell except 1 at `xxl`. The run started at 2026-07-21T20:28:51Z and completed at 2026-07-21T22:49:45Z. All durations are median seconds.

| Fixture | supaschema (file / live-db) | Supabase diff engines | Replay-safe after second apply (supaschema file/live / Supabase workflows) | Output F1 (supaschema file/live / Supabase workflows) |
| --- | --- | --- | --- | --- |
| `additive` | 0.34s / 0.37s | 0.98-1.07s | 3/3 + 3/3 / 0/3 | 1.000 + 1.000 / 1.000 |
| `functions-policies` | 0.35s / 0.37s | 1.02-1.07s | 3/3 + 3/3 / 3/3 | 1.000 + 1.000 / 0.800 |
| `realistic` | 0.40s / 0.45s | 1.64-2.65s | 3/3 + 3/3 / 0/3 | 1.000 + 1.000 / 0.982 |
| `xl` | 2.53s / 2.08s | 38.7-57.7s | 3/3 + 3/3 / 0/3 | 1.000 + 1.000 / 0.999 |
| `xxl` | 5.80s / 4.71s | 268-352s | 1/1 + 1/1 / 0/1 | 1.000 + 1.000 / 0.999 |

The full-workflow lanes from the same run measure the real-world step of producing the migration and regenerated types:

| Fixture | `supaschema-workflow` (sync migration + TS types + Zod) | `supabase-*-workflow` (db diff + apply + gen types) |
| --- | --- | --- |
| `additive` | 0.39s | 2.20-2.46s |
| `functions-policies` | 0.39s | 2.29-2.90s |
| `realistic` | 0.80s | 2.96-3.32s |
| `xl` | 7.34s | 43.0-57.6s |
| `xxl` | 18.5s | 228-372s |

Regression with schema size: supaschema source-file/live-catalog medians grow from `0.34-0.37s` on the smallest fixtures to `4.71-5.80s` at 2,500 tables. The five Supabase diff engines grow from `0.98-1.07s` to `268-352s`; the full workflows finish at `18.5s` and `228-372s`, respectively. Successful Supabase direct and workflow migrations fail the second apply on `additive`, `realistic`, `xl`, and `xxl`; the replace-only `functions-policies` fixture passes twice. supaschema file, live, and workflow output scores F1 `1.000` throughout. Successful Supabase output scores `0.800-1.000`; on `realistic`, `xl`, and `xxl`, every engine misses the same policy-predicate change.

The complete measured set is retained. Four Supabase rows exited nonzero without timing out: `supabase-pg-delta` on additive iteration 1, `supabase-pg-delta-workflow` on additive iteration 0, `supabase-migra` on functions/policies iteration 1, and `supabase-pg-schema` on XL iteration 0. There were no supaschema failures, timeouts, skips, or unsupported rows, and XXL completed without a failed row.

Reproduce the publication set with a disposable local database, then regenerate all tracked charts:

```bash
export SUPASCHEMA_COMPARE_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable'
SUPABASE_TELEMETRY_DISABLED=1 BENCH_ALL_SEQUENTIAL=1 bash benchmarks/tools/bench-all.sh
npm run bench:plot:docs
```

The ignored comparison JSONs and generated `summary.md` are the source evidence for these tables. Publication results are advisory and environment-sensitive. `npm run benchmark` is a separate internal threshold suite, not the publication run or a CI gate.
