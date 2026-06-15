# Tasks Playbook

Original detailed skill body moved from `.claude/skills/task-creator/SKILL.md` so `SKILL.md` stays focused on trigger, workflow, and closeout. Read only the sections needed for the current task.

# Tasks

Turn `$ARGUMENTS` into an execution-ready persistent task system. This skill is for research-first execution planning plus wave-based foreground subagent execution, not for speculative TODO lists or pre-research plans.

Hard sequencing rule: complete all applicable research, investigation, code search, ownership tracing, MCP validation, skill loading, and assumption resolution before creating or presenting any plan, implementation wave, persistent task list, or textual fallback task system. A plan or task list is the execution artifact produced after evidence is gathered; it is not a substitute for gathering evidence. Any assumption that would shape scope, order, ownership, verification, risk, or user-visible behavior must be investigated and resolved first.

Default stance: `$tasks` is elegant-first. Unless the user explicitly asks for backwards compatibility, a minimal patch, or preservation of an existing public contract, the task system should assume the simplest correct end state and say so explicitly in the first post-research planning response.

Runtime terminology:

- In Claude Code, use the native persistent task tools when available: `TaskList`, `TaskCreate`, `TaskUpdate`, `TaskGet`, and `TeamCreate`.
- In Codex, use the native task/status tools available in the session:
  - `update_plan` for visible session-scoped wave and status tracking. It supports ordered plan steps with `pending`, `in_progress`, and `completed` statuses; keep at most one item `in_progress`.
  - `create_goal` only when the user explicitly asks for an active goal, long-running objective, or token-budgeted goal. It is not a task-list substitute.
  - `get_goal` to inspect the active goal, budget, and status when a goal exists.
  - `update_goal` only to mark an explicit active goal `complete` or `blocked` under Codex goal rules.
  - `tool_search` to discover deferred MCP, plugin, connector, task-list, and delegation tools when the requested capability is not already exposed.
  - `multi_tool_use.parallel` to run independent local tool calls in parallel. It is not subagent delegation.
  - `spawn_agent` / `wait_agent`-compatible delegation tools only when those exact schemas are exposed directly or through tool discovery. Do not name a namespace as available unless the active runtime exposes it.
  - `request_user_input` only when the tool is available and a blocking decision cannot be resolved from repo evidence.
- Codex does not expose Claude `TaskList` / `TaskCreate` / `TaskUpdate` / `TaskGet` as native task-list equivalents in this runtime. `update_plan` is not persistent, has no task-list UUID, and does not store arbitrary task metadata or dependency records. When native persistent task-list tools are unavailable in Codex, create the textual fallback execution record as the authoritative task system in the transcript or plan history, and mirror live progress in `update_plan`; this is a fallback record, not a Codex-native task-list object.
- In Codex, a `$task-creator` request for an implementation-ready task list authorizes the read-only parallel research fan-out below unless the user forbids delegation. Implementation subagents still require explicit user-requested orchestration and disjoint write scopes.
- If neither runtime exposes a persistent task-list facility after tool discovery, create an authoritative textual fallback task system and state that it is the fallback execution record.

Codex upstream task/persistence basis:

- Official Codex CLI slash-command docs define `/plan` as plan mode before implementation and `/goal` as a persistent target for a larger task, not as a structured local task-list API. Source: `https://developers.openai.com/codex/cli/slash-commands#built-in-slash-commands`.
- Official Codex Goal mode docs define a goal as the starting prompt plus completion criteria and allow pause/resume/edit/clear behavior. Use it only for explicit larger objectives, not as a replacement for task records with dependencies and change-inventory metadata. Source: `https://developers.openai.com/codex/prompting#goal-mode`.
- Official Codex CLI reference documents `codex cloud` tasks and `codex cloud list` for cloud work; do not treat local task planning as a cloud task unless the workflow actually submits cloud work. Source: `https://developers.openai.com/codex/cli/reference#codex-cloud`.
- Official Codex config docs describe session transcript persistence through `history.persistence`, SQLite-backed agent/runtime state through `sqlite_home`, and multi-agent tools through `features.multi_agent`; these persist session/runtime state, not a local task-list object with UUIDs, dependency records, and arbitrary metadata. Source: `https://developers.openai.com/codex/config-reference#configtoml`.
- Official Codex subagent docs say parallel agents are for explicitly requested parallel agent work and read-heavy exploration, tests, triage, or summarization. `$task-creator` treats an implementation-ready task-list request as explicit authorization for read-only research fan-out, but not for parallel implementation writes. Source: `https://developers.openai.com/codex/concepts/subagents`.

