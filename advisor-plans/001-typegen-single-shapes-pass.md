# Plan 001: Compute typegen `SchemaShapes` once and share it across the TypeScript and Zod generators

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `advisor-plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat f27746f..HEAD -- src/typegen.ts src/typegen-zod.ts src/typegen-model.ts src/cli-tools.ts src/cli-diff.ts src/index.ts` — if any of these changed since this plan was written, compare the "Current state" excerpts below against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf / tech-debt
- **Planned at**: commit `f27746f`, 2026-06-15

## Why this matters

`supaschema diff` (the default workflow) and `supaschema types` both write a TypeScript file **and** a Zod file from the same in-memory `SchemaModel`. Each generator independently calls `collectSchemaShapes(model)` — a full walk of every schema object that re-parses object SQL through libpg-query, resolves constraints, composites, domains, function shapes, and view columns. So every type-writing run does this expensive walk **twice** on the identical, immutable model. On a large schema (hundreds of tables/functions) this doubles typegen CPU time on every schema edit. Computing the shapes once and feeding both generators removes the redundant walk with zero behavioral change, and gives typegen one canonical "shapes" owner.

## Current canonical state

- `src/typegen-model.ts` owns `SchemaShapes` and `collectSchemaShapes(model)`.
- `src/typegen.ts` owns `generateDatabaseTypes(shapes)`.
- `src/typegen-zod.ts` owns `generateZodSchemas(shapes)`.
- `src/cli-tools.ts` and `src/pipeline-services.ts` collect shapes once and pass the same graph to both generators.
- `src/index.ts` exports `collectSchemaShapes`, the shape types, `generateDatabaseTypes`, and `generateZodSchemas`.

## Execution result

This plan is complete only when the shape graph is the sole generator input. Do not keep a model-accepting generator as a public convenience path. Callers that have a `SchemaModel` must call `collectSchemaShapes(model)` explicitly, then pass the result to the TypeScript and Zod generators.

## Verification

- `npm run typecheck`
- `npx vitest run tests/typegen.test.ts tests/generated-output.test.ts`
- `npm test`
- `npm run lint`
- `npm run build`

## Done criteria

- [x] `supaschema types` and generated-output refresh compute `collectSchemaShapes` once per source model and reuse it for TypeScript and Zod generation.
- [x] `generateDatabaseTypes` and `generateZodSchemas` accept `SchemaShapes`.
- [x] `src/index.ts` exposes the shape collector and shape types needed by library callers.
- [x] No model-accepting generator remains as a delegating compatibility path.
- [x] Generated TypeScript and Zod output remain byte-for-byte stable under the verification suite.
