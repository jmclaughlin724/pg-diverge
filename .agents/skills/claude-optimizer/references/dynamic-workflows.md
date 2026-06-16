# Dynamic Workflows

Claude Code's dynamic-workflows feature: a JavaScript script Claude writes that orchestrates many subagents at scale in the background while the session stays responsive.

> Source: https://code.claude.com/docs/en/workflows. When that page contradicts this file, the official docs win — open a PR updating this reference.
>
> **Disambiguation:** this is the upstream Claude Code _feature_. For the repo's wave-execution orchestration _patterns_ (how to structure parallel subagent work by hand), see [workflow-patterns.md](workflow-patterns.md) and [parallel-agent-patterns.md](parallel-agent-patterns.md).

## Availability

Research preview. Requires **Claude Code v2.1.154+**. Available on Pro, Max, Team, Enterprise, plus Anthropic API, Bedrock, Vertex AI, Foundry. On Pro, enable from the Dynamic workflows row in `/config`.

## When to Use a Workflow

Subagents, skills, agent teams, and workflows all run multi-step tasks; the difference is **who holds the plan**.

|  | Subagents | Skills | Agent teams | Workflows |
| --- | --- | --- | --- | --- |
| What it is | A worker Claude spawns | Instructions Claude follows | A lead supervising peer sessions | A script the runtime executes |
| Who decides next | Claude, turn by turn | Claude, per prompt | The lead, turn by turn | The script |
| Intermediate results | Claude's context | Claude's context | Shared task list | Script variables |
| Scale | A few per turn | Same | A handful of peers | Dozens–hundreds per run |
| Interruption | Restarts the turn | Restarts the turn | Teammates keep running | Resumable in-session |

Reach for a workflow when a task needs more agents than one conversation can coordinate, or when the orchestration should be codified as a rerunnable, readable script — codebase-wide sweeps, large migrations, cross-checked research, multi-angle plan drafting. A workflow can also apply repeatable quality patterns (adversarial cross-review, multi-angle drafting), keeping only the final answer in Claude's context.

## Run a Bundled Workflow

| Command | What it does |
| --- | --- |
| `/deep-research <question>` | Fans web searches across angles, fetches and cross-checks sources, votes on each claim, returns a cited report. Requires the WebSearch tool. |

Saved workflows become `/<name>` commands and appear in `/` autocomplete alongside bundled ones.

## Trigger a Workflow

- **Keyword:** include the word `workflow` anywhere in a prompt. Claude writes a script for the task instead of working turn by turn. Dismiss the highlight with `Option+W` (macOS) / `Alt+W` (Win/Linux) or backspace after the word; turn it off entirely via "Workflow keyword trigger" in `/config`.
- **ultracode:** `/effort ultracode` makes Claude plan a workflow for every substantive task in the session (see [effort-and-thinking.md](effort-and-thinking.md#ultracode)). One request can become several workflows (understand → change → verify); higher token/time cost.

## Watch and Manage Runs

`/workflows` lists running and completed runs; select one for the progress view (phases with agent counts, token totals, elapsed time). A one-line summary also appears in the task panel below the input box.

| Key | Action |
| --- | --- |
| `↑` / `↓` | Select a phase or agent |
| `Enter` / `→` | Drill into phase, then agent (prompt, recent tool calls, result) |
| `Esc` | Back out one level |
| `j` / `k` | Scroll within agent detail |
| `p` | Pause or resume the run |
| `x` | Stop the selected agent, or the whole run when focus is on the run |
| `r` | Restart the selected running agent |
| `s` | Save the run's script as a command |

**Resume:** paused runs resume in the same session — completed agents return cached results, the rest run live. Exiting Claude Code restarts the workflow fresh next session.

## Approval Before Run

| Permission mode | When prompted |
| --- | --- |
| Default, acceptEdits | Every run, unless "Yes, and don't ask again" was chosen for that workflow in this project |
| Auto | First launch only (consent saved to user settings); skipped entirely when ultracode is on |
| Bypass permissions, `claude -p`, Agent SDK | Never — the run starts immediately |

Permission mode only gates the launch prompt. The subagents a workflow spawns always run in `acceptEdits` and inherit your tool allowlist; shell/web/MCP calls outside the allowlist can still prompt mid-run — pre-allow them for long runs.

## Save and Parameterize

Save a run's script with `s` in `/workflows`:

- `.claude/workflows/` (project): shared with everyone who clones the repo
- `~/.claude/workflows/` (personal): every project, only you

Project workflow wins on a name collision. Saved workflows accept input through the global `args` (a research question, target-path list, config object) passed at invocation.

## How a Workflow Runs

The runtime executes the script in isolation; intermediate results stay in script variables. Each run's script is written under `~/.claude/projects/<session>/` (Claude gets the path — readable, diffable, editable for relaunch).

| Constraint | Why |
| --- | --- |
| No mid-run user input | Only agent permission prompts pause a run; run each stage as its own workflow for sign-off between stages |
| No direct filesystem/shell from the script | Agents read/write/run; the script only coordinates |
| Up to 16 concurrent agents (fewer on low-CPU machines) | Bounds local resource use |
| 1,000 agents total per run | Prevents runaway loops |

Every agent uses the session model unless the script routes a stage elsewhere; a run can cost meaningfully more tokens than a conversation. Gauge spend on a small slice first.

## Disable Workflows

When disabled, bundled workflow commands are unavailable, the `workflow` keyword no longer triggers, and `ultracode` is removed from the `/effort` menu.

- `/config` → toggle Dynamic workflows off (persists)
- `"disableWorkflows": true` in `~/.claude/settings.json` or [managed settings](permissions-and-settings.md) (persists)
- `CLAUDE_CODE_DISABLE_WORKFLOWS=1` (read at startup, applies wherever set)

## Related References

- [agent-teams-patterns.md](agent-teams-patterns.md) — peer-session orchestration; teams vs workflows
- [parallel-agent-patterns.md](parallel-agent-patterns.md), [workflow-patterns.md](workflow-patterns.md) — hand-rolled wave orchestration patterns (distinct from this feature)
- [effort-and-thinking.md](effort-and-thinking.md) — `ultracode` combines `xhigh` effort with workflow orchestration
- [prompt-caching-runtime.md](prompt-caching-runtime.md) — each subagent/workflow agent builds its own cache
- Official docs: https://code.claude.com/docs/en/workflows
