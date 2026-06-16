# Plan 003: Dispatch every `ALTER TABLE` subcommand instead of silently dropping all but the first

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `advisor-plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat f27746f..HEAD -- src/sql/extract-helpers.ts src/sql/extract.ts` — if either changed since this plan was written, compare the "Current state" excerpt against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED
- **Depends on**: none
- **Category**: bug (correctness, fail-open)
- **Planned at**: commit `f27746f`, 2026-06-15

## Why this matters

A single `ALTER TABLE` statement may carry multiple comma-separated subcommands, e.g.:

```sql
ALTER TABLE t ADD CONSTRAINT pk PRIMARY KEY (id), ENABLE ROW LEVEL SECURITY;
```

`alterTableObjects` only inspects the **first** recognized subcommand and returns a single object for it; every later subcommand in the same statement is silently discarded with **no diagnostic**. The example above models the primary-key constraint but drops the RLS enable entirely — and RLS is a security boundary. This violates supaschema's core invariant that unsupported/ambiguous DDL must **fail closed with a diagnostic**, never silently pass through. A declarative tree that groups subcommands in one statement produces a divergent model and a wrong migration with no warning.

## Current state

`src/sql/extract-helpers.ts:12-81` — `alterTableObjects`. The defect is the `.map(...).find(...)` at lines 22-24, which collapses all subcommands to the first non-null one:

```ts
export function alterTableObjects(
  node: AstNode,
  statement: string,
  ordinal: number,
  file: string | undefined
): SchemaObject[] | undefined {
  const table = rangeVarName(node.relation);
  if (!table) {
    return;
  }
  const command = readArray(node.cmds)
    .map((item) => asRecord(asRecord(item)?.AlterTableCmd))
    .find((item) => item !== undefined); // <-- only the first cmd survives
  const subtype = readString(command?.subtype);
  if (subtype === "AT_AddConstraint") {
    /* returns [constraint object] */
  }
  if (
    subtype === "AT_EnableRowSecurity" ||
    subtype === "AT_DisableRowSecurity" ||
    subtype === "AT_ForceRowSecurity" ||
    subtype === "AT_NoForceRowSecurity"
  ) {
    /* returns [rls object] */
  }
  if (subtype === "AT_ColumnDefault") {
    /* returns [table object w/ columnDefaultAmendment] */
  }
  return; // unrecognized -> undefined
}
```

The function already returns `SchemaObject[]` (an array), so returning **multiple** objects from one statement is type-compatible.

Caller — `src/sql/extract.ts:76` (inside a statement dispatch):

```ts
alterTableObjects(node, statement.text, ordinal, file),
```

The dispatch consumes a `SchemaObject[] | undefined`. Returning more than one object from a multi-command statement is therefore already supported by the call site's type; the risk is downstream identity (two objects from one statement sharing an `ordinal`).

Supporting facts:

- `makeObject(ref, statement, ordinal, file, metadata)` (`src/sql/statements.ts:7`) builds each object; its `hash`/`key` derive from `ref` (object identity), not from `ordinal`, so two distinct objects (a `constraint` and an `rls`) from the same statement get distinct keys. Two objects of the _same_ kind from one statement is not a case `ALTER TABLE` produces here (the recognized subtypes are constraint / rls / column-default), so key collisions are not expected — but confirm during testing.
- The "fail closed" diagnostic helper is `diagnostic(code, severity, message, extras)` from `src/diagnostics.ts` (it redacts secrets). Unsupported-DDL codes already exist, e.g. `SUPA_EXTRACT_UNSUPPORTED` (see `src/diagnostics.ts` catalog). Reuse an existing code rather than inventing one unless none fits.

Repo conventions:

- Rule 07: classify DDL via the parse tree (the `AlterTableCmd` nodes), never regex.
- Fail closed: an unrecognized subtype in a mixed statement should surface a diagnostic, not vanish.
- NodeNext `.js` imports; `npm run format` to apply fixes.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Typecheck | `npm run typecheck` | exit 0 |
| Targeted tests | `npx vitest run tests/sql.test.ts tests/table-constraints.test.ts tests/cross-lane.test.ts` | all pass |
| Full tests | `npm test` | all pass |
| Lint | `npm run lint` | exit 0 |
| Apply fixes | `npm run format` | writes fixes |
| Build | `npm run build` | exit 0 |

## Scope

**In scope**:

- `src/sql/extract-helpers.ts`
- `tests/sql.test.ts` and/or `tests/table-constraints.test.ts` (add multi-command cases)
- `src/diagnostics.ts` — only if you add a new diagnostic code to the catalog (prefer reusing an existing unsupported-DDL code)

**Out of scope** (do NOT touch):

- `src/sql/extract.ts` dispatch structure — the caller already accepts `SchemaObject[] | undefined`; do not change its shape.
- `src/sql/statements.ts` `makeObject` — reuse as-is.
- Any planner/render behavior — this plan changes _extraction_ only.

## Git workflow

- Branch: `advisor/003-alter-table-multi-command` off the default branch.
- Commit style: conventional commits (e.g. `fix(extract): model every ALTER TABLE subcommand, not just the first`).
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Iterate all `AlterTableCmd` nodes and accumulate objects

