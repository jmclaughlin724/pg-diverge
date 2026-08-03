---
description: Required skill routing, observable skill loads, minimal hook state, and narrow parser-backed enforcement.
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

- `SessionStart` resets or expires minimal session state and emits no standing context. `SessionEnd` removes that session state and is silent on success.
- `UserPromptSubmit` matches explicit skill tokens and curated token-delimited keywords from parsed skill frontmatter. Prompt text is never persisted.
- Context `PreToolUse` is registered for `Agent|Bash|Edit|Glob|Grep|MultiEdit|NotebookEdit|Read|Task|WebFetch|WebSearch|Write|apply_patch` in both source Claude settings and the generated Codex configuration.
- In the main session, a pending skill blocks governed tools until an observable load action succeeds. A structurally valid full-load action itself is allowed through the gate.
- `Read` counts only when it targets one exact discovered `SKILL.md`, requests no partial range, and its structured result exactly equals the complete file. A shell read counts only when the shell AST proves one literal, top-level, unpiped, uncaptured, unredirected `cat` of discovered `SKILL.md` files and the structured output exactly equals their complete contents. Exact complete delivery is positive load proof when a runtime omits an outcome field; an explicit failed outcome still rejects the load. Wildcards, searches, partial reads, compound shell programs, unknown skills, failed calls, and failure events never count as loads. A successful `Skill` invocation counts only when its normalized name exists in the discovered inventory.
- `SubagentStart` and an in-subagent `PreToolUse` provide pending-skill context without denying the subagent. Claude `TaskCompleted` blocks only while required skills remain unresolved. Codex does not register `TaskCompleted`.
- Context `PostToolUse` is limited to `Bash|Read|Skill`. Claude `PostToolUseFailure` is limited to `Bash` and records only failed verification outcomes.
- Verification outcomes are recorded only when the parsed shell control flow and CLI semantics make a structured outer tool status evidence for that domain. A successful fail-fast `&&` chain can prove each recognized check; help/version calls, status/list/API retrieval, `||` masking, sequential commands, pipelines, substitutions, nested shell programs, ambiguous multi-domain failures, and tool responses without a structured outcome record nothing. State stores only the resulting domain and outcome, never the command.
- `Stop` and `SubagentStop` block only a current explicit successful verification claim whose matching domain has a latest recorded outcome of failure. Historical success descriptions are not current success claims. No evidence is unknown and allowed; a later matching success resolves the conflict. Hedging, decision menus, incident formatting, command-not-found text, and subjective response style are not hook decisions.

## Parser-backed Bash boundary

`scripts/agent-hooks/shell-command.mjs` parses shell source with `unbash`; option structure is interpreted with Node's `parseArgs`. PostgreSQL literals are classified by the repository's libpg-query parser in `scripts/agent-hooks/postgres-ddl.mjs`. File triggers use parsed YAML frontmatter and `minimatch` glob semantics. Do not replace these owners with regular-expression scanning or command-text allowlists.

The Bash hook blocks only:

- literal secret values in argv or direct `cat` display of known secret-bearing files, excluding example, sample, default, and template files;
- recursive forced deletion whose parsed target is dynamic or resolves to `/`, the user home, the repository root, or an ancestor of the repository; and
- literal raw-DDL arguments passed directly to a known PostgreSQL command interface.

Git, branch, reset, push, merge, and worktree commands are outside hook enforcement. SQL files, stdin, and heredocs are outside the literal-DDL classifier. Unknown or unparseable shell shapes are allowed. Policy and platform permissions still apply to every allowed command.

## State

- Canonical state lives at `<repo>/.tmp/agent-hooks`; `STATE_DIR` exists only for isolated tests.
- State and lock directories use mode `0700`; state and lock-owner files use `0600`. Writes are atomic and serialized.
- Skill discovery stays outside the lock and runs only for events that use the inventory. Each lock directory contains one ephemeral owner file with only a PID, random ownership token, and acquisition timestamp.
- Waiting processes prepare per-session candidate directories whose names bind the waiter PID and ownership token. A later acquisition removes only an empty candidate or its single expected owner file when that PID is definitely dead; live or malformed candidates remain visible, and age never grants ownership.
- `SessionStart` discards its own session's recognized lock owners before resetting that session's state, because a starting session has no live prior holder. This is the only reclaim path that does not consult process liveness; it is scoped to that one session's lock, and malformed owner files stay on disk for triage.
- Reclaim a lock only when its recorded process is definitely dead; never steal a valid live owner based on age. State commits and lock release require the exact ownership token, so a killed hook is recovered within the next acquire budget without allowing an earlier owner to remove or overwrite a successor.
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

## Failure behavior

Fix the canonical owner for the misbehaving check, then rerun the narrow hook test or `npm run guard:agent`. Do not weaken, skip, or hand-approve around a gate to close it out.

- Wrong skill denial or a missed pending skill: fix matching in `scripts/agent-hooks/skills.mjs` or the skill's `metadata.keywords`/`metadata.file-triggers`, not the caller's workaround.
- Wrong Bash allow or deny: fix the parser-backed classification in `scripts/agent-hooks/shell-command.mjs` or the PostgreSQL literal classifier in `scripts/agent-hooks/postgres-ddl.mjs`. Do not add a text allowlist or regex carve-out.
- Missing or wrong load proof: fix the observable-load detection in `scripts/agent-hooks/skills.mjs`. A full, exact `Read` or a single literal, unpiped `cat` of the discovered `SKILL.md` must count; a partial, wildcarded, or compound read must not.
- Wrong verification-domain evidence, or a false `Stop`/`SubagentStop` conflict: fix the command classification in `scripts/agent-hooks/command-evidence.mjs` or the claim parsing in `scripts/agent-hooks/response-claims.mjs`. Do not remove the success claim or the evidence record to dodge the check.
- An unexpected parser, state, or hook crash: fix the reported source location. The event stays a visible warning with no policy decision, never a silent pass and never a hard denial.

## Done means

- Required skills block only the main governed tool flow and clear only after a successful complete observed load.
- Bash denials come from the parser-backed positive classifications above; Git and unparseable shapes are not denied.
- Verification state contains only parser-attributed domains and outcomes, and Stop checks only unresolved current-claim failure contradictions.
- Lifecycle hooks are silent, state is private and bounded, unexpected failures are visible and non-blocking, and generated registrations match the event contract.
