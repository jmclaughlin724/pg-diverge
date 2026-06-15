# Rule 07 — Analyze code with an AST, not regex

Guards and hooks that reason about **code structure** parse it with a real **AST/parser** — never a regex. Regex cannot see structure: quote style, whitespace, type parameters, comments, and string contents all create bypasses (an adversarial pass found ~12 in the regex-era shape detector — single/mixed quotes, `z .enum`, `z.enum (`, a marker smuggled inside a string) and false positives. An AST sees the real tree, so that whole class of holes is gone by construction.

Enforced by `scripts/guards/check-no-regex-in-scripts.mjs` (in `npm run guard` via `scripts/guards/check-all.mjs`). Detection is itself AST-based — each script is parsed with the TypeScript compiler API via `scripts/guards/lib/ast-utils.mjs`, so the rule dogfoods.

## Scope

Every JS-family script under `scripts/` and `.claude/hooks/` (`.mjs` / `.js` / `.cjs`). Each is either regex-free or carries an explicit `// regex-ok:` marker on every regex usage. **There is no file allowlist and no grandfather list** — nothing is exempt by virtue of having existed before the rule.

## Use the right tool

| What you are analyzing | Use |
| --- | --- |
| TypeScript / JS / JSX structure | TypeScript compiler API via `lib/ast-utils.mjs` (`parse`, `parseScript`, `forEachNode`, `leadingCommentHasToken`) |
| Postgres schema SQL (tables, RLS, functions…) | the real Postgres parser via `lib/sql-ast.mjs` (libpg-query / libpg_query) |
| `package.json` / `tsconfig` / JSON config | `JSON.parse` + object walks |
| TOML / a known-format config line | string ops (`split`, `indexOf`, `slice`, `startsWith`) |
| A version prefix / path suffix / membership | `startsWith` / `endsWith` / `includes` |

The shared helpers are `scripts/guards/lib/ast-utils.mjs` (TS AST) and `scripts/guards/lib/sql-ast.mjs` (Postgres AST) — study them first. Comment markers are read only from **real comment ranges** at a token boundary, so `disable-regex-ok:` ≠ `regex-ok:` and a marker cannot be smuggled through a string literal.

## When regex IS the right tool (annotate it)

Regex is legitimate for matching **text, not code structure**, and is allowed only with an `// regex-ok: <reason>` marker on the usage (a leading comment on the line above, or a trailing comment on the same line). Genuine cases:

- Free-text / banned-word scanning of prose (copy compliance, certainty language) — e.g. `\block\b` word-boundary matching that string `.includes()` cannot express.
- Secret-token / credential pattern detection.
- A simple path glob where a real glob matcher is overkill.

```js
// regex-ok: banned certainty words, word-boundary match over user-facing prose
const banned = [/\bguaranteed\b/i, /\block\b/i]
```

The marker must name _why_ regex is right — not merely silence the guard. If the target is code, convert it; do not annotate your way around structural analysis.

## Decision posture

This is a technical decision — resolve it by Rule 05 (research the upstream best practice), not a guess. Where a first-class parser exists for the language (TypeScript compiler API, libpg_query for Postgres), it is the canonical choice.

STOP if a regex that analyzes code structure ships in a script under `scripts/` or `.claude/hooks/` without being converted to an AST/parser, or if a non-structural regex ships without an `// regex-ok:` reason.
