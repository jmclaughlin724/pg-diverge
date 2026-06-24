# src/benchmark - benchmarks and diff scoring

## Contract

This directory contains benchmark-only code for exercising supaschema against generated and corpus-like schema changes. It is included so planner/rendering changes can be measured against realistic migration output, not only unit fixtures.

## Contents

- `fixtures.ts` builds deterministic realistic SQL fixture pairs.
- `diff-score.ts` classifies rendered migration SQL against a fixture manifest.
- `run.ts` wires benchmark execution and reporting.

## Working Rules

- Keep benchmark code out of core planner, render, and check paths.
- Prefer deterministic fixtures and scores so benchmark deltas are reviewable.
- When a new operation kind becomes supported, update the manifest and classifier together.

## Verification

Run the focused benchmark or diff-score test when changed, then `npm run typecheck`.
