# Codex Parallel Research Template

Use this when multiple independent research threads can reduce context load and improve confidence. The parent thread remains responsible for synthesis and final action.

## Parent Delegation Prompt

```text
Spawn parallel research agents for these independent slices and wait for all results:

1. Official docs: verify [technology/process] from primary upstream sources.
2. Repo evidence: search [paths] for current implementation and owner patterns.
3. Risk review: identify regressions, security concerns, and missing validation.

Each agent returns:
- Findings with source/file evidence
- Confidence level
- Recommended action
- Blockers

Do not synthesize or edit until all blocking results are in.
```

## Agent Result Contract

```text
Result:
Evidence:
Recommendation:
Risks:
Blockers:
```

## Rules

- Dispatch only independent slices.
- Do not send agents to edit the same file.
- Give each agent enough context; subagents do not inherit the full parent thread.
- Synthesize contradictions explicitly.
- Treat missing evidence as uncertainty, not as proof.
- Parent decides the final implementation plan and closeout.
