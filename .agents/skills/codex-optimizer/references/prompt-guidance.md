# Prompt Guidance Playbook

Sources verified 2026-05-25:

- https://developers.openai.com/cookbook/examples/realtime_prompting_guide
- https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide
- https://platform.openai.com/docs/guides/prompt-engineering

Supplement with `prompt-cache-and-surface-audit.md` for 2026-05-27 coding-agent and prompt-cache findings.

## Intent

Use prompt guidance to shape agent behavior in the moment. Prompts should tell Codex how to act, what to optimize for, and how to know when to stop.

## Realtime Prompting Pattern

For realtime agents, specify:

- Role and user relationship.
- Conversation style and brevity.
- Turn-taking and interruption behavior.
- Tool-use policy and confirmation points.
- Safety boundaries and fallback behavior.
- What to do when context is missing.

Keep realtime prompts operational. Long policy blocks degrade live interaction.

## GPT-5 Codex Coding Pattern

For coding work, specify:

1. Objective and affected repo area.
2. Constraints that must not be violated.
3. Files, logs, screenshots, or tests that define the current state.
4. Expected validation.
5. Final response shape.

Use medium reasoning as the practical default for interactive coding. Raise effort for hard investigation, deep refactors, or security-sensitive work.

Keep runtime choices such as reasoning effort and verbosity in Codex config or API parameters when the surface exposes them. Use prompt prose for task objective, constraints, evidence, and stopping condition.

## Agentic Prompt Rules

- Require persistence through implementation and verification when the task asks for a change.
- Do not force a plan-first response unless uncertainty is material.
- Use TODOs or checklists only when they help execution.
- Keep final outputs concise and evidence-based.
- Put repeated prompt lessons into durable repo instructions instead of repeating them manually.

## supaschema Delivery Pattern

- User-provided constraints override local patterns.
- If the user corrects the frame, update the instructions and proceed under the corrected frame.
