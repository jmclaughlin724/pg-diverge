# Migrate — create or adopt a schema change

Goal: produce **one reviewable schema-change closure** from the configured sources.

## Adopt or initialize

```bash
supaschema onboard                          # credential-free readiness report
supaschema onboard --from dir:database/schemas
supaschema init                             # only from the package that owns the workflow
supaschema config validate --json
```

`onboard` identifies the incumbent migration system and the ordered readiness work. If `init` leaves `.supaschema/install.json`, resolve its candidate paths before generating anything.

## Inspect before editing

```bash
supaschema migrations --json
```

This reads the configured migration directory even with no database target available. Resolve ghost, out-of-order, stale-baseline, or broken-lineage findings **before** generating another migration.

Then read the corpus itself. Existing migrations carry operational facts the schema tree cannot express by shape alone: row backfills, explicit DML and `DO` workflows, enum rewrite recipes, Vault references or placeholder names, workload-proven index intent, reviewed routine drops, and provider bootstrap constraints. Preserve that intent through the planner and the replay-safety lane. Never invent missing row values, secret material, tenant predicates, or conversion expressions — when the corpus lacks the fact, follow the diagnostic that names the canonical file, config, hint, or workload artifact which must declare it.

## Understand the change before rendering SQL

```bash
supaschema plan                    # planned object-level diff as JSON
supaschema plan --schema public    # comma-separated schema filter
supaschema inspect                 # deterministic schema model as JSON
supaschema fingerprint --from <source>
```

`plan` is the structured form of `diff`: same from/to defaults, object-level operations instead of rendered SQL. Prefer it when reasoning about _what_ changes; use `diff` when you need the migration file. `inspect` prints the model itself, and `fingerprint` prints one hash — two sources with equal fingerprints have identical schemas, which is the cheapest possible equality proof.

## Generate

```bash
supaschema diff
```

Zero-source-flag defaults use `sources.from` and `dir:<schemaPaths[0]>`, printed to stderr. For generation, `sources.from: "auto"` resolves a staged migration/schema closure to `git:INDEX` when its lineage fingerprint matches the index, then valid `git:HEAD`, then `empty:` only for a first migration with no existing corpus.

The file lands in `migrationsDir` as `<UTC timestamp>_<derived name>.sql`. Pass `--name <snake_case>` only when the human wants a specific file name. The write is no-clobber and chain-gated; named or file-output empty plans fail with `SUPA_DIFF_EMPTY_PLAN`.

Use explicit `--from` / `--to` only when the requested workflow intentionally overrides config.

**Migration-first adoption:** `--from migrations:<migrationsDir>` replays the matching corpus fail-closed. A different directory produces `SUPA_MIGRATION_BASELINE_UNSUPPORTED`; using replay as `--to` produces `SUPA_SOURCE_MIGRATIONS_TARGET_UNSUPPORTED`. Existing migrations with neither baseline produce `SUPA_SOURCE_BASELINE_REQUIRED`.

If `diff` exits 2, decode the code in [diagnostics.md](diagnostics.md) and fix the named canonical source. Do not bypass the gate.

## Check, type, stage

```bash
supaschema check    # must exit 0
supaschema types
supaschema stage
```

`check` gates every `.sql` in the migrations directory (or named files) for statement replay safety, same-file forward references, `SECURITY DEFINER` search paths, and public-schema function `EXECUTE` exposure. Use `--changed`, `--staged`, `--base <ref>`, or `--since <ref>` only when a workflow intentionally wants a git-selected subset; the scaffolded `supaschema:check` script remains the full-directory lane.

`types` refreshes TypeScript and Zod from the configured schema source. Investigate `unknown` when a modeled relation, function, extension, or expression should resolve; preserve upstream's intentional `unknown` fallback for unsupported PostgreSQL scalars.

`stage` git-stages changed migration files carrying the `-- supaschema: lineage` marker and leaves other files untouched.

To gate the contract change rather than just regenerate it, run `supaschema type-contract --enforce` — see [safety.md](safety.md). For a stored-artifact comparison instead of a source-to-source one:

```bash
supaschema contracts export --from <source> --out contract.json
supaschema contracts diff --from contract.json --to <source>
```

## Apply — explicit intent only

`apply` and `sync` mutate a target. They require explicit user intent plus every configured safety and approval gate.

```bash
supaschema apply    # applies already-generated pending migrations, no new diff
supaschema sync     # the composed one-command workflow
```

`sync` composes apply policy, target selection, pre-generation history reconciliation, source resolution, diff generation, refreshed history, replay-safety check, generated contract refresh, schema-closure staging when Git is available, source-model deploy safety gates, runner apply, and final reconciliation or dry-run reporting. It refreshes contracts and runs closure staging even when no migration is pending.

When a selected Supabase CLI target has no resolved database URL, the CLI owns historical pending selection: supaschema replay-checks generated lineage files only and must not treat every disk migration as pending.

## Verify execution

Available whenever a database is resolvable (see the URL precedence in [setup.md](setup.md)):

```bash
supaschema verify
supaschema verify --migration <file>
```

Defaults to the newest pending migration with the same from/to defaults as `diff`. Add `--ensure-roles` when the migration grants to roles a bare PostgreSQL server lacks, such as `authenticated`. Add `--ensure-environment` when a plain PostgreSQL verification server needs Supabase-provisioned surfaces. A fingerprint mismatch itemizes the differing objects in the diagnostic hint.

## Close the unit

Review the schema edit, the generated migration, and the generated contracts together, and report the commands and diagnostics. Commit them as one change before handoff or merge. Because `sync` stages each complete closure, several forward schema edits may be generated and applied without an intermediate commit.

Do not apply a migration, stage, commit, push, or open a pull request without the user's authorization.
