---
name: elegant
description: "Use when rewriting a code surface to the most efficient correct end state: consolidate neighboring consumers, files, folders, and dependencies; delete legacy shims and duplication; and update impacted call sites without backwards compatibility."
user-invocable: true
argument-hint: <scope to consolidate or simplify>
metadata:
  keywords:
    - elegant
    - rethink
    - redesign
    - clean slate
    - from scratch
    - no backwards compat
    - fresh design
    - greenfield
    - ideal design
    - simplify
    - rewrite
    - consolidate
    - dedupe
    - remove duplication
    - delete shims
    - dead code
    - unused dependency
  intent-patterns:
    - "rethink.*design"
    - "redesign.*without"
    - "start.*fresh"
    - "clean.*slate"
    - "no.*backwards.*compat"
    - "from.*scratch"
    - "ideal.*end.?state"
    - "if.*no.*legacy"
    - "pretend.*no.*existing"
    - "greenfield.*approach"
    - "simplify.*code"
    - "rewrite.*clean"
    - "remove.*duplication"
    - "consolidat.*(?:files|folders|dependencies|owners|consumers)"
---

# Elegant

## Contract

This skill is a direct execution contract. Use it when the requested outcome is the most efficient correct end state, not a compatibility-preserving migration.

The elegant end state is one canonical owner per concept, the smallest public API that satisfies current requirements, no duplicate wrappers, aliases, types, schemas, config, docs, or transitional branches, no orphan files, folders, or dependencies, and all impacted consumers rewritten or deleted in the same change.

Treat current consumers as evidence and a worklist, not as a veto. Work through neighboring consumers, sibling files, containing folders, package exports, declared dependencies, tests, docs, generated surfaces, and owner briefs until avoidable complexity in the touched scope is gone.

Use upstream docs or the owning MCP lane for external technology behavior before encoding framework or library assumptions. In this repo, follow the `upstream` skill and the package-boundary owner (rule 13) before encoding stack assumptions, and respect the Python toolchain and multi-language toolchain owners (rules 04 and 06) when touching the `services/agent-mcp` side-service.

## Use When

- The user invokes `$elegant`, asks for a clean slate, or explicitly removes backwards compatibility constraints.
- The task is consolidation, simplification, deduplication, deletion of legacy surfaces, or standardization to the canonical owner.
- Current architecture, names, references, or consumers may be wrong and must not define the target shape.

If the user explicitly requires backwards compatibility, a minimal patch, or preservation of a public contract, record that constraint and run only the compatible portion of the elegant workflow.

## Direct Workflow

1. Restate the task as if there were no existing consumers. Name the controlling objective, invariants, and compatibility constraints.
2. Map concepts by meaning before reading current structure as guidance. Start with Code Atlas `pre-edit`, `impact`, `entrypoints`, or `health` queries, and use the `code-atlas` skill's MCP tool map when CodeAtlas-Live MCP is exposed. Include target files, neighboring files and folders, direct and transitive consumers, exports, tests, docs, generated surfaces, owner briefs, `package.json` dependencies, and imports.
3. Choose the canonical owner and smallest architecture. Preserve a separate surface only for a distinct runtime, storage, compliance, lifecycle, or external-contract boundary.
4. Implement through the owner and its neighbors. Merge, move, rename, or delete overlapping surfaces; remove pass-through layers, re-exports, wrappers, local parallel types, redundant schemas, unused branches, orphan tests, stale docs, and declared-but-unused dependencies.
5. Before deleting or privatizing a function, module, export, public subpath, model, schema, enum, owner surface, file, or folder, run Code Atlas `impact` / `consumers` plus AST/LSP import-export-symbol inspection over `src/`, `services/`, `scripts/`, `tests/`, and `docs/`. Use fixed-string `rg -F` only for non-code prose references. If consumers exist, make them the same-change rewrite or deletion worklist.
6. After deleting a file or public subpath, complete the symbol-deletion sweep: package exports in `src/index.ts`, owner prose in `AGENTS.md` or `README.md`, `vi.mock("<path>")` tests, guard allowlists, and an owning-package AST source scan when privatizing.
7. When a removed parameter, dependency, helper, or export exposes pass-through callers, recursively inspect those callers and remove the forwarding chain until the value is either genuinely used or gone.
8. Verify the canonical owner and impacted neighbors with the narrowest checks that prove the behavior: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run guard` or the relevant `guard:*` lane, `npm run check:package`, and generated-surface sync (`npm run sync:llm`, `npm run code-atlas:check`) when the owner requires it. For the Python side-service use `npm run py:lint`, `npm run py:typecheck`, and `npm run py:test`.

When the user explicitly asks for subagents, delegation, parallel agents, or team work, run read-only workers before choosing the target shape: `map`, `context`, `details`, and `skeptic`. The parent reconciles those results before naming the end state, owners, deletion list, or implementation wave. Otherwise, use parallel local reads and direct implementation.

## Planning And Review Output

For a review, recommendation, plan, or task list, explicitly state:

- the elegant end state
- the canonical owners
- legacy surfaces to delete
- overlapping surfaces to merge, move, or rename
- compatibility constraints, or `none`

For implementation closeout, report only what changed, what was verified, and concrete blockers inside the touched scope.

## Boundaries

- Prefer deletion over adaptation when old paths exist only for legacy consumers.
- Do not keep backwards-compatibility shims unless the user explicitly requires them.
- Do not preserve a surface because it is internally consistent or locally referenced; preserve it only when it satisfies the target without duplicating another owner.
- Add an abstraction only when it removes real complexity or matches an established owner pattern.
- Do not hand-author or hand-edit generated artifacts. Migration SQL, TypeScript/Zod type outputs, and other lineage-tagged or generated surfaces are owned by the declarative tree and the supaschema CLI (rule `supaschema.md` and rule 00-supaschema); change the source and regenerate with `supaschema diff` / `supaschema types`, never by restating generated fields inline. Classify and compare DDL through PostgreSQL parse trees and model helpers, not ad hoc regex (rule 07).