Output contract: the first plan or task-list response, created only after the research gate above is complete, must be expressed through the persistent task list or fallback execution record and explicitly include:

- `Execution lens: elegant` or `Execution lens: compatibility-constrained`
- `Elegant end state: ...`
- `Compatibility constraint: none` or the exact reason the elegant path is not fully taken
- `Open assumptions: none (all validated)` — required; if this is not true, do not create the plan or task list
- `Resolved assumptions: ...` — list each assumption that influenced scope, owner choice, sequencing, verification, or behavior, with the evidence or user decision that resolved it
- `Scope ledger: ...` — list the plan-owned dirty files, generated mirrors, migrations, and external rollout surfaces; classify unrelated dirty files or pending migration manifests as excluded instead of absorbing them into the plan
- `Change inventory: ...` — itemize every file, route, consumer, dependency, test/check surface, generated output, and external rollout surface as `add`, `update`, `remove`, or `unchanged/excluded`, with evidence for the classification. If a category has no entries, say `none` with the evidence that proves it.
- `Enforcement-surface ledger: ...` — required when the plan standardizes behavior, deprecates a workaround, or creates a canonical pattern; list every rule, skill, hook, guard, package script, generated mirror, and CI/check surface that must enforce the new standard
- `Placeholders / TODOs: none` — every task body, description, metadata field, and referenced artifact has been resolved
- `Deferral budget: zero` — every task on the list will be completed in this workstream; nothing is staged for "future work"

For implementation plans, the same plan or task-list record must also make traceability explicit:

- requirements and where each is addressed
- named resources, files, APIs, or systems involved
- state transitions or data flow where relevant
- validation commands or checks
- failure behavior
- privacy and security considerations
- open questions: none; any open question that affects scope, ownership, sequencing, verification, risk, or behavior must be resolved before waves are locked

Do not leave the elegant lens as implicit reasoning. The user should be able to see it directly in the persistent task list or fallback task system without inferring it. The plan cannot be created unless `Open assumptions`, `Placeholders / TODOs`, and `Deferral budget` all read clean.

Load these skills first:

- `worker-prompt-craft`
- `lightweight-explorer`
- `code-atlas`
- `elegant`

For wave parallelism, worker ownership rules, and the litmus test used in Step 3 (wave composition) and Step 5 (parallel execution), consult `references/concurrency-policy.md`. It is loaded on demand rather than as a separate top-level skill.

Then load every additional skill that is actually applicable to the touched scope before finalizing the plan. If the work touches a Next.js app, also load:

- `next`
- `turbopack`

Always load the orchestration skill before the research fan-out for implementation-ready plans:

- `team`

## Parallel Research Fan-Out

When `$task-creator` is building an implementation-ready task list, use parallel subagents during the research gate before drafting the plan. Keep these workers read-only and split them by evidence type:

- `map`: Code Atlas entrypoints, owning apps, packages, routes, files, symbols, current consumers, dependencies, generated outputs, tests/checks, and exact add/update/remove surfaces.
- `context`: upstream docs, MCP evidence, framework behavior, and repo rules or skills that govern the scope.
- `details`: data flow, call paths, type/schema boundaries, edge cases, tests, generated outputs, and runtime surfaces.
- `skeptic`: unresolved assumptions, contradictions, missing checks, DRY opportunities, over-preserved compatibility, and risks to the elegant end state.

