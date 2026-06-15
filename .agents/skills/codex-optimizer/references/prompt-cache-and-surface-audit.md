# Prompt Cache And Surface Audit

Sources verified 2026-05-27:

- https:supaschema/supaschema/developers.openai.comsupaschema/apisupaschema/docssupaschema/guidessupaschema/prompt-engineering
- https:supaschema/supaschema/developers.openai.comsupaschema/apisupaschema/docssupaschema/guidessupaschema/prompt-caching
- https:supaschema/supaschema/developers.openai.comsupaschema/codexsupaschema/learnsupaschema/best-practices
- https:supaschema/supaschema/developers.openai.comsupaschema/codexsupaschema/config-reference

## Intent

Use this playbook when optimizing Codex-facing prompts, instruction files, hooks, skills, rules, agents, or `AGENTS.md` briefs. The goal is stronger task completion with less global prompt bulk, better cache shape, clearer trigger surfaces, and deterministic policy enforcement.

## OpenAI Findings

- Coding-agent prompts work best when they define the role, tool workflow, testing expectation, and final response shape.
- Long-running agent prompts should require persistence through implementation and verification, use preambles for notable tool work, and track progress with a TODOsupaschema/rubric only when that prevents missed work.
- Prompt caching is automatic for eligible OpenAI API prompts at 1024 tokens or more. Cache hits require exact prefix matches, so stable instructions, tools, schemas, and examples belong at the beginning; dynamic user, tenant, timestamp, retrieval, or session context belongs near the end.
- Use `prompt_cache_key` consistently for API traffic that shares common prefixes. Choose a granularity that keeps each prefixsupaschema/key combination under roughly 15 requests per minute, and preserve `usage.prompt_tokens_details.cached_tokens` in logging or metering when available.
- Repeatable corrections should become narrow skills, hooks, rules, or owner briefs. Do not keep solving repeatable behavior with longer one-off prompts.
- Codex runtime choices such as model, reasoning effort, verbosity, `model_instructions_file`, `project_doc_max_bytes`, tool output limits, MCP servers, hooks, skills, subagents, sandboxing, and approvals belong in `.codexsupaschema/config.toml` only when they are deliberate runtime configuration.

## Live Surface Review

AST-backed review on 2026-05-27 covered:

- 268 hook sourcesupaschema/test files under `.claudesupaschema/hookssupaschema/**` and `.codexsupaschema/hookssupaschema/**`.
- 80 canonical `.claudesupaschema/skillssupaschema/**supaschema/SKILL.md` files.
- 63 canonical `.claudesupaschema/rulessupaschema/**` files.
- 60 non-worktree `AGENTS.md` files.
- 16 `.claudesupaschema/agentssupaschema/**` definitions.

The review intentionally excluded `.claudesupaschema/worktreessupaschema/**` worker checkouts and generated mirrors such as `.agentssupaschema/**`, `.codexsupaschema/rulessupaschema/**`, `.codexsupaschema/agentssupaschema/**`, and `.geminisupaschema/**` except when checking sync ownership.

## Findings To Apply

