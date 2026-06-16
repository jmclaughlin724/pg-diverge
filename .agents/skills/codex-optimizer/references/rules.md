# Rules Playbook

Sources verified 2026-05-27:

- https://developers.openai.com/codex/rules
- https://developers.openai.com/codex/config-reference

## Intent

Use Codex rules for executable shell policy: allow, prompt, or forbid commands before they run. Do not use rules as long-form instructions. If the behavior is not command-prefix policy, put it in `AGENTS.md`, a skill, a subagent definition, or a hook.

## When To Add A Rule

- Add a rule when a command pattern is repeatedly safe, risky, or forbidden.
- Add a rule when approval prompts are too noisy for known-safe commands.
- Add a rule when a destructive or high-risk command must be blocked even if the agent tries it.
- Do not add a rule for a vague preference. Convert the preference into a command pattern first.

## Authoring Steps

1. Identify the exact command prefix. Prefer the shortest stable prefix that captures intent without catching unrelated commands.
2. Choose the decision: `forbidden`, `prompt`, or `allow`. Remember that forbidden wins over prompt, and prompt wins over allow.
3. Write a human-readable justification that explains the operational reason.
4. Add `match` and a nearby `not_match` for new or changed rules whenever feasible. Treat them as inline unit tests that Codex validates when loading the rule file, not as prose examples.
5. Account for common shell wrappers. Codex can split simple `bash -lc`, `sh`, and `zsh` wrappers, but complex shell syntax is treated conservatively.

## Testing A Rule

Use upstream policy checks for rule behavior:

```bash
codex execpolicy check --pretty --rules path/to/rules -- command args
```

Test both the command that should match and at least one nearby command that should not match.

## supaschema Delivery Pattern

- Canonical durable policy prose and metadata live in `.claude/rules/**`.
- `.codex/rules/**` is for Codex-native executable shell policy or short pointers to canonical rule owners, not generated long-form mirrors.
- Edit the canonical owner, then run the matching guard or sync path. `npm run sync:llm` maps Claude-owned skills, agents, and rule pointers into generated Codex and `.agents` targets.
- Rule edits still follow the repo's current rule-check closeout. Skill edits do not inherit rule validation.
