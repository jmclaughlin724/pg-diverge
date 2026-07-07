# src/typegen - generated TypeScript and Zod contracts

## Contract

This directory emits generated database types, Zod schemas, and type-contract shapes from the schema model. It is included so declarative schema changes can close the consumer type loop through deterministic generated artifacts.

## Contents

- `model.ts` collects typed schema shapes from schema objects.
- `database.ts` renders TypeScript database types.
- `views.ts` resolves view column types from libpg-query AST node kinds plus modeled source facts.
- `zod.ts` renders Zod schemas.
- `contracts.ts` emits type-contract files.

## Working Rules

- Keep generated output sorted and deterministic.
- `migrations:` is a valid caller-selected typegen input. Typegen must still enter through `extractSourceModel`; do not read migration files directly from this directory.
- v1 migration replay is typegen-only. Do not treat a reconstructed migration model as planner-grade for `diff`, `verify`, or drift until source identity equivalence is proven.
- Type inference should use modeled facts, catalog/source metadata, and AST node-kind dispatch, not SQL text guesses or ad hoc wrapper probing when structured facts exist.
- A schema-backed field that still resolves to `unknown` is missing model coverage or a missing diagnostic. Fix the relation/function/extension/expression source or add an actionable `SUPA_*` diagnostic before asking consumers to adapt.
- Preserve PostgreSQL output semantics: CTE sources shadow only unqualified range variables, schema-qualified relation references remain qualified, qualified stars expand only the matched source, `USING`/`NATURAL` joins merge join keys once, column alias lists apply positionally, visible function overloads beat builtin fallbacks, and predicate sublinks infer boolean results.
- Coordinate shape changes with contract diffs and generated snapshot tests.

## Verification

Run focused typegen/contract tests for changed output, then `npm run typecheck`.
