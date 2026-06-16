# Plan 006: Warn that `ALTER COLUMN TYPE` renders an identity `USING` cast that fails for most real conversions

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `advisor-plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat f27746f..HEAD -- src/render.ts src/planner-table.ts src/diagnostics.ts` — if any changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug (misleading generated SQL / missing diagnostic)
- **Planned at**: commit `f27746f`, 2026-06-15

## Why this matters

When a column's type changes, supaschema renders:

```sql
ALTER TABLE <t> ALTER COLUMN <c> TYPE <newtype> USING <c>::<newtype>;
```

The `USING <c>::<newtype>` is an **identity cast** — it casts the existing value directly to the new type. PostgreSQL rejects this for most non-trivial conversions where no implicit/assignment cast exists (`text → uuid`, `integer → jsonb`, narrowing `varchar(10) → varchar(5)` with longer data, etc.). The operator gets here only after explicitly adding a `hints.destructive` entry (the change is gated by `SUPA_PLAN_COLUMN_ALTER_HINT_REQUIRED`), so they reasonably trust the rendered SQL — but `check` is static and won't catch the cast failure, and `verify` is optional. The result is an apply-time error on SQL the tool generated and the operator approved. This plan does **not** try to synthesize a correct cast (impossible in general) — it makes the placeholder cast **visible**: a plan-time advisory diagnostic plus an inline SQL comment telling the operator to supply a real `USING` expression when needed.

## Current state

`src/render.ts:164-191` — `renderColumnAlteration` emits the identity cast:

```ts
const prefix = `ALTER TABLE ${qualifiedRef(table.ref)} ALTER COLUMN ${quoteIdent(name)}`;
const statements: string[] = [];
if (typeof record.type === "string") {
  statements.push(
    `${prefix} TYPE ${record.type} USING ${quoteIdent(name)}::${record.type};`
  ); // line 176 — identity cast
}
// ...dropDefault / setDefault / setNotNull / dropNotNull...
```

`src/planner-table.ts:80-96` — the destructive gate that fires when a type change is present (but says nothing about the `USING` placeholder once hinted):

```ts
const destructive =
  delta.dropColumns.length > 0 ||
  delta.alterColumns.some((alteration) => alteration.type !== undefined); // line 82
if (destructive && !isDestructiveAllowed(after.key, config)) {
  blocked = true;
  diagnostics.push(
    diagnostic(
      "SUPA_PLAN_COLUMN_ALTER_HINT_REQUIRED",
      "error",
      "column drops and type changes require an explicit destructive-change hint",
      {
        hint: `Add "${after.key}" to hints.destructive after reviewing the rendered column ALTERs.`,
        ref: after.ref,
      }
    )
  );
}
```

Facts:

- Whether or not the key is hinted, a **type change** (`alteration.type !== undefined`) is exactly the condition that produces the identity-cast SQL. The advisory should fire whenever a type change is present, independent of the hint (the operator needs to see it before _and_ after hinting).
- The advisory is a `warning` (non-blocking) — it must not turn into a second blocker; the existing `SUPA_PLAN_COLUMN_ALTER_HINT_REQUIRED` already gates the apply.
- `diagnostic(code, severity, message, extras)` is the factory (`src/diagnostics.ts:11`); add the new code's summary to `diagnosticCatalog` (same file, the `Record<string,string>` starting at line 106).
- Render comments: the file emits SQL strings; a leading `-- ` comment line above the statement is the natural carrier. Check how `render.ts` composes multi-line output (it joins statements with `\n`) so the comment attaches to the right statement.

Repo conventions:

- Diagnostics go through the `diagnostic()` factory and are catalogued in `diagnosticCatalog` (used by `supaschema explain <CODE>`).
- Generated SQL is rendered deterministically; a static comment line is fine and must be stable (no timestamps/random).
- NodeNext `.js` imports; `npm run format` to apply fixes.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Typecheck | `npm run typecheck` | exit 0 |
| Targeted tests | `npx vitest run tests/column-alter.test.ts tests/render-guards.test.ts tests/plan-guards.test.ts` | all pass |
| Full tests | `npm test` | all pass |
| Lint | `npm run lint` | exit 0 |
| Apply fixes | `npm run format` | writes fixes |
| Build | `npm run build` | exit 0 |

## Scope

**In scope**:

- `src/planner-table.ts` (emit the advisory diagnostic when a type change is present)
- `src/render.ts` (inline comment above the `ALTER COLUMN ... TYPE ... USING` statement)
- `src/diagnostics.ts` (add the new diagnostic code to `diagnosticCatalog`)
- `tests/column-alter.test.ts` and/or `tests/render-guards.test.ts` (assert the diagnostic + comment)

**Out of scope** (do NOT touch):

- The destructive-hint gate `SUPA_PLAN_COLUMN_ALTER_HINT_REQUIRED` — leave its blocking behavior alone.
- Any attempt to compute a "smart" `USING` expression — out of scope by design; the cast stays an identity cast, just documented.
- Column drop / default / not-null rendering — only the `TYPE ... USING` line gets the comment.

## Git workflow

- Branch: `advisor/006-column-type-using-warning` off the default branch.
- Commit style: conventional commits (e.g. `fix(plan): warn that ALTER COLUMN TYPE renders a placeholder USING cast`).
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add the diagnostic code to the catalog

