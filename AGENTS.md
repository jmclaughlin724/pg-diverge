# supaschema Repository Operating Contract

## Contract

This file is the root operator brief for AI agents working in this repository and for the agent guidance bundled with the `supaschema` package. Apply it to all files in this repo unless a closer `AGENTS.md` overrides it.

supaschema is a Node 22.12+ TypeScript CLI and library that generates deterministic, replay-safe PostgreSQL/Supabase migrations from declarative SQL tree diffs. The default workflow is generator, checker, and verifier only: it does not stage, commit, or apply migrations. The explicit `supaschema sync --local|--remote` lane is an operator-invoked handoff to the Supabase CLI after status and replay-safety gates; do not use apply flags without an explicit human request.

Durable migration policy lives in `.claude/rules/supaschema.md`. The repeatable migration workflow lives in `.claude/skills/supaschema/SKILL.md` and its `.agents/skills/supaschema/SKILL.md` mirror. Write-time enforcement lives in `.claude/hooks/**`, `.claude/settings.json`, `.codex/hooks/**`, and `.codex/hooks.json`.

## Source Ownership

- Repo facts come from live files and command output. Public product behavior must match `src/**`, `README.md`, and `docs/**`; do not rely on memory for command flags, defaults, diagnostics, or package contents.
- Source code lives in `src/**`. Build output in `dist/**` is generated from `src/**`; change the source and run the build instead of hand-editing `dist/**`.
- CLI behavior is owned by `src/cli.ts`, `src/cli-diff.ts`, `src/cli-reports.ts`, `src/cli-tools.ts`, and the helpers they call. Library exports are owned by `src/index.ts`.
- Config semantics are owned by `src/config.ts` and the generated `config-schema.json`. Keep docs, examples, and JSON Schema aligned when config changes.
- Tests live in `tests/**`; fixtures under `tests/fixtures/**` and `corpus/**` are behavioral evidence. Update snapshots only when the rendered SQL change is intentional and explained by source changes.
- The package manager is npm. Preserve `package-lock.json`; do not introduce pnpm, yarn, or alternate lockfiles.

## Migration Policy

- Schema intent changes in a consuming project belong in the declarative SQL tree, usually `supabase/schemas/**`. Generated migrations come from `supaschema diff`.
- Any `.sql` file containing `-- supaschema: lineage` is a generated artifact. Never edit it by hand; change the source tree and regenerate.
- The bundled PostToolUse hooks auto-run `supaschema diff` then `supaschema check` after writes to schema-tree `.sql` files. Treat the returned migration name or `SUPA_*` diagnostic as the authoritative diff result. The hooks generate and prove; they never apply to a database.
- Destructive intent must be explicit. Drops, column type changes, incompatible replacements, and other blocked operations require exact object keys in `hints.destructive` after reviewing the rendered SQL. Never commit `"*"`.
- Preserve the lineage chain gate. For `SUPA_DIFF_LINEAGE_BROKEN`, diff from the post-migration state such as `--from database:<applied db>`. Use `--no-check-chain` only after explicit human approval.
- Keep `transactionMode: "per-migration"` for transactional runners such as `supabase db push`. `CREATE INDEX CONCURRENTLY` is blocked under `adapter: "supabase-auto"` and belongs in the split concurrent lane only under `adapter: "postgres"`.
- `supaschema sync` is a gated operational command, not the default generation workflow. With no apply flag it is a dry run; with `--local` or `--remote` it runs status reconciliation and `check`, then delegates the actual apply/deploy to the Supabase CLI.
- Database URLs resolve by flag (`$ENV` supported), then named `config.environments` via `--env`, then `SUPASCHEMA_DATABASE_URL`, then nearest `supabase/config.toml`. Never hard-code credentials or connection strings.
- Decode blocking diagnostics with `supaschema explain <SUPA_CODE>`; recovery procedures live in `docs/configuration/hints.md`.

## Agent Bundle Surfaces