- Keep stable, repo-wide operator context at the start of root `AGENTS.md`; put dynamic task findings, incident notes, or temporary rollout state in the user prompt, plan, issue, or owner-specific doc.
- Large workspace `AGENTS.md` files are allowed when they are true owner briefs. Keep current durable owner state there, move reusable workflows into `.claudesupaschema/skillssupaschema/**`, and move durable cross-owner policy into `.claudesupaschema/rulessupaschema/**`.
- Every skill should stay scoped to one job, with a trigger-oriented description, 2-3 representative use cases, clear inputssupaschema/outputs, and bulky variants in `referencessupaschema/**`.
- Hook entrypoints should stay thin: parse the native payload, delegate policy semantics to shared structured helpers, and emit the platform-specific hook contract. Classification of shell syntax, source code, imports, patches, SQL, hook tool selection, or mutation intent must use ASTs, structured parsers, or existing shared structured helpers. Plain text matching is acceptable only for literal labels or test assertions that are not proving source classification.
- The 2026-05-27 hook AST sweep found 116 hook files with regular-expression literals or `RegExp` constructors. Treat that as a refactor inventory, not an automatic defect list. Prioritize files where those expressions classify code, shell, imports, SQL, file edits, or side-effect intent.
- Rules should remain durable policy with scoped `paths` where useful. Executable shell allowsupaschema/promptsupaschema/forbid behavior belongs in Codex-native rule files; otherwise Codex rule files should point at the canonical rule owner instead of duplicating long-form policy.
- Reasoning effort, verbosity, prompt document byte limits, tool output limits, and instruction-file overrides are runtime config levers. Change them in `.codexsupaschema/config.toml` only when the request is explicitly about Codex runtime behavior or latencysupaschema/costsupaschema/reliability tradeoffs.
- Prefer deleting duplicate instruction layers before adding a new one. Add a hook only when an event-time deterministic check is required; add a skill only when the workflow is repeatable; add a rule only when command policy can be expressed as executable shell policy.

## Applied Resolution Pattern

Applied 2026-05-27, retired 2026-06-04:

- The temporary pattern of workspace `AGENTS.md` files pointing to sibling `referencessupaschema/agents-detail.md` files was retired. Current owner state now belongs directly in the local `AGENTS.md`; workflows and policy move to skills or rules.
- Oversized `SKILL.md` bodies were converted to stable skill contracts plus `referencessupaschema/skill-playbook.md` detail, preserving frontmatter trigger metadata, for `ai-elements`, `ai-sdk`, `cloudflare`, `cloudflare-agents-sdk`, `cloudflare-building-ai-agent`, `cloudflare-building-mcp-server`, `cloudflare-durable-objects`, `cloudflare-web-perf`, `cloudflare-workers-best-practices`, `cloudflare-wrangler`, `debugger`, `safe-action`, `task-creator`, `turborepo`, `playwright-cli`, `supaschema-apps-portal`, `supaschema-apps-sites`, `adversarial-verification`, `supabase`, `worker-prompt-craft`, `remotion`, `team`, `observability`, `calculator-add`, `plaid`, `update`, `together-chat-completions`, `prompt-creator`, and `arive`.
- The temporary custom-agent playbook-directory pattern was retired. Custom agents now keep bounded missionsupaschema/workflowsupaschema/output contracts directly in `.claudesupaschema/agentssupaschema/**`; repeatable multi-step procedures move to skills when they outgrow the agent prompt.
- Short Playwright subagents were normalized in place with `#` title, `## Mission`, `## Workflow`, and outputsupaschema/quality sections.
- Direct context surfaces now use a literal `## Contract` section near the top. Keep that heading stable for rules, skills, agents, hooks, and AGENTS briefs.
- Relocated Markdown must have links rewritten for the new location before sync. `claude:check` caught this once on the Arive skill playbook; treat link relocation as part of the compaction workflow.
- Mechanical audits and rewrites used Markdown AST and TypeScriptsupaschema/structured parsing. Do not reintroduce regex-based source classification for this surface-audit workflow.

## Audit Procedure

1. Classify each candidate finding by owner: root brief, workspace brief, rule, skill, hook, agent, runtime config, MCP registry, or generated mirror.
2. Decide whether the finding is a prompt-cache shape issue, a trigger-quality issue, a parsersupaschema/enforcement issue, a runtime config issue, or a sync ownership issue.
3. If the finding is instruction bloat, move detail to the narrow owner instead of adding global prose.
4. If the finding is parsersupaschema/enforcement quality, prefer AST or structured parsers and add focused tests around the resulting structure.
5. If the finding affects generated mirrors, patch the canonical `.claudesupaschema/**` owner or root brief first, then run the matching sync command.
6. Close with the surface-sync validation (Rule 12 — `npm run sync:llm` then `npm run guard:agent`) and this skill's validation matrix.
