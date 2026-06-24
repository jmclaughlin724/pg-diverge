# src/verify - migration replay verification

## Contract

This directory verifies migrations against disposable PostgreSQL databases. It is included so generated SQL can be proven to replay from the declared source state and converge to the target state.

## Contents

- `environment.ts` checks database capabilities and provides Supabase environment stubs.
- `migration.ts` applies before state, migration SQL, and target state comparisons.

## Working Rules

- Verification must run against isolated disposable databases.
- Keep environment capability failures explicit so local setup issues are not mistaken for migration correctness.
- Do not mutate source files or migration files during verification.

## Verification

Run focused verify tests or `npm run fixture:verify` when a database URL is available, then `npm run typecheck`.