Each research worker must return scope covered, findings, file references/source links/command evidence, uncertainties or contradictions, blockers, recommended next step, and a change-inventory slice that itemizes files, routes, consumers, dependencies, generated outputs, and check surfaces as `add`, `update`, `remove`, or `unchanged/excluded`. The parent waits for all research workers, compares their results, resolves contradictions with direct source reads or MCP evidence, and only then creates the task list. Do not turn unresolved research into placeholder implementation tasks.

If no subagent or delegation tool is exposed after the correct tool-discovery pass, do not silently downgrade broad planning to local-only exploration. State the missing delegation tool as a blocker for broad implementation plans. For a narrow single-owner plan where direct evidence can prove the complete inventory, create the fallback execution record with `Parallel research fan-out: not available after tool discovery` and list the exact local evidence that replaces each worker slice.

## Step 1: Resolve scope and remove assumptions first

1. Do not create or present a plan yet. First resolve the workstream target, owning surfaces, runtime, available task/status tooling, persistence needs, and evidence requirements.
2. Identify the owning apps, packages, routes, configs, and runtime surfaces before planning implementation.
3. When the input is an existing plan, pasted task list, implementation summary, or user-labeled stale/revised plan, reconcile it against the live repo before carrying tasks forward. Treat completed items as evidence records, obsolete items as removed scope, and changed targets as the new current-state task shape.
4. Build a scope ledger from current repo evidence before locking tasks: intended owner paths, current dirty/untracked paths that intersect the target, generated mirrors that will be refreshed, and any Supabase migration manifest that would apply. Unrelated dirty files, pending migrations, or pre-existing generated drift stay excluded unless the user explicitly expands the task to own them.
5. Build the change inventory before locking tasks. Every planned add, update, removal, and explicit non-change must be itemized for files, routes, consumers, dependencies, tests/checks, generated outputs, and external rollout surfaces. A summarized bucket such as "affected files when known" is not enough.
6. If the plan establishes or standardizes behavior, build an enforcement-surface ledger before locking tasks. Identify the canonical policy owner and every runtime check that must make the standard real: rules, skills, hooks, guards, package scripts, generated mirrors, CI checks, and rollout/state surfaces. A standard without an enforcement owner is not plan-complete.
7. Run the required repo trace workflow before making architecture or execution claims:
   - Code Atlas entrypoint, impact, pre-edit, or health queries first for repo-wide code ownership, route, dependency, consumer, DB, API, worker, generated-surface, and deploy evidence
   - repo owners, workspace graph, and AST/LSP source inspection next for exact code ownership, route, and consumer evidence
   - workspace and package graph next
   - request/runtime entry after that
   - route tree after that
   - symbol flow after route ownership is clear
   - live runtime proof last when the claim depends on active request state
   - for Codex modernization work, stabilize dependency/test evidence before broad refactors and split changes into small validation-backed waves
8. Use direct reads only for known owning files. Use the Parallel Research Fan-Out contract for broad discovery across multiple surfaces when delegation tooling is exposed. In Codex, discover the delegation tool first and record the result before falling back.
9. Complete all Code Atlas queries, code search, route discovery, package graph inspection, MCP validation, and applicable skill reads before drafting the implementation plan or task list. Do not create placeholder tasks for research that has not happened yet.
10. Build an assumption ledger before drafting any plan. Include every assumption needed to choose scope, owners, dependencies, sequencing, compatibility posture, verification, data/security handling, runtime state, external system behavior, or user-visible behavior. Do not limit the ledger to "important" assumptions if a smaller unchecked assumption would still influence the plan.
11. Convert every assumption into one of:

- verified fact with evidence from source, command output, logs, MCP data, official docs, or runtime proof
- explicit user decision received before planning
- removed assumption because the plan no longer depends on it

12. If any assumption cannot be resolved, stop before plan creation and present only a blocker report with the exact missing fact, the evidence already checked, and the user decision or external access needed. Do not include blocked implementation waves, placeholder research tasks, or "to be confirmed later" notes inside a task list.
13. The final plan MUST present `Open assumptions: none (all validated)` before any implementation wave is locked. An unresolved assumption is a blocker, not a footnote.
14. Resolve research and investigation before creating implementation waves. If unresolved blockers remain, stop after presenting them and keep implementation tasks blocked.
15. While exploring, require the research agents to identify DRY opportunities with evidence:

