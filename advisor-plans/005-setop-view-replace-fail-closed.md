# Plan 005: Fail closed when a set-operation view replace cannot be proven column-compatible

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `advisor-plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat f27746f..HEAD -- src/planner-replace.ts src/sql/facts.ts` — if either changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: MED
- **Depends on**: none
- **Category**: bug (fail-open vs the fail-closed policy)
- **Planned at**: commit `f27746f`, 2026-06-15

## Why this matters

When a view is replaced, supaschema decides whether `CREATE OR REPLACE VIEW` is safe by comparing the before/after **output column lists** — PostgreSQL only allows replacing a view if the new column list is a prefix-compatible superset (you may append columns, never drop/rename/reorder). For **set-operation views** (`UNION` / `INTERSECT` / `EXCEPT`) **without an explicit column alias list**, `viewTargetColumns` returns `undefined`, so the view object carries no `viewColumns`. `refineViewReplace` then early-returns the operation **unchanged**, leaving only a non-blocking `SUPA_PLAN_VIEW_REPLACE_VERIFY_REQUIRED` advisory. So an incompatible column change on such a view renders `CREATE OR REPLACE VIEW`, which PostgreSQL rejects at apply time — a fail-open path that contradicts supaschema's "unsupported/unprovable DDL fails closed with a diagnostic" invariant, and is inconsistent with how the same incompatibility is **blocked** for ordinary views.

## Current state

`src/planner-replace.ts:29-52` — `refineViewReplace`:

```ts
function refineViewReplace(
  operation: MigrationOperation,
  config: SupaschemaConfig
): MigrationOperation {
  const before = viewColumns(operation.before);
  const after = viewColumns(operation.after);
  if (!(before && after)) {
    return operation; // <-- set-op views land here: no column-compat check, stays a non-blocking advisory
  }
  operation.diagnostics = operation.diagnostics.filter(
    (item) => item.code !== "SUPA_PLAN_VIEW_REPLACE_VERIFY_REQUIRED"
  );
  const prefixCompatible =
    after.length >= before.length &&
    before.every((column, index) => after[index] === column);
  if (prefixCompatible) {
    return operation;
  }
  return markDropRequired(operation, config, "viewDropRequired", {
    code: "SUPA_PLAN_VIEW_REPLACE_INCOMPATIBLE",
    hint: `Add "${operation.key}" to hints.destructive to render a guarded DROP VIEW + CREATE after review.`,
    message:
      "view replacement drops, renames, or reorders output columns; CREATE OR REPLACE VIEW cannot apply it",
  });
}
```

`markDropRequired` (lines 71-89) sets `destructive = true`, and if the key is not in `hints.destructive` it sets `blocked = true` and pushes the error diagnostic. So ordinary incompatible views are **blocked** until the operator reviews and hints; set-op views skip this entirely.

Why `viewColumns` is `undefined` for set-op views — `src/sql/facts.ts:406-444`:

```ts
function viewFacts(node: AstNode): Record<string, unknown> {
  const aliases = stringList(node.aliases); // explicit CREATE VIEW v(a,b) AS ...
  const columns = aliases.length > 0 ? aliases : viewTargetColumns(node.query);
  if (columns !== undefined) {
    facts.viewColumns = columns;
  }
  // ...
}
function viewTargetColumns(query: unknown): string[] | undefined {
  const select = asRecord(asRecord(query)?.SelectStmt);
  if (!select || asRecord(select.larg) || asRecord(select.rarg)) {
    return; // <-- larg/rarg => UNION/INTERSECT/EXCEPT => undefined
  }
  // ...derive column names from the single-select target list...
}
```

So a set-op view **with** an explicit alias list (`CREATE VIEW v(a, b) AS SELECT ... UNION ...`) does get `viewColumns` (from `aliases`) and is already handled correctly. Only the **aliasless** set-op view is unprovable.

The relevant diagnostic codes already exist in `src/diagnostics.ts`:

- `SUPA_PLAN_VIEW_REPLACE_INCOMPATIBLE` (blocking) and `SUPA_PLAN_VIEW_REPLACE_VERIFY_REQUIRED` (advisory).

Tradeoff to honor (state it in the PR): failing closed means editing the body of an aliasless `UNION` view now requires a `hints.destructive` entry (or the operator adding an explicit column alias list to the view, which makes it provable). That is the intended cost of the fail-closed policy and matches ordinary views; the escape hatch is the destructive hint, exactly as for incompatible ordinary views.

Repo conventions:

- Fail closed for unprovable DDL; emit a diagnostic with an actionable hint.
- Reuse `markDropRequired` / existing diagnostic codes; don't invent a parallel mechanism.
- NodeNext `.js` imports; `npm run format` to apply fixes.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Typecheck | `npm run typecheck` | exit 0 |
| Targeted tests | `npx vitest run tests/replace-safety.test.ts tests/replace-dependents.test.ts tests/plan-guards.test.ts` | all pass |
| Full tests | `npm test` | all pass |
| Lint | `npm run lint` | exit 0 |
| Apply fixes | `npm run format` | writes fixes |
| Build | `npm run build` | exit 0 |

