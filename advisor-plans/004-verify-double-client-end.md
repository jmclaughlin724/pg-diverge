# Plan 004: Remove the double `Client.end()` that can hang `verify` on a capability-preflight failure

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `advisor-plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat f27746f..HEAD -- src/verify.ts` — if it changed since this plan was written, compare the "Current state" excerpt against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug (resource handling / potential hang)
- **Planned at**: commit `f27746f`, 2026-06-15

## Why this matters

`verifyMigration` opens a `pg` admin `Client` and, when the role fails the capability preflight (e.g. it cannot `CREATE DATABASE` — a common real configuration, surfaced as `SUPA_VERIFY_ROLE_CAPABILITY`), it calls `admin.end()` and `return`s from inside the `try`. But the `finally` block then runs and calls `admin.end()` **again**. node-postgres issue [#2716](https://github.com/brianc/node-postgres/issues/2716) documents that a second `Client.end()` does not reset state and its promise can never resolve — so the second `await admin.end()` can **hang**. The existing `.catch(() => undefined)` only handles a rejection, not a never-resolving promise. The result: on the exact failure path meant to report a helpful diagnostic, `verify` can hang instead of exiting. Removing the redundant first `end()` lets the single `finally` own the connection lifecycle.

## Current state

`src/verify.ts:49-82` — the admin client lifecycle:

```ts
const admin = new Client({ connectionString: options.databaseUrl });
const migrationDb = tempDatabaseName("migration");
const targetDb = tempDatabaseName("target");
const created: string[] = [];
const environmentEnsured = options.ensureEnvironment ?? false;
try {
  if (await connectVerificationAdmin(admin, diagnostics)) {
    await admin.end().catch(() => undefined); // line 56  <-- redundant first end()
    return diagnostics; // line 57  <-- finally still runs
  }
  await createVerificationDatabases(admin, [migrationDb, targetDb], created);
  // ...apply + compare...
} catch (error) {
  diagnostics.push(
    ...verifyFailureDiagnostics(error, environmentEnsured, config)
  );
} finally {
  await cleanupTempDatabases(
    admin,
    created,
    options.keepDatabases === true,
    diagnostics
  );
  await admin.end().catch(() => undefined); // line 79  <-- the single owner of end()
}
return diagnostics;
```

`connectVerificationAdmin` (lines 106-117) connects the admin and returns `true` when the preflight produced a capability diagnostic (i.e. preflight **failed**):

```ts
async function connectVerificationAdmin(
  admin: Client,
  diagnostics: Diagnostic[]
): Promise<boolean> {
  await admin.connect();
  const capability = await preflightCapability(admin);
  if (capability === undefined) {
    return false; // preflight OK -> proceed
  }
  diagnostics.push(capability);
  return true; // preflight FAILED -> caller returns early
}
```

So on the failure path: `end()` at line 56, then `return` at line 57 triggers the `finally`, which runs `cleanupTempDatabases(admin, created=[], ...)` (no databases were created, so this is a no-op over an empty `created`) and then `admin.end()` **again** at line 79 — the double-end.

Facts:

- `created` is empty on this path (databases are only created after the preflight passes), so `cleanupTempDatabases` does no per-database work here. Confirm by reading `cleanupTempDatabases` — it should early-return or loop zero times on an empty list. If it unconditionally issues admin queries on an empty list, note it but it is not this plan's target.
- The single `finally` `end()` at line 79 already correctly closes the connection on **every** path (success, caught error, and the early return). The line-56 `end()` is therefore pure redundancy that introduces the double-end.

Repo conventions:

- `pg` `Client` lifecycle elsewhere in the repo uses `try/finally` with a single `await client.end().catch(() => undefined)` (see `src/db-admin.ts:133-160` for the canonical pattern). Match it — one `end()` per client, in `finally`.
- NodeNext `.js` imports; `npm run format` to apply fixes.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Typecheck | `npm run typecheck` | exit 0 |
| Targeted tests | `npx vitest run tests/verify-roles-split.test.ts` | all pass (DB-gated cases skip without a database — that is expected) |
| Full tests | `npm test` | all pass |
| Lint | `npm run lint` | exit 0 |
| Apply fixes | `npm run format` | writes fixes |
| Build | `npm run build` | exit 0 |

## Scope

**In scope**:

- `src/verify.ts`
- `tests/verify-roles-split.test.ts` (extend if a non-DB unit test is feasible — see Test plan)

**Out of scope** (do NOT touch):

- `connectVerificationAdmin`, `preflightCapability`, `cleanupTempDatabases`, `createVerificationDatabases` — their logic is correct; only the redundant `end()` call site changes.
- The diagnostics emitted (`SUPA_VERIFY_ROLE_CAPABILITY` etc.) — unchanged.

## Git workflow

- Branch: `advisor/004-verify-double-end` off the default branch.
- Commit style: conventional commits (e.g. `fix(verify): drop redundant admin.end() that can hang on preflight failure`).
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Delete the premature `end()` on the early-return path

In `src/verify.ts`, change lines 55-58 so the early return does **not** end the client itself; let the `finally` own it:

```ts
if (await connectVerificationAdmin(admin, diagnostics)) {
  return diagnostics; // finally closes admin exactly once
}
```

(Delete the `await admin.end().catch(() => undefined);` at line 56 only. Leave the `finally` `end()` at line 79 as the single owner.)

**Verify**: `npm run typecheck` → exit 0.

### Step 2: Format and run

`npm run format`, then the suite.

**Verify**:

- `npm run lint` → exit 0
- `npx vitest run tests/verify-roles-split.test.ts` → all pass (DB-gated cases skip cleanly)
- `npm test` → all pass
- `npm run build` → exit 0

## Test plan

The failure path requires a database whose role lacks `CREATEDB`, which is awkward to provision in unit tests. Two acceptable approaches, in order of preference:

1. **No new test if infeasible without a database** — this is a one-line deletion of a redundant call on a clearly-reasoned path; the existing DB-gated `tests/verify-roles-split.test.ts` plus the unchanged success path provide coverage. State in the PR that the fix is a redundant-call removal validated by reasoning + the node-postgres #2716 reference. This is acceptable given the risk profile.
2. **If a fake admin client is feasible**: if `verifyMigration` can be exercised with an injected/fake `Client` (check whether `verify.ts` allows dependency injection of the client — it currently constructs `new Client(...)` directly, so it likely cannot without a refactor). Do **not** refactor `verify.ts` to add injection just for this test — that expands scope and risk. Skip approach 2 unless injection already exists.

- Verification: `npx vitest run tests/verify-roles-split.test.ts` → all pass.

## Done criteria

ALL must hold:

- [x] `npm run typecheck` exits 0
- [x] `npm test` exits 0
- [x] `grep -n "admin.end()" src/verify.ts` shows exactly **one** occurrence (in the `finally` block)
- [x] `npm run lint` exits 0
- [x] `npm run build` exits 0
- [x] No files outside the in-scope list are modified (`git status`)
- [x] `advisor-plans/README.md` status row updated

## STOP conditions

Stop and report if:

- Reading `cleanupTempDatabases` shows it issues admin queries even when `created` is empty in a way that would now run against a still-open connection and change behavior — report it (it should be a no-op on an empty list, which is the intended path).
- The success path or any other path relied on the line-56 `end()` for correctness (it should not — the `finally` already closes the client on every path). If removing it changes any non-failure behavior, stop and report.

## Maintenance notes

- The invariant to preserve going forward: **one `Client` → one `end()`, in `finally`**. Any new early return inside the `try` must rely on the `finally`, never call `end()` itself.
- Reviewer should confirm the `finally` still runs on the early-return path (it does — `finally` runs on `return`) and that `end()` now appears exactly once.
- This matches the canonical `pg` lifecycle pattern already used in `src/db-admin.ts`.
