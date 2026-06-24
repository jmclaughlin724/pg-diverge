# src/source - declarative source extraction

## Contract

This directory resolves declarative sources and turns SQL trees into normalized schema models. It is included so file-based source, runtime source defaults, schema filtering, and normalization all feed the same planner model.

## Contents

- `resolve.ts` resolves source defaults and migration directories from config.
- `extract.ts` reads source trees and extracts schema models.
- `normalize.ts` normalizes extracted source objects.

## Working Rules

- Use parser-backed SQL extraction through `src/sql`, not ad hoc text matching.
- Keep schema filters and managed-schema exclusions before planner input.
- Normalize source models deterministically so generated diffs are stable.

## Verification

Run focused source, normalization, or generated-output tests for changed behavior, then `npm run typecheck`.
