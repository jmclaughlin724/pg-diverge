# Codex Multi-Agent Delegation Template

Use this template when the parent Codex thread should split work across multiple subagents. Delegate only when parallel exploration or independent slices reduce context pollution and the parent can validate the results.

## Parent Prompt

```text
Delegate this work in parallel and wait for all results before editing shared files.

Objective:
[single acceptance objective]

Slices:
1. [agent-name or role]: [owned path/surface], [read-only or edit], [expected output]
2. [agent-name or role]: [owned path/surface], [read-only or edit], [expected output]
3. [agent-name or role]: [owned path/surface], [read-only or edit], [expected output]

Rules:
- No two agents edit the same file.
- Each agent must cite live-file evidence.
- Each agent must return changed files or findings, closeout result, and blockers.
- Parent owns final integration and user response.
```

## Subagent Assignment

```text
You own: [paths/surface].
Mode: [read-only investigation | scoped edit].
Goal: [deliverable].
Constraints:
- [must/must-not]
- Do not modify generated mirrors directly.
- Do not broaden scope without reporting the blocker.

Return:
- Result
- Evidence
- Files changed
- Closeout command/output
- Blockers
```

## When To Use

- Independent codebase exploration.
- Competing implementation hypotheses.
- Large reviews where each agent owns a separate surface.
- Parallel test/log analysis.

## When Not To Use

- A single linear edit path.
- Unclear acceptance criteria.
- Work that requires multiple agents to edit the same files.
- Sensitive operations where approval flow or ownership would be unclear.

## Coordination Rules

- Dispatch all independent agents before synthesizing.
- Do local, non-overlapping work while agents run only if it cannot conflict.
- Synthesize contradictions explicitly.
- Integrate only after every blocking result is in.
- If an agent reports a blocker, parent decides whether to re-scope or stop.
