@AGENTS.md

<!-- supaschema:agent-guidance:start -->

## supaschema

This project uses supaschema for declarative PostgreSQL migrations. The configured paths below are authoritative; install can seed provider-specific folders for Supabase, Neon, RDS/Aurora PostgreSQL, Cloud SQL, AlloyDB, Azure PostgreSQL, or a neutral PostgreSQL layout.

- Schema intent belongs in `examples/postgres/schemas`.
- Generated migrations write to `database/migrations`; files containing `-- supaschema: lineage` must not be hand-edited.
- The agent install prompt lives at `.agents/prompts/supaschema-install.md`; read it before installing, initializing, inspecting, or explaining supaschema setup in this project.
- Generated type outputs use `database.types.ts` and `database.zod.ts` unless `typesFile` or `zodFile` is changed in config; default workflow creates or refreshes both after `diff`, and `workflow.type_usage: "zod_validated"` tells agents to use generated Zod validators at runtime boundaries.
- Edit `supaschema.config.json` to change `adapter`, `workflow`, `schemaPaths`, `sources`, `migrationsDir`, `typesFile`, `zodFile`, `managedSchemas`, `transactionMode`, or named `environments`; use `$ENV_NAME` database URL references instead of committing credentials.
- For schema changes, read `.agents/skills/supaschema/SKILL.md` and the matching Claude/Codex rule file, edit declarative SQL, run `npx supaschema diff`, then run `npx supaschema check`.
- Hooks in `.claude/settings.json` and `.codex/hooks.json` enforce generated-migration protection and auto-run diff/check after schema SQL writes; they never apply migrations.
- Do not run `npx supaschema sync --local` or `npx supaschema sync --remote` unless explicitly asked to apply migrations; `workflow.migration_sync: "disabled"` blocks those apply handoff flags.
<!-- supaschema:agent-guidance:end -->