Refactor `alterTableObjects` to loop over **every** command, dispatch each recognized subtype, and accumulate the resulting objects. Extract the existing per-subtype logic into a small helper that maps one `command` to a `SchemaObject | undefined`, then:

```ts
const commands = readArray(node.cmds)
  .map((item) => asRecord(asRecord(item)?.AlterTableCmd))
  .filter((item): item is AstNode => item !== undefined);

const objects: SchemaObject[] = [];
let sawUnsupported = false;
for (const command of commands) {
  const object = alterTableCommandObject(
    command,
    table,
    statement,
    ordinal,
    file
  );
  if (object) {
    objects.push(object);
  } else {
    sawUnsupported = true;
  }
}
```

Where `alterTableCommandObject` contains the existing `AT_AddConstraint` / RLS / `AT_ColumnDefault` branches (returning a single object or `undefined`).

**Verify**: `npm run typecheck` → exit 0.

### Step 2: Decide the return for mixed/unsupported statements (fail closed)

Preserve current behavior for the simple cases while not silently dropping anything:

- If `objects` is non-empty, return `objects`.
- If `objects` is empty (no subcommand recognized), return `undefined` — this is the existing "unsupported statement" signal the caller already handles, so the statement is reported as unsupported DDL upstream (unchanged behavior).
- If **some** commands were recognized and **some** were not (`objects.length > 0 && sawUnsupported`), the partial-model case is the dangerous one. Surface it rather than hiding it: attach a diagnostic so the run does not silently proceed with a partial model.

For the diagnostic, check how the caller at `extract.ts:76` collects diagnostics vs objects. If the dispatch path returns only `SchemaObject[]` and has no diagnostic channel here, the lowest-risk option is to make `alterTableObjects` return `undefined` (fail closed → "unsupported statement" diagnostic upstream) for the **mixed-and-partially-unsupported** case, so a statement that can't be fully modeled is rejected rather than half-modeled. **Read `extract.ts` around line 76 first** to see whether a diagnostic can be returned alongside the objects; prefer the explicit diagnostic if the channel exists.

**Verify**: `npm run typecheck` → exit 0.

### Step 3: Format and run the suite

`npm run format`, then tests. Watch especially `tests/cross-lane.test.ts` (catalog↔tree parity) and `tests/table-constraints.test.ts`.

**Verify**:

- `npm run lint` → exit 0
- `npx vitest run tests/sql.test.ts tests/table-constraints.test.ts tests/cross-lane.test.ts` → all pass
- `npm test` → all pass
- `npm run build` → exit 0

## Test plan

Add cases (in `tests/sql.test.ts` or `tests/table-constraints.test.ts`, matching the existing extract-test style in those files):

- **Multi-command, all recognized**: `ALTER TABLE public.t ADD CONSTRAINT pk PRIMARY KEY (id), ENABLE ROW LEVEL SECURITY;` → asserts **two** objects are produced (a `constraint` and an `rls`), each with the expected `ref.kind`. This is the regression this plan fixes.
- **Single-command (unchanged)**: `ALTER TABLE public.t ADD CONSTRAINT pk PRIMARY KEY (id);` → exactly one constraint object (proves no regression for the common case).
- **Mixed recognized + unsupported**: an `ALTER TABLE` combining a recognized subcommand with an unsupported one → asserts the chosen fail-closed behavior from Step 2 (either an unsupported diagnostic or `undefined`), never a silently partial model.
- Verification: `npx vitest run <those files>` → all pass including the new cases.

## Done criteria

ALL must hold:

- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0, with a new test asserting both objects from a two-command `ALTER TABLE`
- [ ] `grep -n "\.find(" src/sql/extract-helpers.ts` shows the old first-command-only `.find` over `node.cmds` is gone (the column-default/other `.find` usages elsewhere in the repo are unrelated)
- [ ] `npm run lint` exits 0
- [ ] `npm run build` exits 0
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `advisor-plans/README.md` status row updated

## STOP conditions

Stop and report if:

- Reading `extract.ts` reveals the caller cannot accept more than one object per statement without ordinal/key collisions you cannot resolve cleanly — report the structure before changing the caller (the caller is out of scope by default).
- Two objects produced from one statement collide on `key` (same `objectKey(ref)`), causing a `SUPA_EXTRACT_DUPLICATE_OBJECT` diagnostic in a case that should be valid — report it; the dedup rule may need a deliberate decision.
- An existing cross-lane/extract test changes its expected object **count** in a way you cannot explain by "previously-dropped subcommands now correctly modeled" — that would indicate over-capture; investigate before updating any expected output.

## Maintenance notes

- When a new `ALTER TABLE` subtype is supported in the future, add it to the per-command helper; the multi-command loop already handles accumulation.
- Reviewer should confirm the fail-closed branch (mixed recognized + unsupported) genuinely surfaces a diagnostic or rejects, and never returns a partial model silently.
- Any expected-output change in fixtures/snapshots must be justified by "a previously-dropped subcommand is now modeled," not by a behavior change to the recognized subtypes.
