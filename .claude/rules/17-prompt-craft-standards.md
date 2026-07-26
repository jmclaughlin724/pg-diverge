---
enforcement:
  type: judgment-only
description: Authoring standards for AGENTS, CLAUDE, rules, skills, agents, hooks, commands, generated mirrors, and session-agent prompts.
paths:
  - "AGENTS.md"
  - "CLAUDE.md"
  - ".claude/**"
  - ".codex/**"
  - ".agents/**"
  - ".gemini/**"
  - "scripts/agent-hooks/**"
  - "scripts/skills/**"
---

# Rule 17 — Prompt craft standards

## Contract

This rule owns how agent instructions are written and delivered. The root `AGENTS.md` is the canonical, user-owned Codex project brief and is exempt from route-map, concision, section-order, and content-placement prescriptions. Stable prevention policy may live in the root brief or rules; repeatable workflows belong in skills, deterministic enforcement belongs in hooks or guards, and generated mirrors remain targets rather than owners.

## Surface selection

- Root `AGENTS.md`: canonical Codex project instruction brief. Preserve its user-defined content and structure; do not require it to be a route map, concise projection, or rule index.
- Nested `<subfolder>/AGENTS.md`: directory-scoped context that may serve as a concise route map or owner brief for that subtree.
- `.claude/rules/**`: durable policy, boundaries, STOP gates, and verification paths.
- `.claude/skills/**`: repeatable procedures, examples, references, scripts, and assets.
- `.claude/hooks/**` and `scripts/agent-hooks/**`: deterministic lifecycle enforcement.
- `.codex/**`, `.agents/**`, and `.gemini/**`: runtime config or generated/synced mirrors as defined by Rule 18.
- `README.md`: npm package landing page, not agent policy.
- `docs/**`: Mintlify public docs, not agent policy.

## Rule and skill shape

Every non-stub rule or skill must include:

- frontmatter with a short `description`;
- `## Contract` near the top;
- direct rules before examples/history/reference detail;
- verification and failure behavior when the surface is executable;
- no unresolved placeholders, no machine-local absolute paths, no stale plan text.

Skill-loading metadata must use the existing Rule 12 hook-enforcement path. For repo-managed skills, use `metadata.keywords` for literal prompt signals and `metadata.file-triggers` for structured file/tool path signals. Do not add `intent-patterns`, regex intent fields, or parallel matcher metadata; if matching behavior changes, update `scripts/agent-hooks/skills.mjs`, `scripts/guards/agent-surface/check-agent-hooks.mjs`, and Rule 12 together.

## Prompt economy and outcomes