## Scope

**In scope**:

- `src/planner-replace.ts`
- `tests/replace-safety.test.ts` (add set-op view cases)
- `src/diagnostics.ts` — only if you add a new `SUPA_PLAN_VIEW_REPLACE_UNVERIFIABLE` code (optional; reusing `SUPA_PLAN_VIEW_REPLACE_INCOMPATIBLE` is acceptable and simpler)

**Out of scope** (do NOT touch):

- `src/sql/facts.ts` `viewTargetColumns` — leaving set-op views as `undefined` columns is correct; the fix is in how the planner _reacts_ to undefined columns, not in trying to compute columns for set-op views.
- `markDropRequired` — reuse as-is.
- Ordinary (single-select) view handling — unchanged.

## Git workflow

- Branch: `advisor/005-setop-view-fail-closed` off the default branch.
- Commit style: conventional commits (e.g. `fix(planner): fail closed on unverifiable set-operation view replace`).
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Replace the silent early-return with a fail-closed branch

In `refineViewReplace`, when the column lists cannot both be determined (the `!(before && after)` case), do not return unchanged. Instead require review via `markDropRequired`, mirroring the incompatible-ordinary-view path. Distinguish the message so it is clear _why_ (columns could not be verified, not that they are known-incompatible):

```ts
if (!(before && after)) {
  return markDropRequired(operation, config, "viewDropRequired", {
    code: "SUPA_PLAN_VIEW_REPLACE_INCOMPATIBLE", // or a new SUPA_PLAN_VIEW_REPLACE_UNVERIFIABLE
    hint: `This view's output columns cannot be verified (set-operation view without an explicit column list). Add an explicit column alias list to the view, or add "${operation.key}" to hints.destructive to render a guarded DROP VIEW + CREATE after review.`,
    message:
      "view replacement cannot be proven column-compatible; CREATE OR REPLACE VIEW may be rejected by PostgreSQL",
  });
}
```

If you prefer a distinct code, add `SUPA_PLAN_VIEW_REPLACE_UNVERIFIABLE` to the `diagnosticCatalog` in `src/diagnostics.ts` with a one-line summary. Otherwise reuse `SUPA_PLAN_VIEW_REPLACE_INCOMPATIBLE`.

Note: `markDropRequired` blocks **only** when the key is not already in `hints.destructive` — so an operator who has reviewed and hinted the view still gets a guarded `DROP VIEW + CREATE`. Confirm this is the desired escape hatch (it is, and it matches ordinary incompatible views).

**Verify**: `npm run typecheck` → exit 0.

### Step 2: Format and run

`npm run format`, then tests.

**Verify**:

- `npm run lint` → exit 0
- `npx vitest run tests/replace-safety.test.ts tests/replace-dependents.test.ts tests/plan-guards.test.ts` → all pass
- `npm test` → all pass
- `npm run build` → exit 0

## Test plan

Add cases to `tests/replace-safety.test.ts` (follow the existing view-replace test structure there):

- **Aliasless set-op view, body change, no hint** → operation is `blocked` with the chosen diagnostic code; the previous non-blocking `VERIFY_REQUIRED`-only behavior is gone. This is the regression fix.
- **Aliasless set-op view, body change, key present in `hints.destructive`** → not blocked; renders a guarded `DROP VIEW + CREATE` (asserts the escape hatch works).
- **Set-op view _with_ an explicit column alias list, compatible change** → unchanged (still resolves via `viewColumns` from `aliases`, no false block) — proves the fix is scoped to the unverifiable case only.
- **Ordinary single-select view** → unchanged behavior (no regression).
- Verification: `npx vitest run tests/replace-safety.test.ts` → all pass including the new cases.

## Done criteria

ALL must hold:

- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0
- [ ] A test asserts an aliasless set-op view replace with a changed body is **blocked** without a hint and **rendered as guarded DROP+CREATE** with a hint
- [ ] `npm run lint` exits 0
- [ ] `npm run build` exits 0
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `advisor-plans/README.md` status row updated

## STOP conditions

Stop and report if:

- Existing replace-safety/cross-lane tests show many PostgreSQL-valid set-op view edits suddenly blocking — that would mean the fix is too broad (it should only fire when `viewColumns` is genuinely undetermined). If a common valid edit now requires a hint, reconsider scope and report.
- A set-op view that already has an explicit alias list starts hitting the new branch (it should resolve via `aliases` in `facts.ts` and never reach `!(before && after)`). If it does, the alias path is broken upstream — report rather than work around it.

## Maintenance notes

- This makes set-op view replacement consistent with ordinary view replacement: unprovable → blocked-with-hint, not silent advisory.
- Reviewer should weigh the UX cost (aliasless `UNION` view edits now need a hint or an explicit column list) against the correctness gain (no apply-time `CREATE OR REPLACE VIEW` rejection) and confirm the team accepts it. The mitigation worth documenting: adding an explicit column alias list to such views makes them provable and removes the friction.
- If a future change teaches `viewTargetColumns` to derive columns from one arm of a set-operation, this branch will simply stop firing for those — no further change needed.
