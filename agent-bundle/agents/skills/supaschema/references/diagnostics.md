# Diagnostics and boundaries

Every `SUPA_*` code names the canonical file, config field, hint, or artifact that must change. Decode any code offline:

```bash
supaschema explain <SUPA_CODE>
```

The tables below cover the codes that block generation most often. They are **not** the full set — the catalog carries well over a hundred entries. `explain` is authoritative for any code; `docs/reference/diagnostics.mdx` is the reader-facing catalog, and `src/diagnostics/catalog.ts` is its source. Scan and type-contract codes (`SUPA_SCAN_*`, `SUPA_TYPE_*`) live in [safety.md](safety.md).

## Planner gates

| Code | Resolution |
| --- | --- |
| `SUPA_PLAN_DESTRUCTIVE_HINT_REQUIRED`, `SUPA_PLAN_COLUMN_ALTER_HINT_REQUIRED`, `SUPA_PLAN_VIEW_REPLACE_INCOMPATIBLE`, `SUPA_PLAN_ROUTINE_RETURN_TYPE_CHANGED` | Review the rendered `-- BLOCKED` section, then add the exact object key to `hints.destructive` and regenerate. Never commit `"*"`. |
| `SUPA_ROUTINE_DEPENDENCY_PROOF_REQUIRED`, `SUPA_PLAN_COLUMN_DEPENDENT_REWRITE_REQUIRED` | Do not guess around routine bodies or column dependents. Rewrite the dependent routine/view/policy/trigger so dependencies are structurally extractable or no longer reference the changed column, split the migration, or use a reviewed explicit migration. |
| `SUPA_PLAN_DATA_TRANSITION_REQUIRED` | A destructive hint is not backfill intent. Add reviewed DML or a `DO` transition to the migration corpus, or use a reviewed explicit migration that `check` and `verify` can validate. |
| Renames | Declare `{ "from": "<key>", "to": "<key>" }` in `hints.renames`. Renames are never inferred. |

## Lineage and baseline gates

| Code | Resolution |
| --- | --- |
| `SUPA_DIFF_LINEAGE_BROKEN` | A pending generated migration exists. Resolve a source-backed post-migration baseline: `git:<ref>`, `dir:<path>`, `dump:<file>`, `catalog:<snapshot>`, or reviewed `empty:`. |
| `SUPA_DIFF_LINEAGE_DUPLICATE` | The transition is already pending. Apply or remove the pending migration instead of regenerating. |
| `SUPA_DIFF_REPLACE_*` | `diff --replace` is only for a generated migration inside `migrationsDir` whose original lineage baseline matches the planned `--from`. If a configured target records the version as applied, create a forward migration instead. |
| `SUPA_MIGRATION_BASELINE_REPLAY_REQUIRED` | Generated lineage is absent, a hand-authored tail follows it, or replay failed. Run `supaschema doctor`, resolve the first replay diagnostic, and use `sources.from: "auto"` or `--from migrations:<migrationsDir>`. Never patch generated types or select an unrelated Git/empty fallback. |
| `SUPA_MIGRATION_BASELINE_MISMATCH`, `SUPA_MIGRATION_BASELINE_UNSUPPORTED` | Generated migration lineage does not match the chosen snapshot, or a `migrations:` baseline points somewhere other than `migrationsDir`. |
| `SUPA_SOURCE_MIGRATIONS_TARGET_UNSUPPORTED` | `migrations:` is a before-state only; it is never a generation target. |
| `SUPA_MIGRATION_BASELINE_FORMAT_DRIFT` | Review the generated SQL normally. Previous lineage came from an older model format, so fingerprints are not directly comparable. Do not add hints, bypass the chain gate, or edit generated migrations to silence it — the next generated migration writes versioned lineage and restores comparable proof. |
| `SUPA_MIGRATIONS_STALE_BASELINE` | See [maintain.md](maintain.md); prune through `supaschema migrations --prune-stale` with a resolved target. |

## Closure and cleanliness gates

