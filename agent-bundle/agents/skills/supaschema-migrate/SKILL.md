---
name: supaschema-migrate
description: Create or adopt a Supaschema migration from declarative PostgreSQL intent through onboarding, configuration, generation, replay checks, and generated contracts. Use for new schema changes, existing-project adoption, and migration preparation before review.
---

# Supaschema Migrate

## Contract

Produce one reviewable schema-change closure from the configured sources. Never hand-edit a generated migration, generated TypeScript, or generated Zod output. Read [commands.md](references/commands.md) before running the workflow.

## Workflow

1. Run `supaschema onboard` to identify the incumbent migration system and ordered readiness work. In an unconfigured project, run `supaschema init`, then resolve any `.supaschema/install.json` path handoff before continuing.
2. Read `supaschema.config.json`. Treat `sources.from` as the before-state, `schemaPaths` as the declarative end-state, and `migrationsDir` as both history and operational source intent.
3. Inspect existing migrations before editing. Preserve data transitions, routine rewrites, provider constraints, secret placeholders, and generated-lineage baselines already expressed there.
4. Edit only the configured declarative schema tree. Run `supaschema diff` and resolve any `SUPA_*` diagnostic in its named canonical source instead of bypassing the gate.
5. Run `supaschema check` for replay safety and `supaschema types` for generated TypeScript and Zod contracts.
6. Review the schema edit, generated migration, and generated contracts as one unit. Report the commands and diagnostics. Do not apply a migration unless the user explicitly requests it and the configured target and approval gates are satisfied.
