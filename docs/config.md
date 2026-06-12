# Configuration Reference

`supaschema` looks for config in this order:

1. `--config <path>` (`.json`, `.mjs`, or `.js` with a default export)
2. `supaschema.config.json` in the working directory
3. `supaschema.config.mjs`, then `supaschema.config.js`
4. Built-in defaults

Unknown keys are rejected (the schema is strict), so typos fail loudly. The scaffolded config carries a `$schema` pointer at the shipped `config-schema.json` (generated from the Zod schema at build time), so editors autocomplete and validate every key.

| Option | Default | Meaning |
| --- | --- | --- |
| `$schema` | scaffolded | JSON Schema pointer for editor tooling; ignored by the loader. |
| `adapter` | `"supabase-auto"` | `supabase-auto` blocks managed Supabase schemas as declarative owners and blocks `CREATE INDEX CONCURRENTLY` plans; `postgres` disables those policies. |
| `cascade` | `"never"` | `CASCADE` is never emitted. This is not configurable away. |
| `destructiveChanges` | `"hint-required"` | `hint-required` blocks destructive operations until the object key is listed in `hints.destructive`; `block` always blocks; `allow` permits everything (not recommended). |
| `environments` | `{}` | Named database targets for the global `--env` flag: `{ "staging": { "databaseUrl": "$STAGING_DB" } }` lets `supaschema --env staging diff ...` resolve the URL (with `$ENV_NAME` indirection) without repeating it per command. |
| `excludedGrantRoles` | `[]` | Grants and default privileges whose grantee or `FOR ROLE` matches are removed from extracted models (useful for platform roles such as `supabase_admin`). |
| `hints.destructive` | `[]` | Exact object keys (or `"*"`) approved for destructive drop/replace. |
| `hints.renames` | `[]` | `{ "from": "<object key>", "to": "<object key>" }` pairs rendered as guarded `ALTER ... RENAME`. |
| `idempotency` | `"required"` | Rendered SQL is replay-safe by construction. Not configurable away. |
| `lockTimeout` | `"5s"` | Value for the `SET lock_timeout` migration preamble. |
| `managedSchemas` | Supabase set | Schemas treated as platform-owned under `supabase-auto`. |
| `migrationsDir` | `"supabase/migrations"` | Where zero-flag `diff` writes migrations, zero-arg `check` reads them, and `verify` finds the newest pending file. The `--migrations-dir` flag overrides per command. |
| `typesFile` | `"database.types.ts"` | Where `supaschema types` writes generated TypeScript types. When the file exists, every `diff` that writes a migration regenerates it from the target tree. |
| `normalize` | `"deparse"` | Every object's SQL is rewritten into canonical form via `pgsql-deparser` (the pure-TypeScript companion of the `libpg-query` parser). Fidelity-gated per object: the canonical text is used only when it reparses to the identical location-stripped parse tree, otherwise the source text is kept with a `SUPA_NORMALIZE_*` warning. Hashes never change (identity is AST-based); rendered output is formatting-independent. Set `"off"` to keep source spelling verbatim. `check` always runs the round-trip proof and reports `SUPA_CHECK_DEPARSE_*` findings regardless of this setting. |
| `postgresVersion` | `"15+"` | Documentation of the supported floor; guards target PostgreSQL 15+ syntax. |
| `renameDetection` | `"hints-only"` | `hints-only` uses `hints.renames`; `off` disables rename handling entirely. |
| `schemaPaths` | `["supabase/schemas"]` | Paths read by `git:` sources and the default `--to dir:` target (the first entry). `supabase/config.toml` is read only to discover the local database URL (`[db] port`), never for schema paths; configure paths here. |
| `schemas.include` / `schemas.exclude` | `[]` | Persistent schema filters applied to every extracted model (the CLI `--schema` flag composes on top). |
| `statementTimeout` | `"60s"` | Value for the `SET statement_timeout` migration preamble. |
| `transactionMode` | `"per-migration"` | How `verify` applies the migration and how transaction hazards are graded. `per-migration` mirrors runners like `supabase db push` (one transaction per file); `per-statement` matches autocommit runners. |
| `verify --ensure-roles` (CLI) | off | Pre-creates missing `NOLOGIN` roles referenced by grants, default privileges, and policies on the verification server. Roles are cluster-level and are never dropped. |
| `validators` | `["internal-parser"]` | Additional external validators to run during `check` (see below). |

## Validators

`internal-parser` is always the correctness owner. Optional external validators run as subprocesses during `check` and `verify`:

- `squawk` / `squawk-cli` — runs the `squawk` binary
- `pgls` / `postgres-language-server` / `@postgres-language-server/cli` — runs `postgres-language-server check`
- `sqlfluff` — runs the external Python `sqlfluff lint --dialect postgres`
- `pg-formatter` / `pgformatter` — runs `pg-formatter --check`

A configured validator that is not installed produces `SUPA_VALIDATOR_UNAVAILABLE` as an error: configured checks may not silently skip.

## Example

```json
{
  "destructiveChanges": "hint-required",
  "excludedGrantRoles": [
    "supabase_admin",
    "supabase_auth_admin",
    "supabase_storage_admin",
    "dashboard_user",
    "pgbouncer",
    "authenticator"
  ],
  "hints": {
    "destructive": ["table:app.legacy_imports"],
    "renames": [{ "from": "table:app.accounts", "to": "table:app.customers" }]
  },
  "lockTimeout": "5s",
  "schemas": { "exclude": [], "include": ["app", "public"] },
  "statementTimeout": "60s",
  "transactionMode": "per-migration",
  "validators": ["internal-parser", "squawk"]
}
```
