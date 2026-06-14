---
title: "Corpus oracle"
description: "Dirty-real catalog regression testing for cross-lane schema diff correctness."
---

# The corpus oracle

`supaschema corpus` exists because of the oracle problem: every other gate in this package compares supaschema to itself. `verify` builds both temporary databases from the engine's own models, so a modeling error that is symmetric in the models produces two identically-wrong databases — fingerprints match and the bug ships. Fixtures only contain constructs their author thought of, while real catalogs carry state no tree ever declares: materialized default ACL entries, `pg_init_privs` baselines, executor-role-attributed default privileges, statement-order grant churn.

The corpus is an independently-evolved, deliberately dirty database. The lane:

1. Create a disposable database and apply `roles.sql` (the minimal platform role contract — applied by the runner over the wire, never by Docker volume mounts, so it works identically in CI service containers and local runs).
2. Replay `migrations/*.sql` in version order, one transaction per file (mirroring `supabase db push`). These migrations deliberately deposit catalog noise: explicit grants that materialize `proacl` default entries, no-op revokes that leave no trace, default-ACL rows, RLS facet pairs, serial decomposition with hostile quoting, grant-then-revoke churn.
3. Cross-lane diff the dirty database against `tree/` (the same end state in clean declarative spelling, plus intended pending work) and render the reconciliation under `corpus.json`.
4. Static-check the rendered migration, then apply it twice — the second apply must leave the catalog fingerprint unchanged.
5. Re-diff the database against the tree: the residual must be zero operations (`SUPA_CORPUS_RECONVERGENCE` otherwise). A correct diff engine must converge; false drift cannot.

## Running it

```sh
npm run corpus:check
# or
supaschema corpus --corpus-dir corpus/supabase-style [--database-url <url>] [--json]
```

The database URL resolves like every other command (flag, then `SUPASCHEMA_DATABASE_URL`, then the nearest `supabase/config.toml`). Without a resolvable URL the command prints a skip notice and exits 0, so OS-matrix CI jobs without a database pass through. Non-local hosts are refused unless `SUPASCHEMA_CORPUS_ALLOW_REMOTE=1`.

## Regression-corpus discipline

Every future false-drift or parity bug adds its statement class to the corpus in the same change that fixes it: the triggering DDL goes into `corpus/supabase-style/migrations/`, the clean declarative spelling goes into `tree/`, and `npm run corpus:check` must converge. The corpus is the living inventory of every noise class the engine has ever mishandled.

## Bring your own corpus

`--corpus-dir` accepts any directory with the same four pieces (`roles.sql`, `migrations/`, `tree/`, `corpus.json`), so a consuming repository can maintain its **own** corpus pinning the noise classes from its own incidents: when a diff misbehaves on your schema, copy the triggering DDL into your corpus migrations, express the same end state in your corpus tree, and wire `supaschema corpus --corpus-dir <your-corpus>` into your CI. The shipped `corpus/supabase-style` keeps protecting the engine; yours keeps protecting your schema's specific shapes.

## Scope

The corpus lane proves engine correctness against dirty-real state. It does not replace the repo-side drift gate: continuous assurance for an actual repository is `supaschema diff --fail-on-diff` plus `supaschema migrations` against the live database, which detect when that repo's tree and databases diverge. Corpus = is the engine right; drift gate = is the repo in sync.
