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

## Current state

- `src/typegen-model.ts` — owns the shape model. The relevant exports:
  - line 65: `export interface SchemaShapes { ... }`
  - line 81: `export async function collectSchemaShapes(model: SchemaModel): Promise<SchemaShapes> { ... }` `SchemaShapes` is immutable after construction.
- `src/typegen.ts:17` — the TS generator, which re-derives shapes:
  ```ts
  export async function generateDatabaseTypes(
    model: SchemaModel
  ): Promise<string> {
    const shapes = await collectSchemaShapes(model);
    // ...emits TS from shapes...
  }
  ```
- `src/typegen-zod.ts:12` — the Zod generator, an independent second walk:
  ```ts
  export async function generateZodSchemas(
    model: SchemaModel
  ): Promise<string> {
    const shapes = await collectSchemaShapes(model);
    // ...emits Zod from shapes...
  }
  ```
- `src/cli-tools.ts:54-76` — the `types` command. It calls both generators on the same `model`:
  ```ts
  const types = await generateDatabaseTypes(model); // line 63
  // ...
  await writeFile(zodPath, await generateZodSchemas(model)); // line 74
  ```
- `src/cli-diff.ts:307-351` — `refreshTypesFile` (used by `supaschema diff`). It shares the `SchemaModel` via the lazy `getModel()` closure but still calls `target.generate(model)` per target, where `generate` is `generateDatabaseTypes` / `generateZodSchemas` (lines 318, 323) — so each target re-runs `collectSchemaShapes`:
  ```ts
  const targets: { generate: (model: SchemaModel) => Promise<string>; policy: ...; relative: string }[] = [
    { generate: generateDatabaseTypes, policy: config.workflow.type_generation, relative: config.typesFile },
    { generate: generateZodSchemas,    policy: config.workflow.zod_generation,  relative: config.zodFile },
  ];
  ```
- `src/index.ts:65-66` — `generateDatabaseTypes` and `generateZodSchemas` are part of the public library API:
  ```ts
  export { generateDatabaseTypes } from "./typegen.js";
  export { generateZodSchemas } from "./typegen-zod.js";
  ```
  **These public signatures must not change** — keep them as `(model: SchemaModel) => Promise<string>` so library consumers are unaffected.

Repo conventions to match:

