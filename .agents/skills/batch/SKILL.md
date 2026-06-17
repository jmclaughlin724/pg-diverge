---
name: batch
description: Research and plan a large-scale change, then execute it with bounded parallel workers editing on the current branch and current worktree. Use when the user wants to make a sweeping, mechanical change across many files (migrations, refactors, bulk renames) that can be decomposed into independent parallel units.
user-invocable: true
argument-hint: "<instruction>"
---

## Contract

Run the extracted Claude Code `/batch` procedure for large, parallelizable changes. Treat the skill argument as the batch instruction. This command is useful only in a git repository because workers edit the current branch in the current worktree and the main agent owns any requested git publication.

The source command referenced Claude Code planning, question, delegation, and skill-loading tools. Adapt those actions to the current runtime:

- Use the runtime's planning or task-tracking surface when one exists; otherwise write the plan directly in the transcript.
- Ask clarifying or approval questions through the runtime's native question path when one exists; otherwise use a concise message.
- Launch workers only through an available delegation tool. If the runtime has no worker delegation, stop after the approved plan and report that fan-out is unavailable.
- Run a code-review pass through an available skill invocation when one exists; otherwise do a focused manual review using the code-review instructions available in the session.

## Command Metadata

- Name: `batch`.
- Menu description: `Plan a large change; bounded workers edit on the current branch`.
- Description: `Research and plan a large-scale change, then execute it with bounded parallel workers editing on the current branch and current worktree.`
- When to use: `Use when the user wants to make a sweeping, mechanical change across many files (migrations, refactors, bulk renames) that can be decomposed into independent parallel units.`
- Argument hint: `<instruction>`.
- User invocable: `true`.
- Disable model invocation: `true`.
- Work-unit target range: `5–30`.

## Fallbacks

If no instruction is provided, respond:

```text
Provide an instruction describing the batch change you want to make.

Examples:
  /batch migrate from react to vue
  /batch replace all uses of lodash with native equivalents
  /batch add type annotations to all untyped function parameters
```

If the current directory is not a git repository, respond:

```text
This is not a git repository. The `/batch` command requires a git repo because workers edit the current branch in the current worktree and the main agent owns any requested git publication. Initialize a repo first, or run this from inside an existing one.
```

## Batch Prompt

Use this prompt body. Insert the skill argument verbatim under `## User Instruction`.

```markdown
# Batch: Parallel Work Orchestration

You are orchestrating a large, parallelizable change across this codebase.

## User Instruction

<insert the skill argument verbatim here>

## Phase 1: Research and Plan

Use the runtime's planning or task-tracking surface when one exists; otherwise write the plan directly in the transcript. Then:

1. **Understand the scope.** Launch one or more foreground subagents if the runtime has an available delegation tool; otherwise research directly. You need the results before planning. Find all the files, patterns, and call sites that need to change. Understand the existing conventions so the migration is consistent.

2. **Decompose into independent units.** Break the work into 5–30 self-contained units. Each unit must:
   - Be independently implementable on the current branch in the current worktree
   - Avoid depending on another unit landing first
   - Be roughly uniform in size (split large units, merge trivial ones)

   Scale the count to the actual work: few files → closer to 5; hundreds of files → closer to 30. Prefer per-directory or per-module slicing over arbitrary file lists.

3. **Determine the e2e test recipe.** Figure out how a worker can verify its change actually works end-to-end — not just that unit tests pass. Look for:
   - A `claude-in-chrome` skill or browser-automation tool (for UI changes: click through the affected flow, screenshot the result)
   - A `tmux` or CLI-verifier skill (for CLI changes: launch the app interactively, exercise the changed behavior)
   - A dev-server + curl pattern (for API changes: start the server, hit the affected endpoints)
   - An existing e2e/integration test suite the worker can run

   If you cannot find a concrete e2e path, ask the user how to verify this change end-to-end using the runtime's native question tool when one exists, or a concise message otherwise. Offer 2–3 specific options based on what you found (e.g., "Screenshot via chrome extension", "Run `bun run dev` and curl the endpoint", "No e2e — unit tests are sufficient"). Do not skip this — the workers cannot ask the user themselves.

   Write the recipe as a short, concrete set of steps that a worker can execute autonomously. Include any setup (start a dev server, build first) and the exact command/interaction to verify.

4. **Write the plan.** In your plan file, include:
   - A summary of what you found during research
   - A numbered list of work units — for each: a short title, the list of files/directories it covers, and a one-line description of the change
   - The e2e test recipe (or "skip e2e because …" if the user chose that)
   - The exact worker instructions you will give each agent (the shared template)

5. Present the plan for approval using the runtime's native approval path when one exists; otherwise present the plan in the transcript.

## Phase 2: Spawn Workers (After Plan Approval)

Once the plan is approved, spawn worker agents using the runtime's available delegation tool. If no delegation tool is available, stop and report that worker fan-out is unavailable. Workers must stay on the current branch in the current worktree; do not request worktree isolation, branch creation, or fan-out PRs. Respect the configured thread cap when running workers in parallel.

For each agent, the prompt must be fully self-contained. Include:

- The overall goal (the user's instruction)
- This unit's specific task (title, file list, change description — copied verbatim from your plan)
- Any codebase conventions you discovered that the worker needs to follow
- The e2e test recipe from your plan (or "skip e2e because …")
- The worker instructions below, copied verbatim:
```

After you finish implementing the change:

1. **Code review** — Run a code-review pass through the runtime's available skill invocation when one exists; otherwise do a focused manual code-review pass using the code-review instructions available in the session. Fix any findings it surfaces before continuing.
2. **Run unit tests** — Run the project's test suite (check for package.json scripts, Makefile targets, or common commands like `npm test`, `bun test`, `pytest`, `go test`). If tests fail, fix them.
3. **Test end-to-end** — Follow the e2e test recipe from the coordinator's prompt (below). If the recipe says to skip e2e for this unit, skip it.
4. **Report changed files** — Do not stage, commit, push, create or switch branches, create worktrees, force-push, merge, or open a PR. The main agent owns all git publication steps.
5. **Report** — End with a single line: `FILES: <comma-separated changed files>` so the coordinator can track the worker output. If no files were changed, end with `FILES: none — <reason>`.

```

Use the runtime's general-purpose worker type unless a more specific agent type fits.

## Phase 3: Track Progress

After launching all workers, render an initial status table:

| # | Unit | Status | Files |
|---|------|--------|----|
| 1 | <title> | running | — |
| 2 | <title> | running | — |

As worker completion notifications arrive, parse the `FILES: ...` line from each agent's result and re-render the table with updated status (`done` / `failed`) and changed files. Keep a brief failure note for any agent that did not produce the required report line.

When all agents have reported, render the final table and a one-line summary (e.g., "22/24 units completed; main agent owns any requested staging, commit, and push").
```

## Verification

Extraction is valid when this skill contains the decoded `/batch` command metadata, fallback text, orchestration prompt, shared worker instructions, and the repo agent-surface sync checks pass.