- duplicate logic
- overlapping abstractions
- wrappers that only preserve legacy paths
- compatibility layers or transitional branches
- extraction, consolidation, or deletion opportunities
- contradictions between current implementation, user invariants, upstream docs, and repo ownership rules

16. Feed those DRY findings into the plan instead of treating them as optional commentary. If duplication materially affects the design, create explicit cleanup or consolidation tasks.
17. After the evidence above is complete, restate the target as if there were no existing consumers and explicitly declare the execution lens:
    - `elegant` by default
    - `compatibility-constrained` only when the user explicitly requires it

## Step 2: Validate against applicable skills and MCP servers

1. Double-check the emerging plan against the applicable repo skills before creating task records or locking task order.
2. Use the relevant MCP server whenever it can validate a planning claim better than memory.
   - For code-map MCP context, follow Rule 10's local `supaschema.code_atlas_query` policy; still reproduce plan-owned inventory with `pnpm code-atlas:query` because it is guardable in this repo.
3. For Next.js work:
   - call `mcp__next_devtools__init`
   - read `nextjs-docs://llms-index`, then fetch the exact `mcp__next_devtools__nextjs_docs` page for any Next.js behavior you rely on
   - call `mcp__next_devtools__nextjs_index`
   - if a dev server is available, use `mcp__next_devtools__nextjs_call` with `toolName: "get_routes"` to validate the impacted routes
   - verify route-affecting work against the live route set before and after changes
4. When bundler behavior, route rebuild scope, or request/build tracing matters, use the `turbopack` skill and inspect the real Turbopack trace surface rather than guessing:
   - `.next/dev/trace-turbopack`
   - `npx next internal trace .next/dev/trace-turbopack`
   - route-specific build filtering such as `next build --debug-build-paths`
5. Apply the same rule to other domains: Supabase, Vercel, GitHub, and other MCP-backed surfaces should be consulted when they materially validate the plan.

## Step 3: Create or update the persistent task list

1. Create the persistent task list only after Steps 1 and 2 are complete and the assumption ledger has zero unresolved entries. Research tasks may appear in the list only as completed evidence records, not as placeholders for research that still needs to happen before planning.
2. In Claude Code, use `TaskList` first. Reuse the active task list when it already matches this workstream; otherwise create a new persistent list.
3. If Claude `TaskCreate`/`TaskList`/`TaskUpdate`/`TeamCreate` surface as deferred tools (schemas not loaded), call `ToolSearch({ query: "select:TeamCreate,TaskCreate,TaskList,TaskUpdate,TaskGet" })` to materialize them. Do not fall back to a textual task system while the schemas are reachable via ToolSearch.
4. After the first Claude `TaskCreate`, capture the task-list UUID and keep using that list for the full workflow.
5. In Codex, use `update_plan` as the visible session progress tracker when native Claude TaskList tools are unavailable. Preserve wave order and current status there, and keep at most one plan item `in_progress`.
6. In Codex, do not treat `update_plan` as a persistent task list: it has no UUID, arbitrary metadata, dependency graph, or cross-session durability. When native persistent task-list tools are unavailable, create a textual task system in the transcript or plan history that is explicitly marked as the authoritative fallback execution record and mirror the current wave/status in `update_plan`; a fallback record is required for `$task-creator` workstreams because task records, dependencies, ownership metadata, and verification detail are part of the contract. This fallback is not a Codex-native task-list object.
7. In Codex, do not use `create_goal` as a task-list substitute. Use `create_goal` only when the user explicitly requested a goal or budgeted long-running objective; use `get_goal` for status inspection; use `update_goal` only when the explicit goal is genuinely complete or blocked under Codex goal rules.
8. If additional MCP, plugin, connector, task-list, or delegation tools are needed and not already exposed, use `tool_search` before falling back to prose-only tooling. Search for the exact capabilities needed, including `TaskList`, `TaskCreate`, `TaskUpdate`, `TaskGet`, `TeamCreate`, and `spawn_agent`-compatible delegation tools when subagents are required. If no persistent task-list facility remains available after tool discovery, the textual fallback execution record is authoritative.
9. Build the task list in execution order using sequential waves:
   - Wave 0: completed orchestration and research evidence, including parallel research synthesis or the recorded unavailable-delegation blocker
   - Wave 1: foundation tasks with no dependencies
   - Wave 2+: independent implementation tasks that depend on prior waves
   - final wave: `adversarial-verification` first, then `update`; no task may follow the `update` task
