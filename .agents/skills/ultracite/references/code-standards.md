# Ultracite Code Standards

## Supaschema Defaults

- Follow the root `biome.jsonc` formatter: 2-space indentation and 100-column line width.
- Prefer small, explicit functions with early returns over nested control flow.
- Use `unknown` over `any` unless a test fixture or boundary truly needs `any`.
- Use `for...of`, optional chaining, nullish coalescing, and template literals where they clarify code.
- Keep imports specific and type-only imports marked with `import type`.

## Tests

- Use Vitest through `npm test`.
- Do not commit `.only`; `biome.jsonc` keeps focused tests blocked.
- DB-gated suites may use `describe.skipIf` or `it.skipIf` when no database URL is available.
- Keep V8 coverage reporting informational unless a separate change adds thresholds.

## Source Diagnostics

- Do not add broad lint suppressions for generated SQL, parser, or guard behavior.
- Prefer AST/model helpers over ad hoc string matching for SQL-related logic.
- For generated SVG diagnostics, fix the generator source and regenerate the tracked SVG output.
- For intentional literal placeholder text containing `${...}`, split or construct the marker so Biome does not confuse it with an accidental template placeholder.

## Security And Correctness

- Throw `Error` objects with actionable messages.
- Keep diagnostics secret-safe; do not print database credentials, JWTs, or tokens.
- Avoid `eval`, unsanitized HTML injection, and hidden mutable global state.
