# Improvement And Repair Loops Playbook

Sources verified 2026-05-25:

- https://developers.openai.com/cookbook/examples/agents_sdk/agent_improvement_loop
- https://developers.openai.com/cookbook/examples/codex/build_iterative_repair_loops_with_codex

## Intent

Use loops when agent output must improve through evidence, not preference. The loop should produce a better artifact and a durable lesson only when the failure is likely to recur.

## Agent Improvement Loop

1. Collect real traces from failed or weak agent work.
2. Add human or model feedback that identifies the failure mode.
3. Convert recurring failures into evals.
4. Improve the harness: instructions, tools, routing, outputs, or validation.
5. Hand the change to Codex with a precise implementation brief.
6. Re-run the eval or equivalent proof.

Use this for improving agent systems, not for every small code fix.

## Iterative Repair Loop

1. Review: produce structured findings without editing.
2. Repair: make focused edits against the findings and latest validation output.
3. Validate: run the check that proves the repair.
4. Repeat until validation passes or a real blocker is proven.

Keep each loop iteration small. Large mixed repairs hide whether the fix worked.

## Durable Lessons

- Promote repeated failures into the canonical owner: rule, skill, hook, agent, or `AGENTS.md`.
- Do not write one-off incident history into durable guidance.
- If the loop only fixed a local artifact, report the fix and stop.

## Anilize Delivery Pattern

- For skill repair, update `.claude/skills/**`, then run `pnpm sync:llm`.
- Do not add validation noise after the user has constrained closeout.