10. Every task must include:

- `subject`
- `activeForm`
- exact purpose
- exact write scope or evidence-gathering scope
- exact change-inventory slice, including files, routes, consumers, dependencies, tests/checks, generated outputs, and external rollout surfaces to add, update, remove, or explicitly exclude
- required verification
- required skills
- affected files, tests, and packages
- DRY or simplification intent when duplication or legacy complexity was found
- whether the task deletes, consolidates, or preserves legacy surfaces

Description shape for the TaskCompleted gate (`policy-taskcompleted-task-completion-command.mjs`):

- The gate runs two independent checks at completion time. Either failing blocks `TaskUpdate(status="completed")`.
- Check A — verbs without backticks. The verb regex is word-boundary anchored (`/\b(verify|run|runs|ran|test|tested|pass|passes|passed|confirm|confirmed|check|checked|validate|validated|reproduce|assert|execute|executed|dispatch|dispatched)\b/i`). It matches the listed verb forms exactly at word boundaries. It does NOT match longer words that contain those verbs as substrings (`transactions`, `passing`, `verification`, `unchecked`, `running`, `tested`-as-substring-of-`untested`-no-actually-`tested`-IS-in-the-list, etc.). Hyphens act as word boundaries (`pass-through` matches because `pass` is followed by `-`). When in doubt, run the regex — do not guess. If a real verb in the list appears without any backticked command in the same description, the gate fires.
- Check B — backticks without matching Bash. Each backticked candidate that looks like a command is extracted. The first 3 non-flag tokens of the committed command must be a prefix of the first 3 non-flag tokens of an actual `Bash` tool_use within the last 5 user turns. The match runs on the entire Bash invocation as one string, so chained Bash commands (`export X=Y; pnpm …`, `cd foo && pnpm …`) push the committed command past position 3 and fail the match. Run committed commands BARE in Bash. If env must be set for one invocation, prefer the inline form `NODE_EXTRA_CA_CERTS=path pnpm …` and commit the same prefix in backticks, OR set env in a prior Bash call where supported (note that env does not persist across separate Bash tool calls in this harness).
- Put real shell commands in backticks only when the task commits to running them. Never put non-command code snippets, file paths, or expression fragments in backticks — the gate treats anything matching the command shape as a committed verification command.
- When the evidence is tool-based rather than a shell command (e.g. `mcp__cclsp__get_diagnostics`, MCP probes, generated artifacts), drop verification verbs from the description and use evidence-shaped prose: "Evidence obtained: …" naming the specific artifact. Avoid the phrase "Evidence obtained: ran X" — `ran` is in the verb list.
- Subagent-side commands are invisible to the gate. Orchestrators that delegate verification must either re-run the committed command in the parent before `TaskUpdate(status="completed")` or rewrite the description to name subagent evidence without verification verbs.
- **Filename trip-ups.** The verb regex matches inside filenames too. `documents.test.ts` contains `\btest\b` (period is non-word, so `test` has word boundaries on both sides) and trips Check A. Same for `gse-guidelines.test.ts`, `income.test.ts`, etc. When listing files in a description, either omit the `.test.ts` segment (write "the matching spec file" instead) or pair the description with a backticked command that actually ran in the last 5 turns. Verified word-boundary collisions in this repo: `.test.`, `pass-through`, `pass-throughs`, `passing` (no — `passing` is `pass` + `ing`, no boundary), `unchecked` (no — `checked` has `un` prefix on the left). Test the regex against the literal description text before committing.
- **TaskUpdate atomicity.** When `TaskUpdate(description, status="completed")` is rejected by the gate, the description change rolls back too — the call is atomic. To recover: first `TaskUpdate({ taskId, description: "<new prose>" })` in isolation, verify the change via `TaskGet`, then `TaskUpdate({ taskId, status: "completed" })` as a separate call. Trying both in one call after a prior rejection re-trips because the live description never updated.