Follow the current GPT-5.6 prompt guidance (https://developers.openai.com/api/docs/guides/prompt-guidance-gpt-5p6):

- State the outcome, constraints, available evidence, success criteria, validation, and stopping conditions; leave route-level judgment to the agent unless the route is itself a contract.
- State each instruction once in its canonical owner. Keep a short runtime projection only when the target runtime cannot load that owner directly.
- Keep user-visible outcomes, safety and permission boundaries, evidence requirements, tool-routing rules, required output shape, and stop conditions. Remove repeated process prose, examples, and tools that do not change behavior.
- Use absolute terms only for true invariants. Use decision rules for judgment calls such as when to search, ask, retry, delegate, or stop.
- Review the full prompt stack for contradictions. Change one instruction group or tool group at a time and validate material prompt changes against representative tasks or traces.
- When using the Responses API, set the default detail with `text.verbosity`. For short answers, preserve the conclusion, evidence, material caveat, and next action before optional background.

## Skills

- Treat a skill as a versioned bundle with exactly one `SKILL.md`. Keep discovery metadata concise and load the full instructions only when the skill is used.
- In the Responses API, skill metadata and loaded instructions are user-prompt input. Explicitly naming the skill makes selection more deterministic.
- Keep hosted skill references and local-shell paths distinct. Pin a hosted version when reproducibility matters.
- Treat every skill as privileged instructions and code. Review it before use, prevent arbitrary end-user skill selection, and require approval for write or high-impact actions.

## Multi-agent

- Delegate only concrete, bounded workstreams that can proceed independently and benefit from parallel execution or separate context.
- Prefer one agent for small tasks, ordered reasoning chains, fixed deterministic graphs, shared mutable resources, or work dominated by one slow external operation.
- Give each subagent a bounded task. The root agent must reconcile overlaps or conflicts, synthesize the results, and produce the final response.
- Responses API subagents receive the request's configured tools; account for that shared tool set when configuring the request.

## Reasoning

- GPT-5.6 supports independent `reasoning.mode` and `reasoning.effort` controls in the Responses API. `standard` is the default mode; omission of effort defaults to `medium`.
- Use `pro` only for difficult quality-first work where measured reliability gains justify higher latency and token use. Keep the same outcome-focused prompt and compare standard and pro on representative tasks.
- For a GPT-5.6 migration, preserve the current effort as the baseline and compare the same level with one lower.

## Tool orchestration

- Expose only task-relevant tools. Tool instructions must state what a tool does, when to use it, important return fields, and failure behavior when those facts affect routing.
- Resolve prerequisite discovery, retrieval, and validation before dependent action. Run independent reads concurrently when safe, keep dependent work sequential, and synthesize retrieved evidence before editing.
- Treat empty, partial, or suspiciously narrow results as incomplete evidence; use one or two meaningful fallbacks before concluding absence.
- Use tool search to defer broad function or MCP inventories. Prefer clear namespaces or MCP servers, keep namespace descriptions concise, and aim for fewer than ten functions per namespace. Use hosted search for inventories known at request creation and client-executed search when discovery depends on project, tenant, or application state.
- Use programmatic tool calling only for a bounded deterministic reduction stage such as filtering, joining, ranking, deduplication, aggregation, batching, or repeated validation. Parse every tool result through documented fields and emit a smaller structured result with the evidence needed downstream; do not serialize raw result envelopes or concatenate unbounded outputs. State the eligible tools, output schema, concurrency, retry and failure limits, stop condition, and handoff.
- For programmatic read or search batches, inspect every settled sibling and distinguish tool failure, per-result truncation, and aggregate or wrapper truncation or omission. Coordination primitives such as `Promise.allSettled` do not perform this parsing. Treat every partial result as incomplete evidence and retry only the affected input through a narrower or direct call. When complete content is required and cannot be reduced, stage it across bounded direct outputs instead of summarizing it.
- Prefer direct tool calls when one call is sufficient, intermediate results are small, each result changes the next judgment, approval is involved, or citations and native artifacts must be preserved. Verify both reduced program output and the final response.
- For programmatic calls, preserve every `call_id` and `caller` relationship and continue until the final assistant message arrives. Keep semantic judgment, approvals, side effects, citations, native artifacts, and final validation direct.
- For apply-patch workflows, provide current file context or filesystem exploration tools, validate and restrict paths, choose atomic or per-file failure semantics, and return one explicit result per patch call. Prefer focused diffs and run the narrowest relevant tests or linters after applying them.

## Collaboration and response contract

- Keep personality and collaboration guidance short and distinct. Personality controls tone; collaboration controls initiative, questions, assumptions, uncertainty, tradeoffs, and verification.
- Before multi-step tool work, give a one- or two-sentence first-step preamble. Update at major phase changes or when evidence changes the plan; do not narrate routine calls.
- Lead final responses with the outcome unless the turn contains a material tool or runtime incident, rejected action, timeout, truncation, partial mutation, or lost-evidence event that the root contract requires surfaced first. In that case, lead with an explicit incident label, name what happened without euphemism, state impact and recovery evidence, and then give the outcome. A recovered incident remains prominent; do not demote it to a trailing caveat. For a recorded shell command-not-found incident, begin exactly with `Tool incident:` and explicitly say `command not found`.
- For edits, rewrites, summaries, and drafts, preserve the requested artifact, factual claims, length, structure, and genre before improving clarity. Do not add claims, sections, or promotional tone unless requested.

## Generated prompt contract

Prompts generated for another session agent must include:

1. Mission.
2. Context.
3. Authority and rule priority.
4. Scope in/out.
5. Non-negotiable rules.
6. Required workflow.
7. Verification.
8. Stop conditions.
9. Failure behavior.
10. Output format.
11. Acceptance criteria.

Generated prompts must not contain unresolved placeholders, invented paths, invented commands, secrets, local-only absolute paths, or unverified repo facts. If repo access is unavailable, label file paths and commands as assumptions and tell the session agent to inspect them first.

## AGENTS.md scope

The root `AGENTS.md` is the canonical Codex runtime brief. Do not prescribe its length, section order, level of detail, route-map role, or whether durable policy lives directly in it. Preserve or restore its user-authored content unless the user explicitly requests a root-brief edit.

Content-shaping guidance in this rule applies only to nested `<subfolder>/AGENTS.md` files. Those scoped briefs may stay concise, describe local ownership and commands, and route deeper procedures to rules or skills when useful.

## Style

- Use `MUST`/`MUST NOT` only for structural correctness, safety, security, package boundary, migration, or generated-surface requirements.
- Use direct bullets and concrete commands.
- Avoid vague phrases such as "best practices" unless immediately defined.
- Put long background and examples in skill-local `references/**`.
- Use tables only when the matrix is the rule.
- For review/audit prompts, require evidence, severity, uncertainty, and non-speculative findings.

## Verification

After changing rules, skills, hooks, agents, commands, generated mirrors, or root briefs, run the relevant sync/check command:

```bash
npm run sync:llm
npm run guard
```

Use narrower commands (`npm run guard:agent`, focused hook tests, rule/skill checks) when the task is scoped.

## Failure behavior

Fix the canonical owner first, then regenerate mirrors. Do not patch a generated mirror, duplicate policy across surfaces, or add a new rule/skill without an enforcement or verification story.

## Done means

- The instruction lives in the correct surface.
- The rule/skill has a contract, scope, verification, and failure behavior.
- Generated targets are synced from owners.
- No unresolved placeholders, secrets, stale dates, or local-only absolute paths remain.

## OpenAI sources

- https://developers.openai.com/api/docs/guides/latest-model
- https://developers.openai.com/api/docs/guides/tools-skills
- https://developers.openai.com/api/docs/guides/responses-multi-agent
- https://developers.openai.com/api/docs/guides/reasoning#reasoning-mode
- https://developers.openai.com/api/docs/guides/prompt-engineering
- https://developers.openai.com/api/docs/guides/tools-tool-search
- https://developers.openai.com/api/docs/guides/tools-programmatic-tool-calling
- https://developers.openai.com/api/docs/guides/tools-apply-patch
