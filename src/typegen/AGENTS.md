# src/typegen - generated TypeScript and Zod contracts

## Contract

This directory emits generated database types, Zod schemas, and type-contract shapes from the schema model. It is included so declarative schema changes can close the consumer type loop through deterministic generated artifacts.

## Contents

- `model.ts` collects typed schema shapes from schema objects.
- `database.ts` renders TypeScript database types.
- `views.ts` resolves view column types.
- `zod.ts` renders Zod schemas.
- `contracts.ts` emits type-contract files.

## Working Rules

- Keep generated output sorted and deterministic.
- Type inference should use modeled facts and catalog/source metadata, not string guesses when structured facts exist.
- Coordinate shape changes with contract diffs and generated snapshot tests.

## Verification

Run focused typegen/contract tests for changed output, then `npm run typecheck`.
