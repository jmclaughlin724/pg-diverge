# Plan 007: Distinguish "Supabase CLI not installed" from a real runner failure in `sync`

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report — do not improvise. When done, update the status row for this plan in `advisor-plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat f27746f..HEAD -- src/sync.ts src/diagnostics.ts` — if either changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug / dx (misleading diagnostic)
- **Planned at**: commit `f27746f`, 2026-06-15

## Why this matters

`supaschema sync --local|--remote` shells out to the Supabase CLI. If the `supabase` binary is **not installed**, `spawn` emits an `error` event (ENOENT), which the code maps to exit code `127` and then reports as the generic `SUPA_SYNC_RUNNER_FAILED` — `` `supabase migration up` exited with code 127 `` — with a hint that says "inspect its output above," even though there is no output and the real problem is "the Supabase CLI is not installed / not on PATH." An operator hitting this gets a confusing message that sends them looking at runner logs that don't exist. Distinguishing the spawn failure (binary missing) from a genuine nonzero exit (runner ran and failed) turns a dead-end into an actionable message.

## Current state

`src/sync.ts:106-144` — the apply loop and the `run` helper:

```ts
for (const [command, ...args] of planned) {
  lines.push(`running: ${command} ${args.join(" ")}`);
  const exitCode = await run(command ?? "", args); // line 108
  if (exitCode !== 0) {
    diagnostics.push(
      diagnostic(
        "SUPA_SYNC_RUNNER_FAILED",
        "error",
        `\`${command} ${args.join(" ")}\` exited with code ${exitCode}`,
        {
          hint: "The migration runner owns apply/deploy; inspect its output above.",
        }
      )
    );
    return {
      applied: false,
      diagnostics,
      pending: status.report.pending,
      report: render(lines),
    };
  }
}
// ...
function run(command: string, args: string[]): Promise<number> {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, {
      shell: process.platform === "win32",
      stdio: "inherit",
    });
    child.on("error", () => resolvePromise(127)); // line 141  <-- ENOENT (missing binary) collapses to 127
    child.on("close", (code) => resolvePromise(code ?? 1));
  });
}
```

Facts:

- The `error` event fires for spawn failures, the most common being **ENOENT** (binary not found). Today it is indistinguishable from a runner that ran and exited 127.
- `127` is also a legitimate shell exit code, so keying off "code === 127" is not a reliable signal; the reliable signal is _which event fired_ (`error` vs `close`).
- The diagnostic factory is `diagnostic(code, severity, message, extras)` (`src/diagnostics.ts:11`); add any new code to `diagnosticCatalog` (same file, the `Record<string,string>` at line 106). An existing related code is `SUPA_SYNC_RUNNER_FAILED`.
- `stdio: "inherit"` means the child's own errors print to the user's terminal directly; supaschema only sees the exit/error signal.

Repo conventions:

- Diagnostics via the `diagnostic()` factory + catalogued in `diagnosticCatalog` for `supaschema explain`.
- `sync` gates and delegates; it must keep delegating apply to the Supabase CLI — this plan only improves the **diagnostic** when the CLI can't be launched.
- NodeNext `.js` imports; `npm run format` to apply fixes.

## Commands you will need

| Purpose        | Command                             | Expected on success |
| -------------- | ----------------------------------- | ------------------- |
| Typecheck      | `npm run typecheck`                 | exit 0              |
| Targeted tests | `npx vitest run tests/sync.test.ts` | all pass            |
| Full tests     | `npm test`                          | all pass            |
| Lint           | `npm run lint`                      | exit 0              |
| Apply fixes    | `npm run format`                    | writes fixes        |
| Build          | `npm run build`                     | exit 0              |

## Scope

**In scope**:

- `src/sync.ts`
- `src/diagnostics.ts` (add the new diagnostic code to `diagnosticCatalog`)
- `tests/sync.test.ts` (add a missing-binary case)

**Out of scope** (do NOT touch):

- The gate/dry-run/status logic in `syncMigrations` — only the runner-launch outcome handling changes.
- `stdio: "inherit"` and the `shell: win32` behavior — keep them (they are deliberately documented in the file).
- The actual apply delegation — supaschema still hands apply to the Supabase CLI.

## Git workflow

- Branch: `advisor/007-sync-missing-cli-diagnostic` off the default branch.
- Commit style: conventional commits (e.g. `fix(sync): report a clear diagnostic when the Supabase CLI is not installed`).
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Make `run` report _why_ it failed, not just a number

Change `run` to distinguish a spawn `error` (binary not launchable) from a real `close` exit code. Return a small result object instead of a bare number:

```ts
type RunOutcome =
  | { kind: "exit"; code: number }
  | { kind: "spawn-error"; error: Error };

