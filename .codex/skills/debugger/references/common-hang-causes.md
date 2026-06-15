# Common Hang and Stall Causes

Quick-reference checklist when the symptom is ambiguous (stuck, hung, no output, a command that never returns) and triage has not yet surfaced a concrete error.

## Silent code failures

- **Missing `await`**: an async function called without `await` — the promise fires but the caller never waits. No error is thrown; the function returns early or `undefined`.
- **Unresolved promises**: `new Promise()` that never calls `resolve()`/`reject()` — the caller hangs forever. Common in hand-rolled stream/child-process wrappers.
- **Infinite loops**: `while (true)` without a break, or recursion without a base case — frequent in parser/planner/AST walks over malformed input. If a `supaschema diff` or a Vitest case never returns, suspect a walk that doesn't terminate on an unexpected node shape.
- **Unawaited child process**: a `spawn`/`execFile` whose `close`/`exit` is never awaited, or whose stdout buffer fills and deadlocks (set a sufficient `maxBuffer`).

## Environment and configuration

- **Missing `SUPASCHEMA_DATABASE_URL`**: DB-gated work (`verify`, `corpus`, `selfcheck`, DB-gated Vitest) needs a reachable Postgres. Without it, those paths skip or fail; an unset URL reads as `undefined` and produces a confusing "no database" path rather than a clear error.
- **Wrong/stale build artifacts**: a stale `dist/` (e.g. after a relocated `tsBuildInfoFile` or a partial build) makes `bin/supaschema` import old code. Rebuild with `npm run build` before trusting a runtime symptom.
- **Python env drift**: the FastMCP service hangs or errors because `uv.lock` drifted or the venv is stale — run `uv sync` (`uv sync --locked` in CI fails on drift).

## Connection and resource exhaustion

- **Postgres connection pool exhaustion**: `supaschema verify`/`corpus` open catalog pools and temporary databases; unbounded test parallelism against one local Postgres (`max_connections`) makes connections hang. `vitest.config.ts` caps `maxWorkers` for exactly this reason — a hang under DB-gated tests usually means the cap was bypassed or connections were not released.
- **Temporary-database leak**: a `verify`/`corpus` run that dies mid-flight can leave temp databases behind, slowly exhausting connections on the next run. Check for orphaned temp DBs.

## Schema / migration

- **`SUPA_*` diagnostic, not a crash**: an apparent "stuck" diff is often a blocking diagnostic. Decode it: `supaschema explain <SUPA_CODE>`. `SUPA_DIFF_LINEAGE_BROKEN` → diff from the post-migration state; `SUPA_DIFF_OUTPUT_EXISTS` → a stale migration file must be deleted deliberately, not clobbered.
- **Hand-edited generated migration**: editing a `-- supaschema: lineage` file desyncs the lineage chain; the PreToolUse hook blocks it. Fix the declarative tree and regenerate.

## Process / no output

- **Hung Vitest worker**: a test that opens a resource it never closes (DB client, watcher) keeps the run alive. Run the single failing file (`npx vitest run <file>`) to isolate; reading a file before editing it avoids re-introducing the leak.
- **FastMCP stdio server idle**: Rule 11 owns the local `supaschema` MCP contract. Stdio silence is normal until a tool is called; probe it with `npm run fastmcp:status` / `fastmcp:inspect`.

## When you find no signal

If two consecutive triage steps produce no logs, no errors, and no obvious code issue:

1. **Add a log at every async boundary** in the suspected path — the absence of a log IS diagnostic (the code path isn't being reached).
2. **Confirm the command is even running** the code you think it is (right `dist/`, right script, right CWD).
3. **Ask the user** what they expected and when it last worked — the delta between "last working" and "now broken" is often the root cause.
