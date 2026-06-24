# src/planner - migration operation planning

## Contract

This directory converts before/after schema models into ordered migration operations. It is included so destructive disposition, dependency ordering, replacement policy, and table alteration policy are decided before SQL rendering.

## Contents

- `schema.ts` plans object-level schema diffs.
- `table.ts` plans table and column alterations.
- `replace.ts` classifies replace/drop safety and destructive hints.
- `order.ts` sorts operations for dependency-safe rendering.

## Working Rules

- Planner output should be explicit enough that renderers do not re-decide policy.
- Destructive operations must carry disposition and diagnostics from config, hints, or migration corpus.
- Coordinate new operation kinds with render, check, tests, and docs.

## Verification

Run focused planner/render tests for changed operations, then `npm run typecheck`.
