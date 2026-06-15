# Codex Skill Template

Use this template when creating a Codex-optimized skill. The skill should be an operating procedure that helps Codex deliver work, not a long documentation summary.

## Minimal Skill

```markdown
---
name: example-skill
description: "Use when [specific trigger]. Delivers [outcome] by [approach] while preserving [key constraint]."
metadata:
  keywords:
    - "[domain-term]"
  intent-patterns:
    - "[verb].*[domain]"
  file-triggers:
    - "[owned/path/**]"
---

# Example Skill

## Contract

This skill is a direct execution contract. Use it only for [specific trigger], load only [required context], and close out by [verification/reporting rule].

Use this skill for [bounded workflow].

## Source Order

1. Read live repo files before relying on memory.
2. Use upstream official docs for external product facts.
3. Apply repo owner rules after upstream behavior is understood.

## Workflow

1. Identify the controlling objective and acceptance criteria.
2. Classify the owner surface before editing.
3. Make the smallest complete change.
4. Run the closeout command for the touched owner.
5. Report owner changed, proof run, and any blocker inside scope.

## Reference Map

| Need      | Reference                                            |
| --------- | ---------------------------------------------------- |
| [surface] | [`references/[surface].md`](references/[surface].md) |
```

## Skill With References

Use references for detailed playbooks, not broad summaries.

```markdown
## Reference Map

| Surface | Reference |
| --- | --- |
| Runtime config | [`references/config.md`](references/config.md) |
| Delivery workflow | [`references/workflow.md`](references/workflow.md) |
| Verification | [`references/verification.md`](references/verification.md) |
```

Each reference should contain:

- Intent: when this surface is the right tool.
- Authoring steps: what to edit and in what order.
- Avoid: common wrong placements or overbroad patterns.
- Repo adapter: how the local owner and generated targets map.
- Closeout: exact sync or verification expectation.

## Optional OpenAI Metadata

Add `agents/openai.yaml` only when the skill needs OpenAI-specific invocation policy or tool dependencies.

```yaml
interface:
  display_name: Example Skill
policy:
  allow_implicit_invocation: true
dependencies:
  tools:
    - shell
```

## Directory Shape

```text
example-skill/
  SKILL.md
  agents/
    openai.yaml
  references/
    workflow.md
  scripts/
    validate.py
  assets/
    template.md
```

Keep optional directories out until they serve a real workflow.

## Codex Optimization Checklist

- `description` starts with a concrete "Use when..." trigger and names the delivered outcome.
- `SKILL.md` contains the normal execution path, not every edge case.
- References are playbooks with actions, owner mapping, and closeout.
- Scripts are deterministic helpers that reduce manual error.
- No reference file exists only as a table of contents.
- No TODO markers remain in production guidance.
- For Anilize `.claude/skills/**` edits, run `pnpm sync:llm` only unless the user explicitly requests skill validation.
