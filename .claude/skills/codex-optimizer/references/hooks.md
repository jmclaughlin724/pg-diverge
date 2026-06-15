# Hooks Playbook

Sources verified 2026-05-27:

- https://developers.openai.com/codex/hooks
- https://developers.openai.com/codex/config-advanced#hooks
- https://developers.openai.com/codex/config-reference

## Intent

Use native Codex hooks only when a Codex runtime event needs deterministic intervention that instructions or rules cannot provide. Hooks are for event-time behavior: tool gating, approval decisions, extra context, result blocking, and stop continuation.

## Decide Whether A Hook Is Warranted

Use a hook when:

- The behavior must run at a specific event such as `SessionStart`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `UserPromptSubmit`, `SubagentStart`, `SubagentStop`, or `Stop`.
- The behavior needs tool payload data, approval payload data, or transcript context.
- A shell rule cannot express the policy.

Do not use a hook when:

- A short instruction would solve the issue.
- A Codex rule can allow, prompt, or forbid the command.
- The goal is to mirror Claude hook behavior into Codex. That bridge is retired in this repo.

## Authoring Steps

1. Pick the earliest event that can prevent the problem. Prefer `PreToolUse` over `PostToolUse` for blocking side effects. For `apply_patch` remediation flows, virtually apply the patch or otherwise inspect the complete resulting file before execution; pre-deny source-policy and contract-ownership findings when the result would introduce or preserve violations. Use `PostToolUse` as a fail-closed backstop, not as permission to land known-bad writes.
2. Keep Anilize project hook matching out of native `matcher` strings. Register one broad command hook per event and route by parsed `tool_name`, `tool_input`, and event payload inside the dispatcher. `UserPromptSubmit` and `Stop` ignore matchers.
3. Use `type = "command"` for executable hooks. Other hook handler types may parse but are skipped today.
4. Set timeouts deliberately. The default command timeout is 600 seconds.
5. Make output contracts explicit: deny, allow, add context, rewrite supported input, block result handling, or continue.
6. Keep repo-local command paths rooted at the git root.
7. Keep only one hook representation per config layer: prefer `.codex/hooks.json` for Anilize project hooks, not mixed inline `[hooks]` tables plus `hooks.json`.
8. For tool-event policies that share an event and need deterministic order, short-circuiting, or non-duplicative feedback, register one native project command hook and delegate to imported policy adapters in-process.

## Runtime And Trust

- Hooks are enabled by default through the canonical `features.hooks` key. Do not use the deprecated `features.codex_hooks` alias.
- Codex loads matching hooks from every active hook source. Higher-precedence config layers do not replace lower-precedence hooks.
- Multiple matching command hooks for the same event launch concurrently. Do not rely on hook ordering, or on one hook preventing another matching hook from starting.
- Non-managed command hooks must be reviewed and trusted with `/hooks` before they run. New or changed hooks are skipped until trusted. Use `--dangerously-bypass-hook-trust` only for automation that vets hook sources outside Codex.
- Project-local hooks load only when the project `.codex/` layer is trusted.
- `PreToolUse` and `PostToolUse` intercept supported Bash calls, file edits through `apply_patch`, and MCP tool calls. They do not intercept `WebSearch`, non-shell non-MCP tools, or every shell path; treat hooks as guardrails, not complete enforcement boundaries.

## Event Guidance

- `SessionStart`: add startup context for `startup`, `resume`, `clear`, or `compact` sources.
- `PreToolUse`: deny, add context, or rewrite supported tool inputs before execution.
- `PermissionRequest`: approve, deny, or decline approval prompts before they reach the user or reviewer.
- `PostToolUse`: add context, replace result handling, or block result handling after a supported tool produces output. It cannot undo side effects.
- `PreCompact` and `PostCompact`: run around `manual` or `auto` compaction.
- `UserPromptSubmit`: inspect the prompt before processing; matcher is ignored.
- `SubagentStart`: add context for a subagent. It cannot block subagent creation.
- `Stop` and `SubagentStop`: return control to Codex when unresolved work remains. They expect JSON on stdout for exit `0`; plain text stdout is invalid.

For file mutation tools, be precise about enforcement timing. A `PreToolUse` deny prevents the tool call. A `PostToolUse` block interrupts Codex result handling after a successful tool call, but any file edit already happened. Policies that must prevent new source violations require PreToolUse inspection of the resulting content; PostToolUse alone is not prevention.

## Output Contracts

