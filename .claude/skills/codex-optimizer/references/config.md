# Config Playbook

Sources verified 2026-06-02:

- https://developers.openai.com/codex/config
- https://developers.openai.com/codex/config-basic#configuration-precedence
- https://developers.openai.com/codex/config-advanced
- https://developers.openai.com/codex/config-reference
- https://developers.openai.com/codex/cli/slash-commands#built-in-slash-commands
- https://developers.openai.com/codex/agent-approvals-security

## Intent

Use Codex config to control runtime behavior that must be available before the agent starts: model defaults, sandboxing, approvals, MCP registration, feature gates, project trust, instruction discovery limits, skills, and subagents. Do not use config as a dumping ground for workflow prose that belongs in `AGENTS.md`, rules, or skills.

## Choose The Right Layer

1. Use `~/.codex/config.toml` for personal machine settings: auth, provider endpoints, telemetry, notification, profiles, and local preferences.
2. Use `.codex/config.toml` only for trusted project-scoped runtime behavior that every Codex user in the repo should inherit.
3. Use CLI flags or `-c key=value` overrides for one-off runs.
4. Use profiles when the same operator needs named variants.

Configuration precedence is: CLI flags/overrides, selected profile, trusted project config from repo root to cwd with closest wins, user config, system config, then built-ins.

## Authoring Rules

- Before adding a key to `.codex/config.toml`, confirm it is allowed in project config. Project config must not set machine-local provider, auth, notification, profile, realtime base URL, or telemetry keys.
- Keep project config declarative. Avoid comments that restate upstream docs unless they protect a repo-specific invariant.
- Prefer narrow feature gates such as `features.multi_agent`, `features.goals`, or `features.hooks` over broad prompt guidance.
- `features.goals` enables Goal mode; it does not create a task-list API or task metadata store.
- `history.persistence` and `sqlite_home` preserve transcripts and resumable runtime or agent-job state. Do not cite them as evidence of local task-list persistence.
- `features.multi_agent` exposes multi-agent collaboration tools; it does not authorize every workflow to spawn subagents or make parallel implementation safe.
- Set sandbox and approval defaults conservatively. Treat `approval_policy = "never"` and full-access sandboxes as deliberate exceptions, not convenience defaults.
- Keep `project_doc_max_bytes` and fallback instruction filenames intentional; they directly affect how much persistent instruction context Codex receives. Fallback filenames are additional instruction names Codex checks when `AGENTS.md` is missing, not replacements for the primary `AGENTS.md` path. Do not include built-in discovery names such as `AGENTS.md` or `AGENTS.override.md` in `project_doc_fallback_filenames`.

## Anilize Delivery Pattern

- `.codex/config.toml` is repo-owned runtime config.
- `.codex/hooks.json` and `.codex/hooks/**` are repo-owned native Codex hook runtime surfaces.
- `.mcp.json` owns MCP registry data; do not hand-duplicate registry entries in Codex config unless the task is explicitly direct Codex runtime config.
- `.claude/**` owns rules, skills, commands, agents, and Claude hooks. Generated `.codex/rules/**`, `.codex/agents/**`, `.agents/**`, and `.gemini/**` mirrors should come from sync.
- `pnpm sync:llm` must not sync, generate, or validate Claude hook wiring or native Codex hooks.

## Closeout

- For `.codex/config.toml`, `.mcp.json`, root `AGENTS.md`, or sync-script edits, run the context-surface closeout named by current repo guidance.
- For skill-source edits, run only `pnpm sync:llm` unless the user explicitly requests skill validation.
- In the final report, name the config owner changed and any runtime behavior affected.
