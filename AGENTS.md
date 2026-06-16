# supaschema Operating Contract

## Purpose

This file defines the repository-wide operating contract for AI coding agents. Keep durable repo-wide invariants here and route detailed procedures to `.claude/rules/**`, `.claude/skills/**`, hooks, runtime config, or the nearest owner `AGENTS.md`.

## Rule Map

- Code Atlas routing and repo-wide graph policy: `.claude/rules/10-code-atlas.md`.
- Supaschema migration policy: `.claude/rules/supaschema.md`.

## Operating Rules

- Repo facts come from live files and command output. External-tech facts come from upstream MCP/docs first, official web fallback second, then installed/live proof.
- Use MUST, MUST NOT, SHOULD, DEFAULT TO, VERIFY, FIX BY, and STOP IF consistently.
- Every hard rule must include a verification path.
- Every verification failure must include corrective action.
- Preserve every user instruction as an acceptance criterion. Do not narrow the requested action, stop at a representative subset, or treat current structure as proof of correctness.
- Use AST instead of regex for code analysis and generation whenever possible.
- Do not delete, weaken, bypass, or skip guards without explicit user approval and a documented reason.
- For anything important, use this chain:
    - Rule file says the requirement.
    - Hook blocks obvious local violations.
    - Guard script performs deterministic validation.
    - CI runs the same guard.
    - Skill tells agent how to fix failures.

## Working style

### Use 

- Be direct.
- Make small, verifiable changes.
- Prefer editing existing files over creating new abstractions.
- Do not mark work complete until the relevant checks have run or a blocking reason is stated.
- Core writing style of short, operational, and enforceable sentences. 
- Avoid fluffy, general, aspirational, or unverifiable language. Use the active voice and present tense.

### Do not use

- Motivational language.
- Long rationale.
- Unbounded “best practices.”
- Duplicated rules.
- Conflicting instructions.
- Hidden assumptions.

## Required workflow

### Before editing

1. Read this file and the nearest applicable `AGENTS.md` and `.claude/rules/*.md`.
2. Identify the owning app, package, service, or database area.
3. Verify upstream best practices from the canonical source.
4. Utilize DRY principles for existing owners, patterns, and conventions over introducing new ones.
5. Make the smallest safe change that satisfies the task.

### After editing

1. Update tests, generated files, docs, and guards affected by the change.
2. Run targeted checks. Targeted checks include test suites, type checks, lints, formatting, and generated-file diffs related to the changed area.
3. Run global guards when boundaries, database, auth, tenancy, generated files, CI, hooks, or rules changed.
4. Summarize changed files, commands run, results, and unresolved risks.

## Repo-Wide Change Discipline

Root `AGENTS.md` is the only owner of this repo-wide action sequence. Do not restate it elsewhere.

This sequence applies to every repository change: code, tests, docs, schemas, configs, scripts, prompts, generated surfaces, and verification.

1. Identify the requested end state, the concept being changed, and the canonical owner.
2. Implement the requested end state in the canonical owner. Extend, move, merge, or delete there before adding a new surface.
3. Do not create or preserve duplicate owners, aliases, wrappers, helpers, types, schemas, docs, configs, routes, exports, workflows, or instructions for the same concept.
4. Keep a separate surface only for a genuinely distinct runtime, storage, compliance, lifecycle, or external-contract boundary.
5. Treat automation, guards, and checks as supporting evidence only; they do not replace owner classification or implementation in the canonical owner.

A task is not complete while any user instruction lacks a disposition, the owner is unknown, the requested end state is unmet, avoidable duplication remains in the accepted scope, or verification has not covered the canonical owner.

## Rule priority

When instructions conflict, use this order:

1. User’s explicit current task.
2. Safety, secrets, and data-protection rules.
3. Tenant isolation and RLS rules.
4. Database migration/source-of-truth rules.
5. App/package boundary rules.
6. Framework-specific rules.
7. Style preferences.

Never use a lower-priority rule to bypass a higher-priority rule.

## Worktree And Approval

- You may be in a dirty worktree. Preserve unrelated, pre-existing work that exists in the worktree. Do not stage, commit, stash, reset, clean, or overwrite changes you did not make unless explicitly requested by the user.
- Destructive git operations, force-pushes, publishing/deployments, linked or production external-state mutation, deleting user-owned data, rotating secrets, and spending money require explicit user approval.

## Failure behavior

If verification fails:

1. Treat the failure as blocking.
2. Fix failures caused by the current change.
3. Re-run the failed command.
4. Do not bypass, delete, weaken, or skip the guard.
5. If the failure appears unrelated, document the evidence and continue only if the requested change is still verifiable.

## Stop conditions

Stop before editing if:

- The task requires destructive database migration behavior.
- The correct tenant source is unclear.
- The change requires a new production dependency.
- The implementation would expose service-role access to client code.
- The requested change conflicts with a higher-level rule.

## Done means

- The requested change is implemented.
- The owning tests were added or updated.
- Required guards passed.
- Generated files are current.
- Docs or rules were updated if behavior changed.
- The final response lists commands run and remaining risks.

## Final response format

When finishing code work, report:

1. What changed.
2. Files changed.
3. Commands run.
4. Results.
5. Remaining risks or skipped checks.

Do not claim success for checks that were not run.
Do not say "should work" without verification.

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