11. Use task metadata that makes wave execution auditable:

- `wave`
- `agentType`
- `executionLens`
- `compatibilityConstraint`
- `requiredSkills`
- `parallelSafe`
- `maxConcurrentAgents`
- `requiresVerificationAgent`
- `files.creates`
- `files.modifies`
- `files.removes`
- `files.tests`
- `routes.creates`
- `routes.modifies`
- `routes.removes`
- `consumers.creates`
- `consumers.modifies`
- `consumers.removes`
- `dependencies.creates`
- `dependencies.modifies`
- `dependencies.removes`
- `generated.creates`
- `generated.modifies`
- `generated.removes`
- `packages`
- `legacyDisposition`

12. Add `blockedBy` dependencies so the task list is sequential even when execution inside a wave is parallel.
13. No two tasks in the same wave may edit the same file. Move shared-file edits into a later serialized wave.
14. No task may carry `TODO`, `FIXME`, `TBD`, `???`, `<placeholder>`, "decide later", "will be filled in", or any other deferred-decision marker in its `subject`, `activeForm`, description, metadata, or referenced file plan. Every gap is resolved before the task is created. If a value genuinely cannot be known until a prior task completes, encode the dependency via `blockedBy` and write the task against the post-dependency state explicitly — do not stub it.

## Step 4: Validate the task list before execution

1. Re-check the wave plan for:
   - unresolved assumptions (must be zero)
   - resolved-assumption evidence for every scope, owner, sequencing, verification, risk, and behavior claim
   - missing owner context
   - missing skills
   - missing MCP validation
   - missing explicit execution lens
   - missing change inventory for files, routes, consumers, dependencies, tests/checks, generated outputs, or rollout surfaces
   - overlapping file ownership inside a wave
   - missing final `adversarial-verification` then `update` tasks
   - zero unresolved assumptions — the Step 1 contract is satisfied for every task; this gate fails closed if any remain
   - zero placeholders, TODO markers, or deferred-decision strings in any task description, metadata, or referenced artifact
   - zero tasks marked or framed as "deferred", "future work", "out of scope but tracked", or equivalent — every task on the list is committed to completion in this workstream
   - enforcement-surface ledger present when the plan standardizes behavior, with every new standard mapped to a rule/skill/hook/guard/check owner
2. If the work touches routes, confirm the route inventory again with Next DevTools before dispatching implementation agents.
3. If the work touches bundler or runtime-trace-sensitive behavior, confirm the Turbopack trace plan before dispatching implementation agents.
4. Do not start implementation until the plan is validated against the applicable skills and MCP evidence.
5. Before executing implementation waves, ensure the task list records the post-research target, execution lens, and whether the `elegant` path replaces a compatibility-preserving path. If the user explicitly requires backwards compatibility or a minimal patch, record that constraint in the task list.
6. Do not present an implementation plan without stating which tasks are running under the `elegant` lens and which tasks, if any, are intentionally compatibility-constrained.
7. If the task list is presented in prose instead of a TaskList UI, each wave summary must call out the elegant effect:
   - what is being deleted
   - what is being consolidated
   - what is intentionally preserved and why

## Step 5: Execute the waves