function run(command: string, args: string[]): Promise<RunOutcome> {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, {
      shell: process.platform === "win32",
      stdio: "inherit",
    });
    child.on("error", (error) =>
      resolvePromise({ kind: "spawn-error", error })
    );
    child.on("close", (code) =>
      resolvePromise({ kind: "exit", code: code ?? 1 })
    );
  });
}
```

**Verify**: `npm run typecheck` → exit 0 (the call site won't compile yet — that's expected; fix it in Step 2).

### Step 2: Emit the right diagnostic at the call site

In the apply loop (lines ~106-125), branch on the outcome:

```ts
const outcome = await run(command ?? "", args);
if (outcome.kind === "spawn-error") {
  diagnostics.push(
    diagnostic(
      "SUPA_SYNC_RUNNER_UNAVAILABLE",
      "error",
      `could not launch \`${command}\`: the Supabase CLI is not installed or not on PATH`,
      {
        hint: "Install the Supabase CLI (https://supabase.com/docs/guides/local-development) and ensure `supabase` is on PATH, or run sync without --local/--remote for the dry-run gate only.",
      }
    )
  );
  return {
    applied: false,
    diagnostics,
    pending: status.report.pending,
    report: render(lines),
  };
}
if (outcome.code !== 0) {
  diagnostics.push(
    diagnostic(
      "SUPA_SYNC_RUNNER_FAILED",
      "error",
      `\`${command} ${args.join(" ")}\` exited with code ${outcome.code}`,
      {
        hint: "The migration runner owns apply/deploy; inspect its output above.",
      }
    )
  );
  return {
    applied: false,
    diagnostics,
    pending: status.report.pending,
    report: render(lines),
  };
}
```

Distinguish only ENOENT-style launch failures via the `spawn-error` branch; keep all genuine nonzero exits on `SUPA_SYNC_RUNNER_FAILED` so existing behavior for a runner that _ran and failed_ is unchanged. (You may inspect `outcome.error` for `code === "ENOENT"` if you want to keep non-ENOENT spawn errors on the generic path, but ENOENT is by far the dominant case; a single `spawn-error` branch is acceptable and simpler.)

**Verify**: `npm run typecheck` → exit 0.

### Step 3: Catalog the new code

In `src/diagnostics.ts`, add to `diagnosticCatalog`:

```ts
SUPA_SYNC_RUNNER_UNAVAILABLE:
  "The migration runner (Supabase CLI) could not be launched; it is not installed or not on PATH. supaschema gates and delegates apply to the runner.",
```

**Verify**: `npm run typecheck` → exit 0.

### Step 4: Format and run

`npm run format`, then tests.

**Verify**:

- `npm run lint` → exit 0
- `npx vitest run tests/sync.test.ts` → all pass
- `npm test` → all pass
- `npm run build` → exit 0
- `node dist/cli.js explain SUPA_SYNC_RUNNER_UNAVAILABLE` → prints the catalog summary

## Test plan

- In `tests/sync.test.ts` (follow the existing sync-test structure; it already exercises the gate/dry-run paths):
  - **Missing binary** → drive `syncMigrations` with `--local` against a pending migration where the spawned command does not exist, and assert a `SUPA_SYNC_RUNNER_UNAVAILABLE` diagnostic (not `SUPA_SYNC_RUNNER_FAILED`). The cleanest way to force the spawn-error without depending on the real `supabase` binary: check how `tests/sync.test.ts` currently avoids invoking the real CLI (it must, since CI has no Supabase CLI in the no-DB lanes). If the test seam injects the planned command or a `run` function, use a non-existent command name there; if not, and `run` cannot be reached without spawning, prefer a unit test of the outcome-branching logic by extracting the diagnostic-selection into a tiny pure helper you can call directly. **Do not** add a real `supabase` dependency to tests.
  - **Genuine nonzero exit** → unchanged: still `SUPA_SYNC_RUNNER_FAILED` (assert the generic path is preserved).
- Verification: `npx vitest run tests/sync.test.ts` → all pass including the new case.

## Done criteria

ALL must hold:

- [ ] `npm run typecheck` exits 0
- [ ] `npm test` exits 0, with a test asserting the missing-CLI path yields `SUPA_SYNC_RUNNER_UNAVAILABLE`
- [ ] `npm run lint` exits 0
- [ ] `npm run build` exits 0
- [ ] `node dist/cli.js explain SUPA_SYNC_RUNNER_UNAVAILABLE` prints the summary
- [ ] A genuine nonzero runner exit still produces `SUPA_SYNC_RUNNER_FAILED` (unchanged)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `advisor-plans/README.md` status row updated

## STOP conditions

Stop and report if:

- `tests/sync.test.ts` has no seam to exercise `run`/the apply loop without invoking a real binary, and extracting a pure diagnostic-selection helper would require restructuring `syncMigrations` substantially — report the structure; a minimal helper extraction is acceptable, a large refactor is not.
- Distinguishing `spawn-error` from `exit` changes the dry-run / disabled / gate paths in any way (it must not — those return before `run` is ever called).

## Maintenance notes

- Keep the two failure classes distinct going forward: **launch failure** (binary missing) → `SUPA_SYNC_RUNNER_UNAVAILABLE`; **ran and failed** → `SUPA_SYNC_RUNNER_FAILED`. New runners (if ever added) should follow the same split.
- Reviewer should confirm the generic `SUPA_SYNC_RUNNER_FAILED` path is byte-for-byte unchanged for real nonzero exits, and that `stdio: "inherit"` / `shell: win32` are preserved.
- The hint references the Supabase local-development docs URL; if that URL moves, update it here and in any docs that mirror it.