| Code | Resolution |
| --- | --- |
| `SUPA_DIFF_EMPTY_PLAN` | A named or file-output diff produced no operations. |
| `SUPA_DIFF_GENERATED_CONTRACT_DIRTY`, `SUPA_DIFF_MIGRATIONS_DIRTY` | Generated contracts or migration files carry unstaged changes beyond a proven `git:INDEX` closure, or are dirty against another Git baseline. Under a `migrations:` replay baseline only lineage-bearing (generated) dirty files block; a hand-authored tail is legitimate replay input for an unscoped diff. Repair or close the dirty migration unit before diffing again. |
| `SUPA_DIFF_CONFIG_DIRTY`, `SUPA_DIFF_SCOPED_DIRTY_SCHEMA` | A scoped `--schema` diff cannot own dirty global config or dirty schema files outside the requested filter. Close the owning unit, or use an unscoped diff that owns the change. |
| `SUPA_SELFCHECK_*` | A live catalog's re-extracted rendered SQL diverges in object identity. Fix the model/render owner. |
| `SUPA_BUILD_STALE_DIST` | The CLI ran from a checkout whose `dist` is older than `src`. Run `npm run build` and re-run; never treat stale-dist behavior as a source regression. |
| `SUPA_TYPES_CONTRACT_DRIFT` | `types --check` found generated contracts missing or stale. Run `supaschema types`, review the generated diff, and commit it with the owning schema change; never hand-edit the contract to silence drift. |
| `SUPA_GENERATED_ARTIFACT_EDIT` | Change declarative SQL or generator config, run `supaschema doctor`, then regenerate with `supaschema sync` or, only when schema state already matches, `supaschema types`. Review the generated diff and preserve unexplained drift. |
| `SUPA_GENERATED_ARTIFACT_GUARD_FAILED` | The hook could not prove the write safe because its payload or config could not be classified. The write remains denied. Run `supaschema config validate`, repair the first error, run `supaschema doctor`, and retry the original operation. Never bypass or unregister the hook. |

## Source boundaries

Valid sources for either side of a diff:

`dir:<tree>` · `git:<ref>` · `database:<url|$ENV>` · `dump:<file.sql>` · `catalog:<snapshot.json>` · `empty:`

`migrations:<migrationsDir>` is allowed on the **before** side only.

## Modeling contract

- **SQL semantics are an AST/model problem.** Classify, compare, and mutate DDL through PostgreSQL parse trees (`libpg-query`) and the structured model helpers. Regex is acceptable for outer transport concerns — file markers, hook payload headers, redaction — but never for deciding whether SQL is safe, equivalent, destructive, or replayable.
- **Routine dependency proof is model-owned.** SQL-standard bodies, SQL string bodies, and static PL/pgSQL statements feed relation and column dependencies into planning and `check`. Dynamic SQL, partial PL/pgSQL, and unsupported languages fail closed when relation or type changes appear in the same plan, unless the routine is rewritten or the change moves to a reviewed explicit migration.
- **Support claims are executable contracts.** If a docs page, skill, rule, or agent says an object or statement is supported, it must be wired through `src/sql/support.ts`, extraction, catalog extraction where live databases apply, planning, rendering, checking, audit reporting, and focused tests. Unsupported boundaries must be listed in `unsupportedStatementSupport` so parser-backed diagnostics can name them.
- **Deparser normalization is fidelity-gated.** Known third-party `pgsql-deparser` gaps live in `src/sql/support.ts`. Fix new `SUPA_CHECK_DEPARSE_*` or `SUPA_NORMALIZE_*` findings by improving the model/render/deparser contract or documenting a real unsupported boundary — never by editing generated migrations.
- **Unsupported or ambiguous DDL fails closed.** Statements the model cannot prove safe are never silently passed through.

## Is this object supported?

`docs/reference/support-matrix.mdx` is the authoritative per-object answer — extraction, rendering, and destructive-gate behavior for schemas, extensions, enums, domains, tables, foreign data wrappers, servers and tables, constraints, indexes, sequences, routines, views, materialized views, triggers, RLS, policies, grants and default privileges, comments, and side-effect statements. `supaschema audit --from <source>` reports coverage against it and exits 2 when statements fall outside the contract. The executable contract is `src/sql/support.ts`.

Check the matrix before concluding that a case cannot be modeled. For source-kind and introspection boundaries in supaschema's own implementation, read `docs/concepts/sources.mdx` first, then the owner briefs in `src/AGENTS.md`, `src/source/AGENTS.md`, and `src/typegen/AGENTS.md`.

## Programmatic use

Every CLI capability is also a typed ESM export — `extractSourceModel`, `extractCatalogModel`, `planSchemaDiff`, `renderMigrationSplit`, `checkMigrationSql`, `verifyMigration`, `migrationsStatus`, `compareMigrationHistory`, `runTypeSafetyGate`, `runRlsSafetyGate`, `syncMigrations`, and the migration runners. Use the library when writing a script, test, or tool instead of shelling out. Full surface: `docs/reference/library-api.mdx`.

## Data statements are in scope

`INSERT`/`UPDATE`/`DELETE`/`DO`, row backfills, enum rewrite recipes, Vault references, and workload-derived index intent sit outside the declarative schema _shape_ but inside supaschema's source-intent contract. The planner must mine explicit intent from configured existing migrations or other reviewed project artifacts before blocking. When the runtime lane cannot yet model a case, validate the explicit migration with `check` and `verify`, decode blocking codes with `explain`, and update the canonical source rather than editing a generated migration.