1. Execute wave by wave.
2. In Claude Code, use 2-4 parallel foreground subagents within a wave when the write scopes are disjoint and the user requested orchestrated execution.
3. In Codex, use `multi_tool_use.parallel` for independent local reads, searches, and other non-conflicting tool calls. This is local tool parallelism, not worker delegation.
4. In Codex, use subagents only when a spawn-agent-compatible tool is exposed and the user or `$task-creator` workflow has authorized delegation. If implementation delegation is not authorized, execute locally and preserve the same wave boundaries in `update_plan`.
5. Run delegated agents in the foreground so they retain MCP access, route inspection, docs access, and permission passthrough. Do not use background agents for this workflow.
6. Every delegated prompt must be self-contained. Never assume the worker saw the parent conversation.
7. Every delegated prompt must include:
   - why the task exists
   - whether it is evidence-gathering or may modify files
   - the task's execution lens: `elegant` or `compatibility-constrained`
   - exact files, modules, symbols, or search scope
   - exact inventory slice: files, routes, consumers, dependencies, tests/checks, generated outputs, and rollout surfaces to add, update, remove, or exclude
   - relevant `AGENTS.md` and `.claude/rules/*` owners
   - required skills to invoke before acting
   - relevant MCP tools to consult
   - completion criteria
   - required verification
   - exact artifact to return
   - a reminder that other agents may be working elsewhere in the repo
8. For implementation and refactor tasks, require the agent to use the `elegant` skill as the execution lens unless the task metadata explicitly records a compatibility constraint and explains why the elegant path is intentionally not being taken.
9. Enforce the `elegant` rules during execution:
   - prefer deletion over adaptation when old paths exist only for legacy consumers
   - remove wrappers, shims, and transitional branches unless explicitly required
   - choose the narrowest owner and simplest clean architecture
   - optimize for directness and maintainability before cleverness
10. Wait for all delegated agents in the wave, validate the important claims they return, update task status, then move to the next wave.
11. If agents disagree, read the source directly, resolve the contradiction, and update the task list before continuing.

## Step 6: End with a verification wave and a clear report

1. Always create the last two tasks in this order: `adversarial-verification`, then `update`.
2. The `adversarial-verification` task must load the `adversarial-verification` skill, verify the touched scope with the narrowest meaningful checks plus any required cross-cutting checks, and include at least one failure-oriented probe against the change inventory.
3. If route behavior changed, re-run the live route validation and route-specific proof during `adversarial-verification`.
4. If bundler-sensitive behavior changed, re-check the Turbopack trace or route-specific build proof during `adversarial-verification`.
5. The final `update` task must load the `update` skill and focus on consolidating, updating, and correcting repo documentation and context surfaces for the touched scope: canonical rules, skills, hooks, AGENTS briefs, generated mirrors, sync owners, and documentation references. It must sync generated mirrors when the owner matrix requires it. No implementation, verification, or documentation task may follow `update`.
6. Present:
   - task-list UUID for Claude TaskList workflows; for Codex, report the `update_plan` status, active goal status only if a goal was explicitly created, and textual fallback record status when one was required
   - execution lens summary for the whole workstream
   - elegant end state in one short paragraph
   - resolved assumptions
   - blockers that remain
   - deferred tasks: must be zero — any remaining work is a blocker, not a deferral
   - wave-by-wave task summary
   - DRY findings that changed the task list
   - where the `elegant` approach replaced a compatibility-preserving option
   - change inventory summary for files, routes, consumers, dependencies, generated outputs, and rollout surfaces
   - which skills and MCP servers validated the plan
   - which routes were validated
   - which traces or build-path checks were used
   - final verification status
7. Completion contract — the workstream is not reported as done until:
   - every task on the list has reached `status: "completed"`
   - zero tasks remain in `pending`, `in_progress`, `cancelled`, or any carried-forward state
   - zero placeholders or TODO markers remain in any task surface or in the code those tasks produced
   - any task that cannot be completed is escalated as a blocker before the final report — silent deferral is prohibited

   If a blocker emerges that prevents completing a task, stop and surface it. Do not rewrite the task to a smaller scope, do not move it to a "follow-up" list, and do not mark it complete with a caveat.

Do not create or present a plan if research is still open, assumptions are still unresolved, or the task list has not been validated against the applicable skills and MCP servers.