- Keep `AGENTS.md` concise and stable. Put reusable workflow detail in `.claude/skills/supaschema/SKILL.md`; put durable policy in `.claude/rules/supaschema.md`; put deterministic write-time checks in hooks.
- `CLAUDE.md` is a compatibility stub and should remain `@AGENTS.md` unless Claude-specific instructions are intentionally added.
- The Claude skill and `.agents` skill mirror must stay identical. If the migration workflow changes, update both surfaces or run the owning sync path if one exists.
- The Claude rule and Codex rule are platform-specific surfaces for the same migration policy. Keep `.claude/rules/supaschema.md` and `.codex/rules/supaschema.rules` semantically aligned.
- Claude hooks and Codex hooks are separate native implementations. When changing generated-migration protection or auto-diff behavior, update and verify both runtimes.
- `package.json` includes the agent bundle in published files. When adding, moving, or deleting an agent surface, verify the packaged tarball still contains the intended files.

## Implementation Discipline

- SQL understanding must come from PostgreSQL parse trees through `libpg-query` and structured model helpers. Do not classify, diff, or mutate SQL with ad hoc regex when an AST/model path exists.
- Unsupported or ambiguous DDL fails closed with a diagnostic. Do not silently pass through statements that the model cannot prove safe.
- Generated migrations must be idempotent and replay-safe. Guard creates, avoid `CASCADE`, and preserve lock-safety checks.
- RLS policy bodies are security boundaries. Compare policy definitions structurally, not by name alone.
- Type generation comes from the declarative tree and source model, not from live database introspection.
- Diagnostics must be actionable and must redact secrets, including URL passwords, JWTs, and tokens.
- Keep behavior available as both CLI and typed library API when the capability is reusable.

## Common Commands

Supaschema CLI workflow:

```bash
supaschema diff                          # render applied state -> schema tree into a migration
supaschema check                         # replay-safety gate for configured migrations
supaschema verify                        # apply-twice proof for the newest pending migration
supaschema types                         # TypeScript + Zod output from the declarative tree
supaschema diff --fail-on-diff --quiet   # CI drift gate, exit 3 on drift
supaschema diff --summary                # blocked-plan triage by operation, diagnostic, kind, and schema
supaschema diff --write-hints <file>     # no-clobber destructive-hint skeleton for review
supaschema audit --from <source>         # support coverage and out-of-contract diagnostics
supaschema selfcheck                     # live catalog cross-lane identity proof
supaschema migrations                    # applied, pending, ghost, and out-of-order status
supaschema sync                          # dry-run apply gate; --local/--remote need explicit approval
supaschema corpus                        # dirty-real corpus oracle when a database is reachable
```

Repository development:

```bash
npm run check           # lint + typecheck + tests + build
npm run lint            # biome check
npm run typecheck       # TypeScript no-emit check
npm test                # vitest suite
npm run build           # dist + config-schema.json
npm run check:package   # publint + arethetypeswrong package checks
npm run fixture:verify  # render a fixture migration, apply twice, compare catalogs
npm run corpus:check    # dirty-real corpus reconvergence oracle
npm run benchmark       # benchmark and threshold lane
npm run docs:check      # Mintlify validation, links, accessibility
```

## Verification

- Run the narrowest command that proves the touched behavior, then broaden when changing shared planner, parser, renderer, hook, or package surfaces.
- For core SQL extraction, planning, rendering, checking, verifying, typegen, or CLI defaults, run targeted tests plus `npm run typecheck`.
- For package, release, or bundled agent-surface changes, run `npm run check:package` or `npm pack --dry-run` as appropriate.
- For docs-only changes, run `npm run docs:check` when Mintlify pages or navigation are touched.
- Before merge or release, `npm run check`, `npm run check:package`, `npm run fixture:verify`, `npm run corpus:check`, and the relevant benchmark/docs checks should be clean.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **supaschema** (3465 symbols, 6323 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/supaschema/context` | Codebase overview, check index freshness |
| `gitnexus://repo/supaschema/clusters` | All functional areas |
| `gitnexus://repo/supaschema/processes` | All execution flows |
| `gitnexus://repo/supaschema/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
