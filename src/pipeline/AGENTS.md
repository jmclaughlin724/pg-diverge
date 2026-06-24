# src/pipeline - high-level gates

## Contract

This directory composes lower-level source, catalog, planner, scan, and typegen modules into workflow gates. It is included so CLI and workflow code can ask for a diff plan, deploy-safety decision, or type-safety decision without duplicating orchestration.

## Contents

- `diff.ts` builds schema diff plans from configured sources.
- `deploy-safety.ts` applies scan diagnostics to deploy policy.
- `type-safety.ts` evaluates generated type contract drift.

## Working Rules

- Keep low-level SQL extraction, planning, rendering, and scanning in their owning directories.
- Gate results should report diagnostics and policy disposition without mutating source files.
- When adding a new policy path, wire config, diagnostics, CLI output, and tests together.

## Verification

Run focused pipeline/gate tests for changed behavior, then `npm run typecheck`.
