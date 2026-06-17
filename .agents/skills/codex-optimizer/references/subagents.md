# Subagents Playbook

Sources verified 2026-06-02:

- https://developers.openai.com/codex/subagents
- https://developers.openai.com/codex/concepts/subagents
- https://developers.openai.com/codex/agent-approvals-security
- https://developers.openai.com/codex/use-cases/learn-a-new-concept

## Intent

Use subagents to move noisy, parallel, or context-heavy work out of the main thread while keeping decisions, requirements, and final integration in the parent. A subagent should return usable findings, not raw exploration dumps.

Codex does not spawn subagents automatically. The parent prompt must explicitly ask for subagents or parallel agent work, define the split, say whether to wait for every result, and specify the return shape.

When a repo skill standardizes a parallel research workflow, make the delegation authorization explicit in that skill and keep it aligned with upstream manual triggering: read-heavy fan-out is acceptable for exploration, tests, triage, docs research, summarization, and skeptical review; parallel implementation remains a separate write-scoped phase.

## When To Delegate

Delegate when:

- Multiple independent paths can be explored in parallel.
- Log, test, or codebase scanning would pollute the main context.
- A specialized agent has clear instructions and a bounded deliverable.
- The parent can evaluate the result without trusting hidden work.
- The work is read-heavy: exploration, upstream docs research, test or log triage, summarization, or skeptical review.

Do not delegate when:

- The task needs one linear edit path.
- The acceptance criteria are unclear.
- The parent cannot inspect or validate the output.
- Multiple agents would need to edit the same files or coordinate write-heavy changes.

## Parallel Research Pattern

For exploration and research, split by evidence type rather than by vague topic. Practical roles:

- `map`: identify the relevant files, sources, symbols, flows, or document sections.
- `context`: verify upstream docs, external references, background concepts, and version-specific behavior.
- `details`: trace equations, figures, APIs, data shapes, edge cases, or call paths.
- `skeptic`: check whether evidence supports the claims and list contradictions, caveats, missing baselines, or unverified assumptions.

The parent agent must wait for all requested subagents, compare their answers, resolve contradictions, and synthesize one final result. Do not forward subagent conclusions as final truth without parent-side reconciliation.

## Custom Agent Authoring

- Store custom agents under `.codex/agents/` or `~/.codex/agents/`.
- Required fields: `name`, `description`, `developer_instructions`.
- Optional fields: `nickname_candidates`, `model`, `model_reasoning_effort`, `sandbox_mode`, `mcp_servers`, and `skills.config`.
- Treat `name` as source of truth; do not rely on filename semantics.
- Keep `developer_instructions` output-oriented: scope, allowed actions, required evidence, and report format.
- Keep local `.claude/agents/**` prompts title-first and output-oriented: `# Title`, `## Mission`, `## Workflow`, and `## Output Contract`.
- For long subagent workflows, move repeatable detail to an owning skill or rule; leave the direct prompt as a bounded delegation contract.

## Runtime Controls

- Use current documented Codex feature flags and runtime controls only. Do not add `[agents]`, `[parallelization]`, or `[workflow]` config tables unless the installed CLI strict-config path and current upstream docs both prove those tables are valid.
- This repo uses `[features].multi_agent`, `[features].multi_agent_v2`, and `[features].enable_fanout = false` for the checked-in Codex config. Keep worker limits in the coordinator prompt, worker skill/agent instructions, or native runtime controls instead of inventing config keys.
- Remember subagents inherit sandbox constraints and approval behavior from the parent.

## Output Contract

Tell each subagent:

1. The exact slice it owns.
2. Whether it may edit or only investigate.
3. What evidence to collect.
4. The format of the result.
5. Whether to stop at blockers or continue with alternatives.

Require each result to include:

- scope covered
- key findings
- file references, source links, or command evidence
- uncertainties and contradictions
- concrete blockers, if any
- recommended next step

For implementation planning or task-list preparation, also require each subagent to return its exact change-inventory slice: files, routes, consumers, dependencies, generated outputs, and check surfaces classified as add, update, remove, unchanged, or excluded. If a category has no entries, require `none` plus the evidence that proves it.

## supaschema Delivery Pattern

- Keep reusable subagent guidance in `.claude/agents/**` when that is the repo owner.
- Let sync produce Codex agent mirrors.
- Do not use subagents to bypass owner boundaries or approval policy.
- Treat parallel implementation as a separate phase after the parent has accepted the research synthesis.
