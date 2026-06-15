# Agent Teams Patterns

Patterns for orchestrating Claude Code agent teams - coordinated multi-session instances with shared tasks, inter-agent messaging, and team leads. Based on official documentation at [code.claude.com/docs/en/agent-teams](https://code.claude.com/docs/en/agent-teams).

> Related: [dynamic-workflows.md](dynamic-workflows.md) covers single-session JS workflow orchestration (`/workflows`, `ultracode`), distinct from multi-agent teams.

> **Experimental:** Agent teams require `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` enabled in settings.json or environment.
>
> **Version floor:** Agent teams require Claude Code v2.1.32+. Verify with `claude --version` before expecting team commands to work.

## Contents

- [Subagents vs Agent Teams](#subagents-vs-agent-teams)
- [Enabling Agent Teams](#enabling-agent-teams)
- [Architecture](#architecture)
- [Display Modes](#display-modes)
- [Subagent Definitions as Teammates](#subagent-definitions-as-teammates)
- [Team Coordination Patterns](#team-coordination-patterns)
- [Prompt Patterns for Teams](#prompt-patterns-for-teams)
- [Task Sizing and Assignment](#task-sizing-and-assignment)
- [Plan Approval Flow](#plan-approval-flow)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)
- [Limitations](#limitations)

---

## Subagents vs Agent Teams

Choose based on whether workers need to communicate with each other.

| Dimension | Subagents (`spawn_agent`) | Agent Teams |
| --- | --- | --- |
| **Context** | Own window; results return to caller | Own window; fully independent |
| **Communication** | Report back to main agent only | Teammates message each other directly |
| **Coordination** | Main agent manages all work | Shared task list with self-coordination |
| **Best for** | Focused tasks where only result matters | Complex work requiring discussion and collaboration |
| **Token cost** | Lower: results summarized back | Higher: each teammate is separate Claude instance |
| **Session** | Runs within parent session | Independent Claude Code session |
| **Persistence** | Dies when parent completes | Persists until explicitly shut down |
| **File access** | Same working directory | Same working directory (or worktree-isolated) |

### Decision Matrix

| Scenario | Use Subagents | Use Agent Teams |
| --- | --- | --- |
| Quick parallel research (3-5 min tasks) | **Yes** | No |
| Independent file changes, no discussion needed | **Yes** | No |
| Teammates need to share findings mid-task | No | **Yes** |
| Competing hypotheses requiring debate | No | **Yes** |
| Cross-layer coordination (FE + BE + tests) | Possible | **Better** |
| Budget-conscious, routine tasks | **Yes** | No |
| Complex feature requiring collaboration | No | **Yes** |
| Sequential pipeline (A feeds B feeds C) | **Yes** | Overkill |

---

## Enabling Agent Teams

Add to `settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

Or set in environment: `export CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`

---

## Architecture

| Component | Role |
| --- | --- |
| **Team lead** | Main Claude Code session that creates the team, spawns teammates, coords |
| **Teammates** | Separate Claude Code instances working on assigned tasks |
| **Task list** | Shared task list teammates claim and complete (with dependency tracking) |
| **Mailbox** | Messaging system for direct inter-agent communication |

### Storage

| Data        | Location                                  |
| ----------- | ----------------------------------------- |
| Team config | `~/.claude/teams/{team-name}/config.json` |
| Task list   | `~/.claude/tasks/{team-name}/`            |

Team config contains a `members` array with each teammate's name, agent ID, and type. Teammates can read this file to discover peers by name.

> **Runtime state — do not pre-author.** `config.json` is auto-managed runtime state (session IDs, tmux pane IDs, members). Hand-editing is overwritten on the next state update. There is also no project-level team config: a file like `.claude/teams/teams.json` is **not recognized** and Claude treats it as an ordinary file. Use `subagent` definitions (see below) for reusable team roles instead.

### Messaging primitives

| Channel | Target | Use |
| --- | --- | --- |
| **message** | one teammate by name | Targeted follow-ups and handoffs |
| **broadcast** | all teammates | Shared findings, global rules. Cost scales linearly with team size — use sparingly |

The lead assigns every teammate a name at spawn time. For predictable names you can reference in later prompts, tell the lead what to call each teammate in the spawn instruction.

### Permissions

Teammates inherit the lead's permission settings at spawn. You can change individual modes after spawning but cannot set per-teammate modes at spawn time.

### Context

Teammates load the same startup context as a regular session (`AGENTS.md` via the compatibility stub, applicable rules, MCP servers, preloaded skills) plus the spawn prompt. The lead's conversation history does NOT carry over.

Because every teammate pays that startup cost, keep global context lean. Put only always-needed guidance in `AGENTS.md`, use path-scoped rules for persistent local guidance, and keep large task detail in the spawn prompt or on-demand references.

---

## Display Modes

| Mode | How It Works | Requirements |
| --- | --- | --- |
| **In-process** | All teammates in main terminal. Shift+Up/Down to select. | Any terminal |
| **Split panes** | Each teammate in own pane. Click to interact. | tmux or iTerm2 |
| **Auto** | Split panes if in tmux, in-process otherwise (default) | - |

Configure in settings.json:

```json
{
  "teammateMode": "in-process"
}
```

Or per-session: `claude --teammate-mode in-process`

### iTerm2 split-pane setup

iTerm2 split panes require both pieces — missing either one silently falls back to in-process mode:

1. Install the [`it2` CLI](https://github.com/mkusaka/it2) (`npm i -g it2` or the upstream install script).
2. In iTerm2 preferences, enable **iTerm2 → Settings → General → Magic → Enable Python API**.

tmux is the alternative; `tmux -CC` inside iTerm2 is the recommended wrapper.

### In-Process Controls

| Key           | Action                            |
| ------------- | --------------------------------- |
| Shift+Up/Down | Select teammate                   |
| Enter         | View teammate's session           |
| Escape        | Interrupt teammate's current turn |
| Ctrl+T        | Toggle task list                  |
| Shift+Tab     | Cycle to delegate mode            |

---

## Subagent Definitions as Teammates

When spawning a teammate you can reference any subagent type from project, user, plugin, or CLI scope by name (e.g. `Spawn a teammate using the security-reviewer agent type to audit the auth module`). This lets one definition serve as both a delegated subagent _and_ an agent-team teammate.

Behavioral contract when a subagent is spawned as a teammate:

| Field | Applied as teammate? |
| --- | --- |
| `tools` | **Yes** — allowlist/denylist honored |
| `model` | **Yes** |
| body (markdown) | **Yes** — appended to the teammate's default system prompt as additional instructions (not replacing it) |
| `skills` | **No** — ignored on the teammate path; teammates load skills from project/user settings like a regular session |
| `mcpServers` | **No** — ignored on the teammate path; teammates load MCP servers from project/user settings |

**Always-available team tools.** `SendMessage` and the task-management tools are available to every teammate **even when `tools` restricts other tools**. You cannot hide team coordination from a teammate by narrowing its `tools` list.

---

## Team Coordination Patterns

### Pattern 1: Parallel Research Team

Best for: Multiple perspectives on the same problem.

```
Create an agent team to research the authentication refactor from 3 angles:
- One teammate on security implications
- One on performance impact
- One on backward compatibility
Have them share findings and challenge each other.
```

**Why teams > subagents here:** Teammates can directly challenge each other's findings rather than the lead having to manually relay contradictions.

### Pattern 2: Cross-Layer Feature Team

Best for: Changes spanning frontend, backend, database.

```
Create a team to implement the user preferences feature:
- Frontend teammate: builds the settings UI
- Backend teammate: creates Server Actions and validation
- Database teammate: writes the migration and RLS policies
Have them coordinate on the API contract.
```

**Why teams > subagents here:** The frontend teammate can directly ask the backend teammate about the response shape without orchestrator relay.

### Pattern 3: Competing Hypotheses (Debugging)

Best for: Unknown root cause requiring parallel investigation.

```
Users report the app exits after one message. Spawn 5 teammates to investigate
different hypotheses. Have them talk to each other to try to disprove each
other's theories, like a scientific debate.
```

**Why teams > subagents here:** Adversarial debate between independent investigators produces stronger root cause analysis than anchored sequential investigation.

### Pattern 4: Code Review Panel

Best for: Thorough multi-lens review.

```
Create a team to review PR #142:
- Security reviewer
- Performance reviewer
- Test coverage reviewer
Have them each review and report findings.
```

---

## Prompt Patterns for Teams

### Spawn with Detailed Context

Teammates don't inherit conversation history, so include task-specific details:

```
Spawn a security reviewer teammate with the prompt: "Review the authentication
module at src/auth/ for security vulnerabilities. Focus on token handling,
session management, and input validation. The app uses JWT tokens stored in
httpOnly cookies. Report any issues with severity ratings."
```

### Specify Models and Count

```
Create a team with 4 teammates to refactor these modules in parallel.
Use Sonnet for each teammate.
```

### Delegate Mode

Prevents the lead from implementing directly. Lead restricted to coordination-only: spawning, messaging, shutting down teammates, managing tasks.

Enable: Press Shift+Tab after starting a team.

### Wait for Completion

```
Wait for your teammates to complete their tasks before proceeding.
```

---

## Task Sizing and Assignment

### Sizing Guidelines

| Size | Characteristics | Result |
| --- | --- | --- |
| Too small | Trivial, <5 min work | Coordination overhead > benefit |
| Too large | Hours of work, no check-ins | Risk of wasted effort |
| Just right | Self-contained, clear deliverable (function, test) | Productive parallel work |

**Target: 5-6 tasks per teammate** keeps everyone productive and lets the lead reassign if someone gets stuck.

### Assignment Strategies

| Strategy | How | Best For |
| --- | --- | --- |
| Lead assigns | Tell the lead which task to give to whom | Clear division of labor |
| Self-claim | Teammates pick up unassigned, unblocked tasks | Autonomous operation |

Task claiming uses file locking to prevent race conditions.

### Task Dependencies

Tasks have three states: pending, in progress, completed. Dependencies auto-resolve: when a task completes, blocked dependents unblock automatically.

---

## Plan Approval Flow

For complex or risky tasks, require teammates to plan before implementing:

```
Spawn an architect teammate to refactor the authentication module.
Require plan approval before they make any changes.
```

### Flow

1. Teammate works in **plan mode**
2. Teammate finishes planning, sends **plan approval request** to lead
3. Lead reviews: **approve** (teammate exits plan mode, begins implementing) or **reject with feedback** (teammate revises and resubmits)

### Influencing Approval Criteria

```
Only approve plans that include test coverage.
Reject plans that modify the database schema.
```

---

## Best Practices

| Practice | Details |
| --- | --- |
| Give enough context | Include task-specific details in spawn prompt (no history carries) |
| Avoid file conflicts | Break work so each teammate owns different files |
| Start with research/review | Low-risk entry point for learning team coordination |
| Monitor and steer | Check progress, redirect failing approaches, synthesize as they go |
| Clean up properly | Always use the **lead** to clean up (`Clean up the team`) |
| Shut down before cleanup | Shut down all teammates first, then clean up |
| Pre-approve common ops | Reduce permission prompt friction via permission settings |

### File Conflict Prevention

Same rule as subagent waves: no two teammates should edit the same file. Break work into file-disjoint units. If shared config edits are needed, designate one teammate as the config owner.

---

## Troubleshooting

| Issue | Resolution |
| --- | --- |
| Teammates not appearing | Try Shift+Down; verify task complexity warrants a team |
| Too many permission prompts | Pre-approve common operations in permission settings |
| Teammates stopping on errors | Message them directly with additional instructions |
| Lead finishes prematurely | Tell it to wait for teammates before proceeding |
| Orphaned tmux sessions | `tmux ls` then `tmux kill-session -t <name>` |
| Lead implements instead | Enable delegate mode (Shift+Tab) or say "delegate, don't do" |

---

## Limitations

| Limitation | Impact |
| --- | --- |
| No session resumption | `/resume` doesn't restore in-process teammates |
| Task status lag | Teammates may forget to mark tasks completed |
| Slow shutdown | Teammates finish current request before stopping |
| One team per session | Clean up before starting a new team |
| No nested teams | Teammates cannot spawn their own teams |
| Fixed lead | Cannot promote teammate to lead |
| Permissions set at spawn | Cannot set per-teammate modes at spawn time |
| Split panes require tmux/iTerm2 | Not supported in VS Code terminal, Windows Terminal, Ghostty |

---

## Integration with Existing Patterns

### Combining with Wave Execution

Agent teams can incorporate wave-based execution from [parallel-agent-patterns.md](parallel-agent-patterns.md):

1. **Wave 1:** Database teammate creates migration
2. **Wave 2:** Backend + frontend teammates work in parallel on their layers
3. **Wave 3:** Testing teammate writes integration tests
4. **Wave 4:** Lead synthesizes and verifies

### Combining with Subagents

Teammates can themselves use `spawn_agent` for focused subtasks. A frontend teammate might spawn a quick explorer to find patterns before implementing.

### Relationship to teammate Skill

The `teammate` skill uses official Agent Teams as its primary workflow and falls back to subagent-based patterns when the experimental flag is not enabled.

| Feature | Subagent Fallback | Official Agent Teams |
| --- | --- | --- |
| Inter-agent messaging | Orchestrator relay (workaround) | Direct mailbox |
| Shared task list | TaskCreate convention | Native shared task list |
| Self-coordination | Manual | Automatic |
| Session independence | Within parent session | Fully independent sessions |
| Experimental requirement | No | Yes (feature flag) |

**Recommendation:** Use official agent teams (default path in `/teammate`) when the experimental flag is enabled. The skill automatically falls back to subagent patterns otherwise.

---

## Sources

- [Agent Teams Documentation](https://code.claude.com/docs/en/agent-teams) - Official Claude Code docs
- [Subagents Documentation](https://code.claude.com/docs/en/sub-agents) - Comparison reference
- [parallel-agent-patterns.md](parallel-agent-patterns.md) - Subagent dispatch patterns
- [workflow-patterns.md](workflow-patterns.md) - Wave execution and orchestrator patterns
- The `teammate` skill, when installed, owns the Agent Teams workflow with subagent fallback.
