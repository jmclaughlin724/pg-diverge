# Sample Supabase Consumer Project

A faithful, minimal Supabase + supaschema consumer project used as a test fixture. It mirrors the layout a real consumer gets after `npm install supaschema` in a Supabase project, plus a monorepo `packages/db` types destination. It is **never shipped**: it lives under `tests/fixtures/` (not in `package.json` `files`), so it cannot bloat the published tarball.

`supabase/schemas-next` is not a consumer convention. It is a test-only target snapshot that lets tests compare a before tree to an edited after tree without mutating fixture files or requiring a database.

It backs two maintainer test goals:

1. **Schema-edit accuracy** (`tests/examples/supabase-migration.test.ts`) — comparing the baseline tree (`supabase/schemas`) to the configured target (`supabase/schemas-next`) renders an accurate, replay-safe migration and generated contracts. The DB-gated case proves apply-twice convergence under `per-migration` mode.
2. **Package-contents budget** (`tests/package/contents.test.ts`) — the shipped `examples/` surface stays allowlisted and small, so this full sample cannot silently leak into a shipped directory.

## What supaschema owns vs. what is adjacent

| Path | Role | Notes |
| --- | --- | --- |
| `supabase/schemas` | owned | Declarative desired-state tree (`schemaPaths[0]`), one file per entity. |
| `supabase/schemas-next` | owned | Test-only edited target snapshot. Real projects edit `supabase/schemas` directly. |
| `supabase/migrations` | owned | Generated-migration destination — timestamped `<timestamp>_<name>.sql` files. |
| `packages/db/src/types` | owned | `typesFile` / `zodFile` destination in a monorepo layout. |
| `supabase/config.toml` | adjacent | supaschema reads only the `[db]` port for URL discovery. |
| `supabase/seeds/seed.sql` | adjacent | DML seed data; supaschema never reads, diffs, or generates it. |
| `supabase/functions` | adjacent | Deno edge function; outside diff/check/verify/types, and excluded from the Biome surface (foreign runtime) via `biome.jsonc`. |

`supaschema.config.json` wires the owned surfaces. `managedSchemas` stays at the default Supabase list (setting it to `[]` would disable the managed-schema guard); the tree declares only its own `app` schema.

For this fixture only, `sources.from` is `dir:supabase/schemas` and `schemaPaths` is `supabase/schemas-next`. That lets maintainer tests run the same zero-source-flag workflow against a known edit. A consumer project normally edits its configured `schemaPaths` tree directly.

## Schema file organization

The declarative trees use **one file per entity** with `NN_` numeric prefixes, matching how real Supabase projects organize `supabase/schemas` rather than a single catch-all file. Supabase runs schema files in lexicographic order (dependency parents must come first), so the prefixes order schema → type → table → view → policy. The gaps in `supabase/schemas` (`10`, `30`, `50`) versus `supabase/schemas-next` (`10`–`50`) show exactly what the edit adds: the enum (`20`) and the view (`40`).

supaschema itself reads `schemaPaths` recursively and orders the generated migration by dependency through its planner, so the rendered migration is identical regardless of how the tree is split — but the fixture is organized this way to model real practice. Generated migrations are timestamped `<timestamp>_<name>.sql` files; the tests render to a throwaway directory rather than committing a generated `-- supaschema: lineage` artifact.
