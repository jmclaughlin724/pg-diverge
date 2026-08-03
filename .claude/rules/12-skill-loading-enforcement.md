---
description: Required skill routing, observable skill loads, and narrow parser-backed enforcement.
enforcement:
  type: enforced
paths:
  - ".claude/agents/**"
  - ".claude/hooks/**"
  - ".claude/settings*.json"
  - ".claude/skills/**"
  - ".agents/skills/**"
  - ".codex/agents/**"
  - ".codex/hooks*"
  - "scripts/agent-hooks/**"
  - "scripts/guards/agent-surface/**"
  - "tests/agent-hooks/**"
---

# Rule 12 - Skill loading and narrow hook enforcement

## Contract

Repository hooks are guardrails. They do not prove user authorization, confine filesystem access, establish complete command comprehension, or replace the platform permission model.

Hook denials require a positive classification owned by this rule: an unresolved required skill in the main session, a parser-confirmed Bash safety conflict, a generated-artifact edit conflict, a schema-workflow conflict, or a success claim contradicted by unresolved structured verification failure evidence. Unexpected parser, state, or hook failures emit a visible warning and make no blocking decision.

## Event behavior

- When `.codex/config.toml` sets `features.hooks = false`, already-loaded Codex hook entrypoints return no decision, context, or state mutation; Claude hooks are unaffected.
- `SessionStart` and `SessionEnd` validate their payloads and remain silent on success.
- `UserPromptSubmit` matches explicit skill tokens and curated token-delimited keywords from parsed skill frontmatter. Prompt text is never persisted.
- Context `PreToolUse` is registered for `Agent|Bash|Edit|Glob|Grep|MultiEdit|NotebookEdit|Read|Task|WebFetch|WebSearch|Write|apply_patch` in both source Claude settings and the generated Codex configuration.
- When the hook host supplies session state, a pending main-session skill blocks governed tools until an observable load action succeeds; the load action itself is allowed through the gate.
- `Read` counts only when it targets one exact discovered `SKILL.md`, requests no partial range, and its structured result exactly equals the complete file. A shell read counts only when the shell AST proves one literal, top-level, unpiped, uncaptured, unredirected read of discovered `SKILL.md` files through option-free `cat` or a read-only `sed` form using `-n`, `--quiet`, or `--silent` with a `1,<line>p` or `1,$p` expression, and the structured output exactly equals their complete contents. Exact complete delivery is positive load proof when a runtime omits an outcome field; an explicit failed outcome still rejects the load. Wildcards, searches, partial reads, compound shell programs, unknown skills, failed calls, and failure events never count as loads. A successful `Skill` invocation counts only when its normalized name exists in the discovered inventory.
- `SubagentStart` and an in-subagent `PreToolUse` provide pending-skill context without denying the subagent. Claude `TaskCompleted` blocks only while required skills remain unresolved. Codex does not register `TaskCompleted`.
- Context `PostToolUse` is limited to `Bash|Read|Skill`. Claude `PostToolUseFailure` is limited to `Bash` and records only failed verification outcomes.
- Verification outcomes are recorded only when parsed shell control flow and CLI semantics make the structured outer tool status evidence for that domain. State stores the domain and outcome, never the command.
- `Stop` and `SubagentStop` block only a current explicit successful verification claim contradicted by the latest recorded outcome for that domain. No evidence is unknown and allowed; a later matching success resolves the conflict.

## Parser-backed Bash boundary

`scripts/agent-hooks/shell-command.mjs` parses shell source with `unbash`; option structure is interpreted with Node's `parseArgs`. PostgreSQL literals are classified by the repository's libpg-query parser in `scripts/agent-hooks/postgres-ddl.mjs`. File triggers use parsed YAML frontmatter and `minimatch` glob semantics. Do not replace these owners with regular-expression scanning or command-text allowlists.

The Bash hook blocks only:

- literal secret values in argv or direct `cat` display of known secret-bearing files, excluding example, sample, default, and template files;
- recursive forced deletion whose parsed target is dynamic or resolves to `/`, the user home, the repository root, or an ancestor of the repository; and
- literal raw-DDL arguments passed directly to a known PostgreSQL command interface.

Git, branch, reset, push, merge, and worktree commands are outside hook enforcement. SQL files, stdin, and heredocs are outside the literal-DDL classifier. Unknown or unparseable shell shapes are allowed. Policy and platform permissions still apply to every allowed command.

## State

- Repository hook and MCP configurations do not synthesize or persist session state; each hook process uses only event-local in-memory state.

## Verification

```bash
npm run sync:llm
npm run guard:agent
npm test -- tests/agent-hooks/agent-hook-core.test.ts tests/agent-hooks/agent-hooks.test.ts
```

## Failure behavior

Fix the canonical owner for the misbehaving check, then rerun the narrow hook test or `npm run guard:agent`. Do not weaken, skip, or hand-approve around a gate to close it out.

- Wrong skill denial or a missed pending skill: fix matching in `scripts/agent-hooks/skills.mjs` or the skill's `metadata.keywords`/`metadata.file-triggers`, not the caller's workaround.
- Wrong Bash allow or deny: fix the parser-backed classification in `scripts/agent-hooks/shell-command.mjs` or the PostgreSQL literal classifier in `scripts/agent-hooks/postgres-ddl.mjs`. Do not add a text allowlist or regex carve-out.
- Missing or wrong load proof: fix the observable-load detection in `scripts/agent-hooks/skills.mjs`.
- Wrong verification-domain evidence or a false completion conflict: fix `scripts/agent-hooks/command-evidence.mjs` or `scripts/agent-hooks/response-claims.mjs`.
- An unexpected parser, state, or hook crash: fix the reported source location. The event stays a visible warning with no policy decision, never a silent pass and never a hard denial.

## Done means

- Complete observed loads are recognized through the exact tool and content rules above.
- Bash denials come from the parser-backed positive classifications above; Git and unparseable shapes are not denied.
- Verification conflicts use only parser-attributed domains and outcomes.
- Lifecycle hooks are silent, unexpected failures are visible and non-blocking, and generated registrations match the event contract.
