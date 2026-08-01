---
description: Parser/AST-first policy — AST/parser analysis is sanctioned throughout the repo wherever it applies; prefer it over regex.
paths:
  - "src/**"
  - "scripts/**"
  - "services/**"
  - "tests/**"
  - "bin/**"
  - "cloudflare/**"
  - ".claude/hooks/**"
---

# Rule 07 — Analyze structure with an AST/parser, not regex

## Contract

This rule owns the policy that structural analysis uses an AST/parser, and that AST/parser use is sanctioned throughout the repo wherever it applies — with no restriction by directory, language, or surface.

Guards, hooks, scripts, source, and tests use a real AST/parser for structural analysis anywhere in the repo. Wherever a parser exists for the format — TypeScript compiler API for JS/TS, libpg_query for SQL, `JSON.parse` for JSON, a YAML/TOML parser for config, mdast for Markdown/MDX, the Python `ast` module, or the owned shell parsers below — it is the preferred tool for structural questions.

Regex cannot see structure: quote style, whitespace, type parameters, comments, string contents, and node nesting all create bypasses (an adversarial pass found ~12 in the regex-era shape detector — single/mixed quotes, `z .enum`, `z.enum (`, a marker smuggled inside a string) and false positives. A parser sees the real tree, so that whole class of holes is gone by construction. Literal string operations remain appropriate for non-structural scalar-value tests (a version prefix, a path suffix, membership in a known set). When a Zod config field must emit a JSON Schema `pattern` keyword, inject it with `.meta({ pattern: "..." })` instead of `.regex()` — `zodTypesImportPath` in `src/config/schema.ts` is the canonical example; the emitted schema is identical and source stays free of regex literals.

Enforced by `scripts/guards/code-shape/check-canonical-surfaces.mjs` (in `npm run guard` via `scripts/guards/check-all.mjs`), which AST-scans every tracked JS/TS, Python, and shell file under `src/`, `scripts/`, `services/`, `tests/`, `bin/`, `benchmarks/`, `.claude/hooks/`, `.claude/skills/`, `.agents/skills/`, `cloudflare/`, plus root config scripts, and fails on regex literals, `RegExp(...)` calls, regex-shaped strings, Python `re` usage, and shell `=~`. Detection is itself AST/parser-based, so the rule dogfoods.

Guards enforce observable structure or behavior — AST shape, file existence, JSON registration, hook topology, or runtime output — never that a documentation file contains a specific prose string. Test behavior, or enforce policy at its canonical owner; coupling a guard to doc wording is brittle and circular.

## Use the right tool

| What you are analyzing | Use |
| --- | --- |
| TypeScript / JS / JSX structure | TypeScript compiler API via `scripts/guards/lib/typescript-ast.js` (`parse`, `parseScript`, `forEachNode`) |
| Postgres schema SQL (tables, RLS, functions…) | the real Postgres parser via `scripts/guards/lib/sql-ast.js` (libpg-query / libpg_query) |
| Python structure | the `ast` module (see `scripts/guards/code-shape/check-pattern-engine.mjs` for the in-guard pattern) |
| Bash tool-command structure in agent hooks | synchronous `parse` from `unbash` through `scripts/agent-hooks/shell-command.mjs` |
| Shell-file structure and multi-dialect formatting | `parse` / `print` from `sh-syntax` (mvdan/sh WASM) |
| `package.json` / `tsconfig` / JSON config | `JSON.parse` + object walks |
| YAML / TOML config | a YAML parser / `taplo` parser |
| Markdown / MDX structure | a markdown AST (mdast) |

The parser owners are `scripts/guards/lib/typescript-ast.js`, `scripts/guards/lib/sql-ast.js`, and `scripts/agent-hooks/shell-command.mjs`. The TypeScript compiler API is sufficient for this repository's syntax and import analysis; do not add `ts-morph` unless a concrete project-model or mutation requirement exceeds that owner.

## Regex resolution sequence

When resolving a regex violation, use `ast-grep` as the first discovery or codemod pass when it is available in the active toolchain, then use the TypeScript AST, the compiler, or the relevant parser/typecheck lane to prove exact node classes and compile safety. Replace regex behavior with the canonical scanner, parser, or model helper in the owning module. Re-run the ast-grep query plus the parser-backed guard to prove zero pattern-engine nodes remain; if `ast-grep` is unavailable, record that fact and use the canonical AST scanner as the fallback evidence.

## Decision posture

This is a technical decision — resolve it by Rule 05 (research the upstream best practice), not a guess. Where a first-class parser exists for the format, it is the canonical choice.

STOP if regex ships for structural analysis anywhere in the repo where an AST/parser can express the check. STOP if a guard requires a documentation file to contain a specific prose string instead of testing behavior or structure — let the rule own its wording.

## Verification

Run `npm run guard` or `node scripts/guards/code-shape/check-canonical-surfaces.mjs` after changing source, scripts, hooks, guards, or parser helpers. Detector changes need focused true-positive and false-positive tests.

## Failure behavior

Convert regex to the canonical parser for the format (TypeScript AST, libpg-query, Python `ast`, `unbash` for Bash hook commands, `sh-syntax` for shell files, `JSON.parse`, YAML/TOML parser, mdast).

## Done means

Structural analysis across the repo uses the canonical parser for its format, and the parser-backed guard plus focused tests cover the target structure.
