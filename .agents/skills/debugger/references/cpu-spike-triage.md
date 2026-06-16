# CPU Spike Triage

When a Node process is burning CPU (not hanging — actively busy: a runaway Vitest run, a tight loop in the SQL planner/parser, a `tsc` that won't finish, the CLI pinned on a large input), the first diagnostic is a **per-thread CPU breakdown** to distinguish main-thread V8 saturation from libuv/worker work. The recovery path differs between them.

## Required first step: `ps -M <pid>`

```bash
ps -M <pid> | head -20
```

Read the `%CPU` column per thread:

| Pattern | Signature | Class |
| --- | --- | --- |
| **One thread at 90–100%, others idle (0–5%)** | Single Node main thread saturated | V8 JavaScript work: infinite loop, runaway recursion, tight synchronous reduction, oversized serialization |
| **A libuv worker pegged while V8 threads idle** | Sync filesystem / native add-on work off the main thread | e.g. `libpg-query` parsing a huge SQL file, heavy sync `fs` in a hot path |
| **Even load across all threads** | No single hot class | capture `sample` and read the dominant call chain before guessing |

**Do not skip this step.** It is the only signal that distinguishes V8-main-thread saturation from native/libuv work, and `sample <pid>` defaults to the main thread — it can miss worker-side saturation entirely.

## V8 main-thread saturation

If `ps -M` shows **one Node main thread at 90–100% while helper threads idle**, the problem is inside V8 JavaScript. Capture the stack:

```bash
sample <pid> 3 2>/dev/null | sed -n '/^Call graph:/,/^Binary Images:/p' | head -60
```

Common causes in this repo:

- **Non-terminating AST/model walk** — a recursive parser/planner/typegen walk that doesn't terminate on an unexpected `libpg-query` node shape. The dominant frames will be your own `src/sql/*` or `src/planner`/`src/typegen` functions. Fix the base/terminating case for that node kind.
- **Tight synchronous reduction** — building a large string/array in a hot loop (e.g. rendering a huge migration or catalog). Look for an O(n²) concat/`.includes` in the sample frames.

### Inspector stringification loop (when running under `--inspect`)

**Symptom:** sustained ~90–110% single-thread CPU for minutes, RSS stable, output went silent. The process is running under a debugger/inspector (`node --inspect`, an attached IDE/MCP debugger).

**Cause:** a rejected promise or thrown error carries a very large payload (a full SQL error body, an oversized Zod validation error, a serialized model tree). With an inspector attached, V8 tries to stringify the error for the console transport on every tick and never finishes.

**Recovery:** detach the inspector (run the failing command plainly, without `--inspect`) and re-capture the real error — it will now surface. Then fix at the throw site by catching at the boundary and re-throwing a trimmed error that excludes the giant payload (this is also the right product fix: `SUPA_*` diagnostics must be actionable and redact secrets, not dump raw payloads).

## Neither pattern

If `ps -M` shows something else (a libuv worker pegged, or evenly distributed load), capture `sample` and read the dominant call chain — sync filesystem work in a hot path, a compute-heavy command over a large fixture/corpus, or a native add-on (`libpg-query`) processing oversized input. Do not guess; read the frames.

## Do not

- **Do not kill before capturing diagnostics** when you can still get a `sample` or detach an inspector — the dominant call chain or the real error payload is the actionable signal; killing discards it.
- **Do not assume the cache or build is at fault** for a V8 main-thread loop — that wastes work without addressing the loop. Fix the frame the `sample` names.