- NodeNext ESM: every relative import uses an explicit `.js` extension (e.g. `from "./typegen-model.js"`). Match it.
- One owner per concern: `collectSchemaShapes` is the single shapes owner — do not duplicate shape logic.
- Apply formatting/lint fixes with `npm run format` (the repo's single write command — Rule 06/08). Do **not** run `npm run lint fix`.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Typecheck | `npm run typecheck` | exit 0, no errors |
| Targeted tests | `npx vitest run tests/typegen.test.ts tests/generated-output.test.ts` | all pass |
| Full tests | `npm test` | all pass |
| Lint | `npm run lint` | exit 0 |
| Apply fixes | `npm run format` | writes formatting/lint fixes |
| Build | `npm run build` | exit 0 |

## Scope

**In scope** (the only files you should modify):

- `src/typegen.ts`
- `src/typegen-zod.ts`
- `src/cli-tools.ts`
- `src/cli-diff.ts`
- `src/index.ts` (only to add exports of the new `*FromShapes` helpers, if you choose to export them — optional; internal callers can import them directly without an `index.ts` export)
- `tests/typegen.test.ts` (extend)

**Out of scope** (do NOT touch):

- `src/typegen-model.ts` — `collectSchemaShapes` and `SchemaShapes` are reused as-is; do not change the shape model.
- The emitted TypeScript/Zod **output strings** — the generated content must be byte-for-byte identical (snapshot/fixture parity proves this).
- Any generated `.types.ts` / `.zod.ts` fixture file under `tests/` — those are evidence; don't hand-edit them.

## Git workflow

- Branch: `advisor/001-typegen-single-shapes` off `main` (or the current default branch).
- Commit message style follows the repo (conventional commits — e.g. `perf(typegen): compute SchemaShapes once for TS + Zod`).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add a shapes-accepting variant to each generator, keep the model-accepting export as a wrapper

In `src/typegen.ts`, extract the body of `generateDatabaseTypes` into a new exported function that takes pre-computed shapes, and make the existing function delegate:

```ts
export function generateDatabaseTypesFromShapes(shapes: SchemaShapes): string {
  // ...the existing body, minus the `const shapes = await collectSchemaShapes(model)` line...
  // (it no longer needs to be async if nothing else awaits; keep it async-returning if simpler — match the existing style)
}

export async function generateDatabaseTypes(
  model: SchemaModel
): Promise<string> {
  return generateDatabaseTypesFromShapes(await collectSchemaShapes(model));
}
```

Do the identical transform in `src/typegen-zod.ts` for `generateZodSchemas` → `generateZodSchemasFromShapes(shapes)`. Import `SchemaShapes` from `./typegen-model.js` (both files already import from it).

**Verify**: `npm run typecheck` → exit 0.

### Step 2: Share one `collectSchemaShapes` call in the `types` command

In `src/cli-tools.ts` (the `types` action, lines ~54-76), compute shapes once and pass to both generators:

```ts
const shapes = await collectSchemaShapes(model);
const types = generateDatabaseTypesFromShapes(shapes);
// ...unchanged stdout / path handling...
await writeFile(zodPath, generateZodSchemasFromShapes(shapes));
```

Add the imports for `collectSchemaShapes` (from `./typegen-model.js`) and the two `*FromShapes` helpers. Remove the now-unused imports if `generateDatabaseTypes`/`generateZodSchemas` are no longer referenced here.

**Verify**: `npm run typecheck` → exit 0; `npx vitest run tests/typegen.test.ts` → all pass.

### Step 3: Share one `collectSchemaShapes` call in `refreshTypesFile`

In `src/cli-diff.ts` (`refreshTypesFile`, lines ~307-351), change the `targets` array entries from `generate: (model) => Promise<string>` to a shapes-accepting shape, and compute the shapes once via the existing lazy model closure. The cleanest form: add a memoized `getShapes()` alongside `getModel()` that calls `collectSchemaShapes` at most once, and have each target's generate accept shapes.

Target shape after the change (illustrative — match the file's existing structure):

```ts
const targets = [
  {
    generate: generateDatabaseTypesFromShapes,
    policy: config.workflow.type_generation,
    relative: config.typesFile,
  },
  {
    generate: generateZodSchemasFromShapes,
    policy: config.workflow.zod_generation,
    relative: config.zodFile,
  },
];
// getShapes() computes collectSchemaShapes(model) once and caches it;
// refreshExistingGeneratedOutput / createOrRefreshGeneratedOutput call target.generate(shapes) instead of target.generate(model).
```

Update the two helper functions `refreshExistingGeneratedOutput` and `createOrRefreshGeneratedOutput` (lines ~353-391) to take/forward shapes instead of a model. Keep the ENOENT-skip and `disabled`-policy behavior exactly as-is.

**Verify**: `npm run typecheck` → exit 0.

### Step 4: Format, then prove output parity

Run `npm run format`, then the verification suite. The whole point is that the generated TS/Zod is unchanged — `tests/generated-output.test.ts` and `tests/typegen.test.ts` (and any fixture snapshots) must pass **without** updating any expected output.

**Verify**:

- `npm run lint` → exit 0
- `npx vitest run tests/typegen.test.ts tests/generated-output.test.ts` → all pass, no snapshot updates needed
- `npm test` → all pass
- `npm run build` → exit 0

## Test plan

- Extend `tests/typegen.test.ts` with one assertion that `generateDatabaseTypesFromShapes(shapes)` and `generateZodSchemasFromShapes(shapes)`, when fed `await collectSchemaShapes(model)`, produce output **identical** to the existing `generateDatabaseTypes(model)` / `generateZodSchemas(model)` for a representative model (reuse whatever model/fixture `tests/typegen.test.ts` already builds). This locks in "no behavioral change".
- Optional, stronger: add a spy/counter proving `collectSchemaShapes` runs once per `types`/`diff` invocation rather than twice. Only do this if `collectSchemaShapes` can be spied without contorting the code; otherwise skip.
- Verification: `npx vitest run tests/typegen.test.ts` → all pass including the new assertion.

## Done criteria

ALL must hold:

- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0 with no expected-output/snapshot edits required
- [ ] `npm run lint` exits 0
- [ ] `npm run build` exits 0
- [ ] `grep -n "collectSchemaShapes" src/typegen.ts src/typegen-zod.ts src/cli-tools.ts src/cli-diff.ts` shows the call happening once per generation path (in the wrappers and once each in the two callers), not twice in a single `types`/`diff` run
- [ ] Public exports `generateDatabaseTypes(model)` / `generateZodSchemas(model)` in `src/index.ts` are unchanged in signature
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `advisor-plans/README.md` status row updated

## STOP conditions

Stop and report (do not improvise) if:

- The generated TS/Zod output changes (any expected-output/snapshot test fails) — that means the refactor altered behavior; the shapes-accepting variant must be a pure extraction.
- `collectSchemaShapes` turns out to mutate `model` or `shapes` such that it cannot be safely shared between two generators (read the function body; if it returns a fresh immutable object, you are fine).
- The `refreshTypesFile` policy handling (`disabled`, `refresh_existing`, `create_or_refresh`, ENOENT-skip) cannot be preserved while sharing shapes — if so, report the structure rather than changing the policy semantics.

## Maintenance notes

- If a third generated output is ever added (e.g. a SQL or JSON-schema emitter), it should also take `SchemaShapes` and reuse the single `collectSchemaShapes` call — keep the "compute once, fan out" shape.
- Reviewer should scrutinize that `generateDatabaseTypesFromShapes` is a pure extraction (diff the old body against the new body line-by-line) and that the `cli-diff.ts` policy/ENOENT branches are untouched.
- This composes with any future caching of `collectSchemaShapes`; it does not preclude it.