- `PreToolUse` deny: return `hookSpecificOutput.hookEventName = "PreToolUse"`, `permissionDecision = "deny"`, and `permissionDecisionReason`. The older top-level `decision = "block"` shape and exit code `2` with stderr also block. `permissionDecisionReason` is fed to the model; add a top-level sibling `systemMessage` field when the block needs a user-visible recovery instruction the user must read and act on (e.g., a literal phrase to type back).
- `PreToolUse` rewrite: return `permissionDecision = "allow"` with `updatedInput`. Bash and `apply_patch` rewrites require `updatedInput.command` as a string.
- `PermissionRequest`: return `hookSpecificOutput.decision.behavior = "allow"` or `"deny"`. Any deny wins. Do not return `updatedInput`, `updatedPermissions`, or `interrupt`; those fields fail closed today.
- `PostToolUse`: `decision = "block"` replaces Codex result handling with hook feedback; it does not undo the completed tool. `continue: false` also replaces normal result processing after the tool has already run.
- `Stop` and `SubagentStop`: `decision = "block"` means continue the turn or subagent, not reject the result. `continue: false` takes precedence over continuation decisions.
- Plain stdout is ignored by `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, and `PostCompact`; it is context for `SessionStart`, `SubagentStart`, and `UserPromptSubmit`.

## Anilize Delivery Pattern

- `pnpm sync:llm` must not handle hooks.
- Claude hook wiring stays in `.claude/settings.json` and `.claude/hooks/**`.
- Native Codex hook configuration stays in `.codex/hooks.json` and `.codex/hooks/**`.
- Codex hooks are manually authored native Codex adapters with Codex payload and output contracts. They are created and revised separately from Claude hooks; when they enforce the same policy, share policy helpers or rule references instead of mirroring hook files or assuming paired edits. Manual authoring means source ownership only: hooks are not synced from Claude wiring or `pnpm sync:llm`.
- Do not register overlapping native Codex tool-event command hooks for the same project event when those policies should be sequenced or produce one feedback item. Use a thin dispatcher as the native hook entrypoint and keep each policy owner in an imported adapter.
- Keep native Codex hook entrypoints thin: parse Codex hook input, delegate policy semantics to shared repo helpers, and emit Codex-shaped JSON. Classification of shell syntax, code syntax, imports, file edits, or mutation intent must use ASTs, structured parsers, or existing shared structured helpers; do not hand-roll parsers or use ad hoc regex for those classifications. Native Codex matcher regex must not be used as an Anilize policy selector.
- Treat existing regex-based hook classifiers as refactor inventory. When a touched hook classifies source behavior, migrate that classification to an AST, a structured parser, or a shared structured helper in the same change.
- For `apply_patch` and file-edit checks, parse the patch or resulting file into a structured representation before deciding ownership, imports, deletes, or mutation intent.
- For shell checks, parse the command with the shared command parser before deciding whether a command is read-only, write-like, destructive, or Supabase-mutating.
- For SQL checks, use the shared SQL parser/statement model before deciding DDL, RLS, schema ownership, contract exposure, or generated-type impact.
- Separate upstream-verified guidance from Anilize adapter policy in hook messages. Do not label repo hardening rules, package paths, or local workflow choices as upstream best practice unless the upstream source directly says so.
- Catch top-level runtime errors and return structured Codex hook output with the hook path, source file/line/column when available, the underlying error, and remediation guidance. Do not leave Codex with only `hook exited with code 1`.
- Do not recreate the retired Claude-to-Codex hook manifest, sync script, or bridge runner.

## Consolidation Checklist

- Keep separate Codex hook adapters when they represent distinct policy owners, event lifecycles, or failure domains. When those adapters share one tool-event lifecycle and need deterministic order or short-circuiting, import them into one dispatcher entrypoint instead of registering overlapping native command hooks.
- Merging unrelated native registrations does not create ordering guarantees; deterministic sequencing must happen inside one command process.
- Consolidate duplicated infrastructure instead: Codex JSON output builders, stdin parsing, runtime-error formatting, and generic hook payload target extraction should live in shared helpers.
- Keep native adapters thin. They should normalize the Codex payload, call shared policy helpers, and emit Codex-shaped JSON.
- Keep generic hook target parsing under `scripts/hooks/**`; keep domain policy under the owning domain, such as `scripts/guards/policies/supabase/**`.
- For PostToolUse sync-style adapters, batch work by real lifecycle boundary when one command refreshes the whole surface.
- Validation for Codex hook changes should include the shared helper tests, every registered adapter test, `pnpm hooks:check`, and JSON parsing for `.codex/hooks.json` when wiring changes.
