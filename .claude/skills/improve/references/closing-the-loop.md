# Closing the Loop — execute, reconcile, issues

The advisor's job doesn't end at the plan. This file covers the three follow-through flows: dispatching an executor and reviewing its work (`execute`), keeping the plan backlog alive (`reconcile`), and publishing plans where work gets picked up (`--issues`).

The founding rule survives unchanged: **the advisor never edits source code.** In `execute`, a _separate executor subagent_ may edit code on the current branch in the current worktree, but it must not stage, commit, push, merge, or open PRs. The advisor dispatches, reviews, and renders a verdict — like a tech lead who does not edit implementation code directly.

---

## `execute <plan>` — dispatch and review

### Preconditions (check all before dispatching)

- The repo is a git repository because the executor works on the current branch and the main agent may later stage, commit, and push task-owned work when explicitly instructed. If not: stop and say so.
- The plan file exists and its dependencies show DONE in `plans/README.md`. If not: stop, name the missing dependency.
- Run the plan's drift check yourself. If in-scope files changed since `Planned at`, reconcile the plan first (see below) — don't hand a stale plan to an executor.

### Dispatch

Spawn **one** `general-purpose` subagent in the current branch and current worktree. Do not request worktree isolation or branch creation. Executor model: default `sonnet`; use what the user named if they named one (`execute 003 haiku`).

The subagent prompt must contain:

1. **The full plan file text, inlined.** The executor may not have the advisor's context, and uncommitted plan edits may be hard to locate. Never assume; always inline.
2. The executor preamble:

> You are the executor for the implementation plan below. Follow it step by step. Run every verification command and confirm the expected result before moving on. Touch only the files listed as in scope. If any STOP condition occurs, stop immediately and report. Do not improvise around obstacles. Work on the current branch in the current worktree. Do not stage, commit, push, create or switch branches, create worktrees, force-push, merge, or open a PR. The main agent owns all git publication steps. One override: SKIP the plan's instruction to update `plans/README.md` — your reviewer maintains the index. Before reporting, audit every claim in your report against an actual tool result from this session — only report what you can point to evidence for; if a verification failed or was skipped, say so plainly. When finished, reply with exactly the report format below.

3. The report format:

```
STATUS: COMPLETE | STOPPED
STEPS: per step — done/skipped + verification command result
STOPPED BECAUSE: (only if STOPPED) which STOP condition, what was observed
FILES CHANGED: list
NOTES: anything the reviewer should know (deviations, surprises, judgment calls)
```

### Review (the advisor's real job here)

Note on shared worktrees: concurrent edits can exist. Preserve unrelated dirty tracked and untracked work, and stop/report if the plan cannot be executed without overwriting unrelated changes.

Review like a tech lead reviewing a PR against the spec — never fix anything yourself:

1. **Re-run every done criterion** in the current worktree. Don't trust the executor's report — verify.
2. **Scope compliance**: inspect `git status --short`, the executor commit or diff, and the plan's in-scope list. Any file outside scope fails review, full stop.
3. **Read the full diff.** Judge it against "Why this matters" (does it solve the actual problem?) and the repo conventions named in the plan (does it look like the rest of the codebase?).
4. **Audit the new tests.** Executors game criteria — a test that asserts nothing meaningful passes `npm test` and proves nothing. Read what the tests assert.

### Verdict

**Documented deviations are judged on merit, not reflex-blocked.** "Do not improvise" exists to stop silent drift; an executor that hits a real obstacle (e.g. the plan's approach breaks existing test mocks), adapts minimally, and explains it in NOTES has done the right thing. Approve it if the adaptation serves the plan's intent and stays in scope; treat _undocumented_ deviations as review failures.

| Verdict | When | Action |
| --- | --- | --- |
| **APPROVE** | Criteria pass, scope clean, quality holds | Update index status to DONE. Present to the user: diff summary, branch, and anything from NOTES. **Only the main agent may stage, commit, push, or merge, and only when the user explicitly assigned it.** |
| **REVISE** | Fixable gaps | SendMessage to the same executor with specific, actionable feedback ("criterion 3 fails: X; the error handling in `api.ts:90` swallows the error — use the Result pattern per the plan"). **Max 2 revision rounds**, then BLOCK. |
| **BLOCK** | STOP condition hit, scope violated unrecoverably, or revisions exhausted | Mark BLOCKED in the index with the reason. Refine or rewrite the plan with what was learned. Tell the user what happened and what changed in the plan. |

Executor verification runs in the shared current worktree. Use the smallest plan-owned verification path and preserve unrelated dirty work.

---

## `reconcile` — keep `plans/` alive

Process what happened since the last session. Read `plans/README.md` and every plan file, then per status:

- **DONE** — spot-check that the done criteria still hold on the current HEAD (cheap ones only). Mark verified in the index. Don't delete plan files — they're the record.
- **BLOCKED** — read the reason. Investigate the underlying obstacle in the codebase. Either rewrite the plan around it (new number if the approach changed fundamentally, in-place refresh otherwise) or mark REJECTED with one line of rationale.
- **IN PROGRESS** (stale) — flag it to the user; an executor probably died mid-run. Check current branch state and any executor commit if one exists.
- **TODO** — run the drift check. If drifted: re-verify the finding still exists (it may have been fixed in passing), then refresh the "Current state" excerpts and `Planned at` SHA. If the finding is gone, mark REJECTED ("fixed independently").

Finish with a short report: what's verified done, what was refreshed, what's rejected, and what's executable right now.

---

## `--issues` — publish plans as GitHub issues

Modifier on any planning invocation (`/improve --issues`, `/improve security --issues`). The flag is the user's authorization to create issues — never create them without it.

1. Preflight: `gh auth status` succeeds and the repo has a GitHub remote. If either fails, write the plan files as normal and say why issues were skipped.
2. Show the list of titles about to become issues; confirm once if interactive.
3. Per plan: `gh issue create --title "<plan title>" --body-file <plan file>`. Labels: `improve` plus the category — apply only if the labels exist or can be created without erroring; skip labels rather than fail.
4. Record each issue URL in the plan's Status block (`- **Issue**: <url>`) and the index.

The plan file remains the source of truth; the issue is distribution. The self-containment rule pays off here — the issue body needs no edits to make sense to whoever (or whatever) picks it up.
