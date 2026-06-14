---
title: "Case study"
description: "supaschema measured against a production multi-tenant Supabase platform: ~30 schemas, ~8,300 objects, hundreds of RLS policies."
---

supaschema was built while developing a production multi-tenant SaaS on Supabase: roughly **30 schemas, ~8,300 schema objects, and hundreds of RLS policies** (tenant isolation is enforced in the database, so almost every table carries policies). The pain that motivated the project was concrete: every schema edit meant waiting on the Supabase CLI's shadow-database diff before a migration — and its generated types — could catch up. That wait is a tax on every change, and it grows with the schema.

All numbers below are reproducible. Object names are kept generic; the measurements are from the real tree.

## Speed: the whole tree, no database, in under two seconds

Extracting and planning the entire declarative tree (8,271 modeled objects) runs on the parser alone — no Docker, no shadow database, no introspection:

```
extract-from 1012ms · extract-to 876ms · plan 5ms
```

A full diff is two extractions plus a plan — **~1.9 seconds over the entire production tree.** The equivalent Supabase CLI diff replays all 8,300 objects into a fresh Docker shadow database on every run, which is minutes at this scale (see the [benchmarks](/benchmarks#speed-and-accuracy)).

The 8,271 figure is what supaschema models; the tree also produced 91 expected fail-closed diagnostics, concentrated in the bootstrap layer (managed-schema declarations for `extensions`/`vault`/roles, which a real adoption excludes via `schemas.exclude`) plus normalize-fidelity warnings. None are engine errors.

## Head-to-head on real schema (bounded slice)

A 282-object slice of the real tree (three schemas: identity, calculators, messaging — 73 RLS policies among them) was diffed against itself plus a small additive change, supaschema versus the default Supabase CLI engine, one iteration, both applied to a throwaway Postgres and re-applied:

|  | supaschema | Supabase CLI (default) |
| --- | --- | --- |
| Diff latency | **361 ms** | 35,293 ms (~**98× slower**) |
| Migration applies once → target catalog | yes | yes |
| Migration applies **twice** (crash-safe re-run) | **yes** | **no** |
| Reaches the target catalog after re-run | **yes** | **no** |

The Supabase engine emitted an unguarded `CREATE TABLE public.…(…)` (no `IF NOT EXISTS`) and an unguarded `CREATE INDEX`, so the second apply fails with `relation "…" already exists`. supaschema's output is guarded by construction (`IF NOT EXISTS`, catalog-checked `DO` blocks), so a crashed or retried deploy simply runs the file again.

Reproduce against any declarative tree:

```bash
node benchmarks/tools/build-project-fixture.mjs --tree <your supabase/schemas> --out benchmarks/fixtures/project
SUPASCHEMA_COMPARE_FIXTURES=project \
SUPASCHEMA_COMPARE_TOOLS=supaschema-file,supabase-default \
SUPASCHEMA_COMPARE_ITERATIONS=1 \
SUPASCHEMA_COMPARE_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
node benchmarks/compare.js
```

## Security: the miss that speed hides

Speed is the felt pain; the more dangerous gap is correctness on RLS. On a multi-tenant platform, a policy's `USING` predicate **is** the tenant boundary. Tightening `USING (true)` to `USING (tenant_id = current_tenant())` is a one-line change that closes an isolation hole — and every Supabase CLI diff engine measured here silently drops that policy change (it diffs policies by name, not by body). See the [accuracy results](/benchmarks#accuracy) for the manifest-carrying fixtures, where each engine scores F1 0.982–0.999 on exactly that miss while supaschema scores 1.000, and the missed-policy migration provably fails to reach the target catalog.

A slow diff costs seconds. An unreplayable diff costs a deploy. A silently dropped policy change ships a tenant-isolation hole that review, CI, and the migration runner all wave through — which on this platform's hundreds of policies is the failure mode that actually matters.

## Why both speed and security

The two are the same wedge from different ends. The parser-based, no-database design is what makes supaschema fast; that same AST-based identity is what lets it compare policy bodies structurally instead of by name, which is what catches the isolation regression. You do not trade one for the other.
