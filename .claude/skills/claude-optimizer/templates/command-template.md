# Codex Workflow Prompt Templates

Codex does not need heavy command files for ordinary work. Prefer a focused prompt with objective, context, constraints, and done criteria. Use these templates for repeatable workflows or for converting old command prose into Codex-ready instructions.

## Implementation Prompt

```text
Goal:
[build/fix/change] so that [observable outcome].

Context:
- Relevant paths: [paths]
- Current failure or request: [details]
- Upstream/repo owner guidance: [rules or docs]

Constraints:
- [must]
- [must not]
- Preserve unrelated user changes.
- Do not edit generated mirrors directly.

Done when:
- [verification command or observable proof]
- [files/docs/sync updated]
- Final response names changed owner, proof run, and blockers.
```

## Review Prompt

```text
Review [scope] for bugs, regressions, security risks, and missing tests.

Invariants:
- Do not edit files.
- Findings first, ordered by severity.
- Each finding must cite file and line evidence.
- If no issue is found, say so and name residual risk.
```

## Research Prompt

```text
Research [question] and return an implementation recommendation.

Sources:
- Use live repo files for repo facts.
- Use upstream official docs for external technology facts.

Output:
- Controlling objective
- Evidence gathered
- Options considered
- Recommendation
- Risks or blockers
```

## Validation Prompt

```text
Validate [artifact or behavior].

Rules:
- Do not make changes.
- Run only the named checks: [commands].
- Report exact pass/fail status and the shortest relevant output.
- If blocked, report the blocker and do not invent proof.
```

## Prompt Quality Checklist

- The goal is concrete and observable.
- Constraints are stated as invariants.
- File ownership and generated mirrors are explicit when relevant.
- Validation is scoped to the touched behavior.
- The final response format is short and task-only.
- The prompt does not force planning when implementation is already requested.
