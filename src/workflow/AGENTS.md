# src/workflow - sync and apply orchestration

## Contract

This directory coordinates user-facing sync/apply workflows across targets, history, verification, and reporting. It is included so CLI commands and hooks share the same workflow behavior instead of duplicating migration sequencing.

## Contents

- `sync.ts` orchestrates diff, staging, apply, checks, and reporting.
- `targets.ts` resolves configured sync targets.
- `history.ts` checks pending migrations and runner status.
- `verify.ts` checks lineage between pending generated migrations.
- `report.ts` renders workflow output helpers.

## Working Rules

- Workflow code should orchestrate existing modules, not own SQL semantics.
- Preserve the distinction between generated migration staging, applying, checking, and verification.
- Keep reports concise and tied to concrete next actions or blockers.

## Verification

Run focused workflow/sync tests for changed behavior, then `npm run typecheck`.
