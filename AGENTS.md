# supaschema Operating Contract

## Purpose

This file defines the repository-wide operating contract for AI coding agents. Keep durable repo-wide invariants here and route detailed procedures to the public supaschema rule, hooks, runtime config, or the nearest owner `AGENTS.md`.

## Rule Map

- Supaschema migration policy: `.claude/rules/supaschema.md`.
- Public repository exposure policy: `npm run guard:public-surface`.
- GitHub repository settings, PR, merge, and post-merge process: `.github/repo-policy.json`, `.github/PULL_REQUEST_TEMPLATE.md`, `CONTRIBUTING.md`, and `npm run guard:github-process`.

## Operating Rules

- Repo facts come from live files and command output. External-tech facts come from upstream MCP/docs first, official web fallback second, then installed/live proof.
- Use MUST, MUST NOT, SHOULD, DEFAULT TO, VERIFY, FIX BY, and STOP IF consistently.
- Every hard rule must include a verification path.
- Every verification failure must include corrective action.
- Use active voice and validated facts, not aspirational language or future-tense plans.
- Preserve every user instruction as an acceptance criterion. Do not narrow the requested action, stop at a representative subset, or treat current structure as proof of correctness.
- Use AST instead of regex for code analysis and generation.
- DEFAULT TO `$elegant` for every task and action. MUST NOT create or keep backwards compatibility behavior or paths, export-only compatibility files, shims, aliases, wrappers, DTOs, facades, copied enum tuples, casts that patch missing contracts, local view-models, local compatibility layers, broader helper surfaces, allowlist exceptions, comments in code or scripts, redundant or convenience entry points, placeholders, TODOs, regex, duplicate owners, or unverified automation. Typed UI prop containers are allowed only when DB-backed payloads use direct generated contracts without renaming, projection, mirroring, or local ownership. Use AST only for structural analysis. Treat external-contract conflicts as STOP conditions; solve them in the canonical owner.
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
- Optimize for the smallest correct end state, not the smallest patch.
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
4. Apply the Repo-Wide Change Discipline below for duplicates, redundancies, and entry points before introducing a new surface.
5. Choose the smallest correct end state first, then make every change required to reach it. Do not preserve backwards compatibility behavior or paths, duplicate owners, wrappers, aliases, shims, placeholders, TODOs, or redundant or convenience entry points only to keep the patch small.

### After editing

1. Update tests, generated files, docs, and guards affected by the change.
2. Run targeted checks. Targeted checks include test suites, type checks, lints, formatting, and generated-file diffs related to the changed area.
3. Run global guards when boundaries, database, auth, tenancy, generated files, CI, hooks, or rules changed.
4. Summarize changed files, commands run, results, and unresolved risks.

## Repo-Wide Change Discipline

Root `AGENTS.md` is the only owner of this repo-wide action sequence. Do not restate it elsewhere.

This sequence applies to every repository change: code, tests, docs, schemas, configs, scripts, prompts, generated surfaces, and verification.

1. Define the requested end state, the smallest correct end state, the concept being changed, the canonical owner, and the single entry point agents or users should use.
2. Inspect the accepted scope for existing owners, aliases, wrappers, helpers, types, schemas, docs, configs, routes, exports, workflows, commands, prompts, placeholders, TODOs, instructions, and entry points before adding a new surface.
3. Treat current structure and current consumers as evidence and a worklist, not as proof of the target shape. Burn down avoidable duplication and redundancy in the same change by extending, moving, merging, or deleting in the canonical owner before adding a new surface.
4. Keep a separate surface only for a genuinely distinct runtime, storage, compliance, lifecycle, or external-contract boundary.
5. Use upstream-verified behavior when external technology controls the target shape. Use the elegant end state for every task and action; delete legacy surfaces and rewrite consumers instead of preserving backwards compatibility behavior or paths, compatibility files, shims, aliases, wrappers, placeholders, TODOs, or redundant or convenience entry points.
6. Use narrow verification only to prove the chosen end state. Do not use a narrow check, narrow owner, or narrow implementation step to shrink the requested end state.
7. Treat automation, guards, and checks as supporting evidence only; they do not replace owner classification or implementation in the canonical owner.

A task is not complete while any user instruction lacks a disposition, the owner or single entry point is unknown, the requested end state is unmet, avoidable duplication or multiple entry points remain in the accepted scope, the implementation works only because the same concept was copied across multiple owners or entry points, or verification has not covered the canonical owner.

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

- You may be in a dirty worktree. Preserve unrelated, pre-existing work that exists in the worktree.
- Do not stage, commit, stash, reset, clean, or overwrite changes you did not make unless explicitly requested by the user.
- Concurrent editing in the same worktree is allowed. Do not treat concurrent editing as a blocker, if you spot it, keep building.
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

## "Done" means

- Any requested changes, tasks, or plans are fully implemented.
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

Do not claim success for checks that were not run. Do not say "should work" without verification.

<!-- supaschema:agent-guidance:start -->

## supaschema

This project uses supaschema for declarative PostgreSQL migrations. The configured paths below are authoritative; setup can seed provider-specific folders for Supabase, Neon, RDS/Aurora PostgreSQL, Cloud SQL, AlloyDB, Azure PostgreSQL, or a neutral PostgreSQL layout.

- Schema intent belongs in `examples/postgres/schemas`.
- Generated migrations write to `database/migrations`; files containing `-- supaschema: lineage` must not be hand-edited.
- The agent install prompt lives at `.agents/prompts/supaschema-install.md`; read it before installing, initializing, inspecting, or explaining supaschema setup in this project.
- Treat `supaschema.config.json` as four decisions: schema tree (`schemaPaths`, `sources.to`, `migrationsDir`), diff baseline (`sources.from`, `sources.to`), generated contracts (`typesFile`, `zodFile`, `workflow.type_generation`, `workflow.zod_generation`, `workflow.type_usage`), and apply policy (`workflow.migration_sync`, `sync.targets`).
- `schemaPaths` roots are recursive. The default target source is `dir:examples/postgres/schemas`; keep `sources.to` explicit when the diff target is intentionally different.
- Generated type outputs use `database.types.ts` and `database.zod.ts` unless `typesFile` or `zodFile` is changed in config; default workflow creates or refreshes both after `diff`, and `workflow.type_usage: "zod_validated"` tells agents to use generated Zod validators at runtime boundaries.
- Use `$ENV_NAME` database URL references in `environments` or `sync.targets`; do not commit credentials.
- For schema changes, read `.agents/skills/supaschema/SKILL.md` and the matching Claude/Codex rule file, edit declarative SQL, then run `diff` and `check` through the local runner selected in `.agents/prompts/supaschema-install.md`.
- Consumer installs generate `.claude/settings.json` and merge `.codex/hooks.json` to enforce generated-migration protection and auto-run diff/check after schema SQL writes. When `workflow.migration_sync` allows automatic sync, the schema-write hook preflights every `sync.targets` entry with `mode: "auto"`; if each target resolves and any remote target is approved, it delegates to `supaschema sync`. Otherwise it stays on the non-mutating diff/check lane. Check or sync failures trigger agent-loop feedback to investigate the root source and correlated migration failures.
- Use bare `sync` for the configured workflow. Do not run `sync --target <name>` unless explicitly asked to override target selection. `sync.targets.<name>.mode` decides automatic target selection, `workflow.migration_sync: "manual"` keeps bare sync on the dry-run gate, and `workflow.migration_sync: "disabled"` blocks apply.
<!-- supaschema:agent-guidance:end -->
