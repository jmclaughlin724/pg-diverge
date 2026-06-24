# src/scan - schema safety scanning

## Contract

This directory owns rule-pack scanning, safety scoring, JSON report validation, aggregation, and badge output. It is included so deploy-safety policy can use structured diagnostics instead of embedding checks in the CLI.

## Contents

- `rules.ts` defines hygiene, migration-safety, RLS, and grant rule packs.
- `model.ts` runs scans, grades results, validates reports, and renders output.
- `aggregate.ts` aggregates opt-in scan report files.

## Working Rules

- Scan rules should inspect the schema model and return diagnostics, not mutate plans or SQL.
- Keep diagnostic codes stable for downstream reports and badges.
- Policy decisions that block deployment belong in `src/pipeline/deploy-safety.ts`.

## Verification

Run focused scan/deploy-safety tests for changed rules, then `npm run typecheck`.
