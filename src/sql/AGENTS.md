# src/sql/ — PostgreSQL AST and schema model

Postgres parse-tree extract/model/render/check helpers over `libpg-query`. Classify and mutate SQL through the parse tree, never ad hoc regex.

## Contents

- `parser.ts` — parse SQL statements to AST nodes
- `extract.ts`, `extract-helpers.ts` — extract schema objects from DDL
- `facts.ts` — finalize objects, canonical hashes, render-guard facts
- `ast.ts`, `statements.ts`, `identifiers.ts` — AST and statement helpers
- `normalize-deparse.ts` — SQL normalization via deparse
- `object-hash.ts` — canonical object hashing
- `policies.ts`, `privileges.ts`, `table-shape.ts`, `table-constraints.ts` — policy, privilege, and table-shape facts

## Owners

- AST-over-regex: `.claude/rules/07-ast-over-regex.md`
- Migration SQL safety and replay: `.claude/rules/supaschema.md`