In `src/diagnostics.ts`, add to `diagnosticCatalog` (keep the keys grouped/sorted as the surrounding entries are):

```ts
SUPA_PLAN_COLUMN_TYPE_USING_REVIEW:
  "A column type change renders an identity USING cast; PostgreSQL rejects it unless an assignment cast exists. Review and replace the USING expression for non-trivial conversions.",
```

**Verify**: `npm run typecheck` → exit 0.

### Step 2: Emit the advisory when a type change is present

In `src/planner-table.ts`, where the column delta is assembled (near lines 80-96), push a **non-blocking** `warning` diagnostic whenever any alteration carries a `type` change — regardless of the hint state. Do not set `blocked` for it. For example, after computing `delta.alterColumns`:

```ts
const hasTypeChange = delta.alterColumns.some(
  (alteration) => alteration.type !== undefined
);
if (hasTypeChange) {
  diagnostics.push(
    diagnostic(
      "SUPA_PLAN_COLUMN_TYPE_USING_REVIEW",
      "warning",
      "column type change renders an identity USING cast; replace the USING expression for non-assignment-cast conversions",
      {
        hint: "PostgreSQL rejects ALTER COLUMN TYPE ... USING col::newtype when no assignment cast exists; edit the rendered USING expression after review.",
        ref: after.ref,
      }
    )
  );
}
```

Keep this separate from the `destructive`/`blocked` logic so it is purely advisory.

**Verify**: `npm run typecheck` → exit 0.

### Step 3: Add an inline SQL comment above the rendered cast

In `src/render.ts` `renderColumnAlteration`, when emitting the `TYPE ... USING` statement (line 176), prepend a stable comment so the migration file itself flags the placeholder:

```ts
if (typeof record.type === "string") {
  statements.push(
    `-- review: USING is an identity cast (${quoteIdent(name)}::${record.type}); replace it for non-assignment-cast conversions`
  );
  statements.push(
    `${prefix} TYPE ${record.type} USING ${quoteIdent(name)}::${record.type};`
  );
}
```

Confirm the surrounding code joins `statements` with `\n` (it does — `renderColumnAlteration` returns `string[]` that the caller joins), so the comment lands on its own line directly above the statement. Keep the comment deterministic (no timestamps).

**Verify**: `npm run typecheck` → exit 0.

### Step 4: Format and run; update any rendered-SQL snapshots intentionally

`npm run format`. This change **does** alter rendered output for type-change migrations (it adds a comment line), so snapshot/fixture tests that render a column-type ALTER will need their expected output updated — but only for that added comment line. Update them deliberately and confirm the diff is exactly the new comment line, nothing else.

**Verify**:

- `npm run lint` → exit 0
- `npx vitest run tests/column-alter.test.ts tests/render-guards.test.ts tests/plan-guards.test.ts` → all pass (with intentional snapshot updates limited to the new comment line)
- `npm test` → all pass
- `npm run build` → exit 0

## Test plan

- In `tests/column-alter.test.ts` (or `tests/render-guards.test.ts`, matching the existing render-assertion style):
  - **Type change present** → the plan's diagnostics include `SUPA_PLAN_COLUMN_TYPE_USING_REVIEW` (severity `warning`, not `error`), and the rendered SQL contains both the `-- review: USING is an identity cast` comment and the `ALTER ... TYPE ... USING ...::...` statement.
  - **No type change (e.g. only SET NOT NULL / DROP DEFAULT)** → no `SUPA_PLAN_COLUMN_TYPE_USING_REVIEW` diagnostic and no comment line (proves the advisory is scoped to type changes).
  - **Diagnostic is non-blocking** → the operation is not `blocked` _because of_ this advisory (it may still be blocked by the pre-existing destructive-hint gate when unhinted — assert the advisory itself does not set `blocked`).
- Verification: `npx vitest run tests/column-alter.test.ts` → all pass including the new assertions.

## Done criteria

ALL must hold:

- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0, with any snapshot updates limited to the added comment line
- [ ] `supaschema explain SUPA_PLAN_COLUMN_TYPE_USING_REVIEW` resolves (i.e. the code is in `diagnosticCatalog`) — verify with `node dist/cli.js explain SUPA_PLAN_COLUMN_TYPE_USING_REVIEW` after `npm run build`
- [ ] `npm run lint` exits 0
- [ ] `npm run build` exits 0
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `advisor-plans/README.md` status row updated

## STOP conditions

Stop and report if:

- Adding the comment line breaks `check` round-trip/fidelity tests in a way that is not just "expected output now has a comment line" — comments are non-semantic SQL and should pass the deparser/round-trip checks, but if `deparseFidelityDiagnostics` or a normalization test treats the comment as a statement, report it (the comment may need to be attached differently, e.g. only in the human-facing render path, not the canonical one).
- The advisory diagnostic causes a previously-passing migration to be reported with new `error`-severity output (it must be `warning` only) — if `hasErrors` now trips on it, you used the wrong severity; fix and report.

## Maintenance notes

- This deliberately keeps the identity cast as-is; the value is _visibility_, not auto-correctness. If a future "rename hint"-style mechanism is added for custom cast expressions, that supersedes the comment — note the linkage.
- Reviewer should confirm the comment is deterministic and that the diagnostic is `warning` severity (non-blocking), so it never changes exit codes on its own.
- If rendered-SQL fixtures are regenerated by a script, ensure the script's expected output includes the new comment line so it does not flap.
