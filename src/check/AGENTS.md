# src/check - migration SQL checks

## Contract

This directory statically checks migration SQL before it is applied. It is included to surface replay, destructive, normalization, and PostgreSQL hazard diagnostics early while keeping the generated migration file as the reviewed artifact.

## Contents

- `migration.ts` parses and checks a migration file.
- `hazards.ts` tracks PostgreSQL hazards such as enum-use ordering and nontransactional escalation.
- `report.ts` renders check diagnostics for CLI output.

## Working Rules

- Checks should explain actionable risk without changing migration SQL.
- Blocking checks belong here only when they protect replay safety or declared policy.
- Non-blocking review diagnostics should remain warnings with clear keys and hints.

## Verification

Run focused migration-check tests for changed diagnostics, then `npm run typecheck`.
