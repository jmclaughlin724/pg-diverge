# src/sql - PostgreSQL AST and schema model

## Contract

This directory owns PostgreSQL parse-tree helpers over `libpg-query` plus the local support contract for `pgsql-deparser` gaps. It is included so source extraction, normalization, facts, object hashing, and replay checks classify SQL from structured AST data instead of brittle text rules.

## Contents

- `parser.ts` parses SQL statements to AST nodes.
- `support.ts` defines the executable support matrix and known deparser-gap contract.
- `extract.ts` and `extract-helpers.ts` extract schema objects from DDL.
- `facts.ts` finalizes objects, canonical hashes, and render-guard facts.
- `ast.ts`, `statements.ts`, and `identifiers.ts` provide AST node-kind, unwrap, statement, and identifier helpers.
- `normalize-deparse.ts` normalizes SQL through deparse.
- `object-hash.ts` hashes canonical objects.
- `policies.ts`, `privileges.ts`, `table-shape.ts`, and `table-constraints.ts` collect policy, privilege, and table-shape facts.

## Working Rules

- Classify and mutate SQL through parse trees where the parser supports the statement.
- Prefer shared AST node-kind and unwrap helpers over open-coded parser wrapper probes.
- Known deparser gaps belong in `support.ts` and focused normalization tests.
- Keep source-intent extraction explicit for supported-but-not-modeled statements.

## Owners

- AST-over-regex: `.claude/rules/07-ast-over-regex.md`
- Migration SQL safety and replay: `.claude/rules/supaschema.md`

## Verification

Run focused SQL extraction, normalization, support-contract, and render tests for changed behavior, then `npm run typecheck`.
