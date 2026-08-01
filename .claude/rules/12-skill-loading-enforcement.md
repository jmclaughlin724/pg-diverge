---
description: Required skill routing, observable skill loads, minimal hook state, and narrow parser-backed enforcement.
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

# Rule 12 — Skill loading and narrow hook enforcement

## Contract

Repository hooks are guardrails. They do not prove user authorization, confine filesystem access, establish complete command comprehension, or replace the platform permission model.

Hook denials require a positive classification owned by this rule: an unresolved required skill in the main session, a parser-confirmed Bash safety conflict, a generated-artifact edit conflict, a schema-workflow conflict, or a success claim contradicted by unresolved structured verification failure evidence. Unexpected parser, state, or hook failures emit a visible warning and make no blocking decision.

## Event behavior

- `SessionStart` resets or expires minimal session state and emits no standing context. `SessionEnd` removes that session state and is silent on success.
- `UserPromptSubmit` matches explicit skill tokens and curated token-delimited keywords from parsed skill frontmatter. Prompt text is never persisted.
- Context `PreToolUse` is registered for `Agent|Bash|Edit|Glob|Grep|MultiEdit|NotebookEdit|Read|Task|WebFetch|WebSearch|Write|apply_patch` in both source Claude settings and the generated Codex configuration.
- In the main session, a pending skill blocks governed tools until an observable load action succeeds. A structurally valid full-load action itself is allowed through the gate.
- `Read` counts only when it targets one exact discovered `SKILL.md`, requests no partial range, succeeds, and its structured result exactly equals the complete file. A shell read counts only when the shell AST proves a literal, unpiped, uncaptured, unredirected `cat` of discovered `SKILL.md` files and the structured stdout exactly equals their complete contents. Wildcards, searches, partial reads, unknown skills, failed calls, and failure events never count as loads. A successful `Skill` invocation counts only when its normalized name exists in the discovered inventory.
- `SubagentStart` and an in-subagent `PreToolUse` provide pending-skill context without denying the subagent. Claude `TaskCompleted` blocks only while required skills remain unresolved. Codex does not register `TaskCompleted`.
- Context `PostToolUse` is limited to `Bash|Read|Skill`. Claude `PostToolUseFailure` is limited to `Bash` and records only failed verification outcomes.
- `Stop` and `SubagentStop` block only an explicit successful verification claim whose matching domain has a latest recorded outcome of failure. No evidence is unknown and allowed; a later matching success resolves the conflict. Hedging, decision menus, incident formatting, command-not-found text, and subjective response style are not hook decisions.

## Parser-backed Bash boundary

`scripts/agent-hooks/shell-command.mjs` parses shell source with `unbash`; option structure is interpreted with Node's `parseArgs`. PostgreSQL literals are classified by the repository's libpg-query parser in `scripts/agent-hooks/postgres-ddl.mjs`. File triggers use parsed YAML frontmatter and `minimatch` glob semantics. Do not replace these owners with regular-expression scanning or command-text allowlists.

The Bash hook blocks only:

- literal secret values in argv or direct `cat` display of known secret-bearing files, excluding example, sample, default, and template files;
- recursive forced deletion whose parsed target is dynamic or resolves to `/`, the user home, the repository root, or an ancestor of the repository; and
- literal raw-DDL arguments passed directly to a known PostgreSQL command interface.

Git, branch, reset, push, merge, and worktree commands are outside hook enforcement. SQL files, stdin, and heredocs are outside the literal-DDL classifier. Unknown or unparseable shell shapes are allowed. Policy and platform permissions still apply to every allowed command.

## State

- Canonical state lives at `<repo>/.tmp/agent-hooks`; `STATE_DIR` exists only for isolated tests.
- Directories use mode `0700`; state and lock files use `0600`. Writes are atomic and serialized.
- State expires after 24 hours and is bounded to 20 turns and 50 evidence records.
- Persist only session and turn identifiers, skill identifiers, trigger codes, timestamps, and verification domain/outcome records. Never persist prompts, command text, transcripts, responses, or raw tool output.
- Skip unchanged writes. Treat malformed state as empty, repair it on the next mutation, and emit a visible warning instead of denying a tool.
- Session startup may purge legacy fragmented state only from this checkout's canonical state directory.

## Verification

```bash
npm run sync:llm
npm run guard:agent
npm test -- tests/agent-hooks/agent-hook-core.test.ts tests/agent-hooks/agent-hooks.test.ts
```

## Done means

- Required skills block only the main governed tool flow and clear only after a successful complete observed load.
- Bash denials come from the parser-backed positive classifications above; Git and unparseable shapes are not denied.
- Verification state contains domains and outcomes only, and Stop checks only unresolved failure contradictions.
- Lifecycle hooks are silent, state is private and bounded, unexpected failures are visible and non-blocking, and generated registrations match the event contract.
