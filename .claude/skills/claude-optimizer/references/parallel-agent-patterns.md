# Parallel Agent Dispatch Patterns

Best practices for dispatching parallel Claude agents, including file conflict prevention, optimal agent counts, and timeout configuration.

## Core Principles

| Principle | Rule | Why |
| --- | --- | --- |
| **Optimal count** | 2-4 agents per wave | Balance parallelization vs coordination cost |
| **File isolation** | No two agents touch the same file within a wave | Prevents merge conflicts and lost edits |
| **Timeout per agent** | 5 minutes (300000ms) minimum | Complex research/fixes need time |
| **Blocking collection** | Wait for ALL agents before proceeding | Enables cross-validation and synthesis |
| **Silent wait** | No output during TaskOutput collection | User sees ONE consolidated report |
| **Verification agent** | Always dispatch after parallel work completes | Validates integration of all changes |
| **Result validation** | Spot-check 2-3 claims from each agent | Reject hallucinated or inaccurate findings |
| **Contradiction flagging** | Explicitly note when agents disagree | Resolve before presenting to user |

## When to Use

**✅ Use when:**

- 3+ independent problems with no shared state
- Each agent works on different file domains
- Understanding one doesn't require context from others

**❌ Don't use when:**

- Fewer than 3 tasks (overhead not worth it)
- Multiple agents edit same files (use wave pattern instead)
- Sequential dependencies exist (Task B needs Task A's output)

## Optimal Agent Count: 2-4 Per Wave

| Agent Count | Overhead | Benefit | Verdict                     |
| ----------- | -------- | ------- | --------------------------- |
| 2-4         | Low      | High    | ✅ Optimal range            |
| 5-7         | Medium   | Medium  | ⚠️ Diminishing returns      |
| 8+          | High     | Low     | ❌ Coordination cost > gain |

**Why 2-4?** More agents = more summaries to validate, higher file conflict risk, harder to spot contradictions.

## Timeout Configuration

**MANDATORY: 5 minutes (300000ms) per agent**

```typescript
TaskOutput({
  task_id: agentId,
  block: true,
  timeout: 300000, // 5 minutes
});
```

**Why 5 minutes?** Research with MCP calls (2-4 min), complex debugging (3-5 min), file restructuring (2-4 min). Default 2 minutes is insufficient.

**Handling timeouts:**

```typescript
if (result.status === "timeout") {
  // Retry once with another 5 minutes, then flag as incomplete if still pending
}
```

## Blocking Collection Pattern

**⛔ CRITICAL: Wait for ALL agents before presenting findings.**

**Pattern:** Dispatch all agents → collect with `TaskOutput(block: true, timeout: 300000)` → validate → present.

**⛔ NO TEXT OUTPUT during collection:**

| Phase        | Output? | Why                   |
| ------------ | ------- | --------------------- |
| Dispatch     | ❌ No   | Agents just started   |
| Collection   | ❌ No   | Results incomplete    |
| Validation   | ❌ No   | Cross-checking claims |
| Presentation | ✅ Yes  | Complete report only  |

## Result Validation

**Validation checklist:**

| Check | Action | If Fails |
| --- | --- | --- |
| **Consensus** | Do agents agree? | Flag contradictions |
| **Evidence** | Each finding cites file:line or URL? | Reject uncited claims |
| **Accuracy** | Spot-check 2-3 claims from each agent | Reject if source doesn't match |
| **Completeness** | Did agents answer the query? | Re-dispatch with clarification |

**Spot-check:** For each agent claim (e.g., "pattern at file:line"), use Read tool to verify. Reject if source doesn't match.

## Contradiction Resolution

1. Identify conflicting claims
2. Read source directly for ground truth
3. Reject wrong claims, keep verified claim
4. Present resolution with confidence level

## File Conflict Prevention

**Rule: Tasks in same wave MUST NOT touch same files.**

**Validation:** Check that no file appears in multiple tasks' `creates` or `modifies` arrays within the same wave. If conflict detected, move one task to next wave.

**Handling shared files (package.json, index.ts):**

- **Coordinator pattern:** Wave 2 (parallel) reports changes → Wave 3 (sequential) applies all atomically
- **Sequential wave:** Move shared file edits to separate wave

## Wave Execution Pattern

For tasks with dependencies:

```
Wave 1: Foundation (sequential)
Wave 2: Parallel work (2-4 agents, no overlapping files)
Wave 3: Shared updates (sequential, configs touched by Wave 2)
Wave 4: Verification (sequential)
```

**Rules:**

1. Tasks within wave: Must not edit same files
2. Waves execute: Sequentially
3. Tasks within waves: Execute in parallel
4. Shared configs: Must be in own wave
5. Always end with: Verification wave

## Verification Agent Pattern

**Always dispatch verification agent after parallel work.** Runs `typecheck test lint --force` on affected packages. Reports pass/fail before proceeding to next wave.

Metadata: `wave: N+1`, `agentType: "verification"`, `parallelSafe: false`

## Task Metadata for Parallel Execution

Required fields:

- `wave`: Execution order (1 = foundation, 2+ = depends on prior)
- `files.creates`/`files.modifies`: For conflict validation
- `parallelSafe: true`: Can run with other same-wave tasks
- `maxConcurrentAgents: 4`: 2-4 optimal
- `requiresVerificationAgent: true`: Dispatch verification after
- `requiredSkills`: Skills agent MUST invoke before work

**Wave assignment:**

| Wave | Criteria                    | Example                        |
| ---- | --------------------------- | ------------------------------ |
| 1    | No dependencies, foundation | Migrations, schemas, types     |
| 2    | Depends on Wave 1           | Server Actions using new types |
| 3    | Depends on Wave 2           | UI using Server Actions        |
| 4    | Final integration           | Tests, documentation           |

## Quick Reference

| Aspect | Pattern | Why |
| --- | --- | --- |
| **Agent count** | 2-4 per wave | Optimal parallelization |
| **Timeout** | 5 minutes (300000ms) | Research/debugging takes time |
| **Collection** | `block: true` for ALL agents | Validate before presentation |
| **Output timing** | AFTER all agents + validation | One complete report |
| **File conflicts** | Validate within waves | Prevents merge conflicts |
| **Shared files** | Coordinator pattern or separate wave | One atomic write |
| **Verification** | Always dispatch verification agent | Validates integration |
| **Contradictions** | Read source directly, resolve explicitly | Ground truth over agent claims |
| **Spot-check** | 2-3 claims per agent | Reject hallucinations |

## Pre-Dispatch Requirements

Before dispatching parallel agents, verify:

| Requirement           | Minimum                          |
| --------------------- | -------------------------------- |
| Independent tasks     | 3+ per wave                      |
| File domain isolation | No overlapping edits within wave |
| Agent count           | 2-4 per wave                     |
| Collection mode       | Blocking (`block: true`)         |
| Verification agent    | Included in final wave           |

## Foreground vs Background Execution

Claude Code auto-selects foreground or background execution based on task characteristics. Understanding the differences is critical for correct agent dispatch.

| Aspect | Foreground | Background |
| --- | --- | --- |
| **Execution** | Blocks parent until complete | Runs concurrently with parent |
| **MCP tools** | Full access to all MCP servers | NO MCP tools available |
| **Permission prompts** | Pass through to user | Pre-approved (no prompts) |
| **Output** | Inline in conversation | Written to file, read via TaskOutput |
| **Use case** | Complex tasks needing MCP/approval | Independent file operations |

**Key constraints for background agents:**

- Cannot use `mcp__supabase_main__*`, `mcp__context7__*`, `mcp__perplexity__*`, or any MCP tool
- Cannot prompt user for permission decisions
- Must write results to files or return via TaskOutput
- Best suited for: file edits, grep/read analysis, bash commands with pre-approved permissions

**When Claude Code auto-selects background:**

- Task has no MCP tool requirements
- All needed permissions can be pre-approved
- Task is independent of other concurrent work

**Force foreground when:**

- Agent needs MCP documentation lookups
- Agent needs Supabase queries or Perplexity research
- Agent may encounter permission prompts requiring user input

## Resume Subagent Pattern

Resume a previously completed subagent to continue work with full conversation history preserved.

```typescript
Task({
  resume: "agent-id",
  prompt:
    "Continue from where you left off. The migration has been applied — now update the Server Actions.",
});
```

**How it works:**

- Full conversation history is preserved from the prior run
- The resumed agent picks up exactly where it left off
- New prompt is appended to the existing history
- No re-reading of files or re-gathering of context needed

**Transcript storage:**

Subagent transcripts are stored at:

```
~/.claude/projects/{project}/{sessionId}/subagents/agent-{agentId}.jsonl
```

Each line is a JSON event (tool call, tool result, assistant message). Useful for:

- Debugging agent behavior after the fact
- Auditing what files an agent read or modified
- Understanding why an agent produced unexpected results

**When to use resume:**

| Scenario | Use Resume? | Why |
| --- | --- | --- |
| Agent completed Phase 1, needs Phase 2 | Yes | Avoids re-reading all Phase 1 context |
| Agent timed out mid-task | Yes | Continues from last checkpoint |
| Agent produced wrong results | No | Fresh start avoids compounding errors |
| Different task, same domain | No | New task needs clean context |

**Anti-pattern:** Do not resume an agent that produced incorrect output. Errors in history may compound. Dispatch a new agent with corrected instructions instead.

## Context Warnings

Parallel agents generate significant output. Without care, collecting results from many agents can exhaust the parent's context window.

### The Problem

Each `TaskOutput` call returns the full agent output into the parent conversation. With 4 agents each producing 2000+ tokens, a single collection phase can consume 8000+ tokens of context.

### Mitigation Strategies

| Strategy | How | When |
| --- | --- | --- |
| **Request summaries** | Include "Return a 3-5 sentence summary" in agent prompt | Always for 3+ agents |
| **Structured output** | Request JSON or table format, not prose | When parsing results programmatically |
| **File-based output** | Agent writes to file, parent reads selectively | Large outputs (analysis reports) |
| **Incremental collection** | Process one agent's output before collecting next | When synthesis is sequential |

### Agent Prompt Pattern for Compact Output

```typescript
Task({
  description: "Analyze auth patterns",
  prompt: `
    Search for authentication patterns in apps/web-admin/.

    Return ONLY a structured summary:
    - Pattern name: [name]
    - Files: [comma-separated paths]
    - Issues: [brief list]

    Do NOT include full file contents or lengthy explanations.
    Maximum 500 words.
  `,
});
```

### Independent Compaction

Each subagent maintains its own context window and compacts independently:

- Parent compaction does NOT affect running subagents
- Subagent compaction does NOT affect the parent
- Completed subagent output is frozen at collection time
- If a subagent compacts mid-run, it loses early context (same as main session)

**Implication:** Long-running agents (5+ minutes) may compact and lose early file reads. For critical context, instruct agents to re-read key files before producing final output.

## Path-Trigger Skill Gate Friction

When parallel workers are dispatched against slices spanning multiple subdirectories, each worker may touch files matching multiple `.claude/skills/*/file-triggers:` globs. The `skill-matcher.ts gate-pre` hook fires on every `Edit`/`Write`/`Bash` that hits a triggering path, demanding `Skill({ skill: "X" })` be called first. Subagents whose agent definition uses an explicit `tools:` allowlist that omits `Skill` cannot resolve this gate at runtime — they exit with "blocked: Skill tool unavailable" and the orchestrator must apply the work directly.

The structural fix lives in agent definitions, not in orchestration prompts. See [subagent-skill-runtime.md](subagent-skill-runtime.md) for:

- The two skill-loading paths (preload vs. runtime)
- Compliant `tools:` configurations
- The fallback "report findings, orchestrator applies" pattern when an agent is intentionally locked out
- A repo-state audit of which agents currently lack runtime skill invocation

Before designing a parallel orchestration that spans path-trigger globs, verify the spawned agent type's `tools:` field includes `Skill` (or omits `tools:` entirely). The friction observed in the 2026-05-09 `/team /simplify` orchestration (3 of 4 workers blocked across two waves) was traced to this exact gap in `elegant.md` and constrained agent definitions.

## Related

- [team/SKILL.md](../../team/SKILL.md) - repo-managed subagent coordination skill
- [workflow-patterns.md](workflow-patterns.md) - Wave and execution details
- [lightweight-explorer/SKILL.md](../../lightweight-explorer/SKILL.md) - fast exploration workflow
- [agent-teams-patterns.md](agent-teams-patterns.md) - Official Agent Teams for inter-agent communication and collaborative work (experimental)
- [subagent-skill-runtime.md](subagent-skill-runtime.md) - skill loading paths, runtime invocation precondition, parallel-orchestration friction
