# Security And Auto-Review Playbook

Sources verified 2026-05-25:

- https://developers.openai.com/codex/agent-approvals-security
- https://developers.openai.com/codex/concepts/sandboxing/auto-review

## Intent

Use sandboxing, approval policy, and auto-review to make agent work constrained by default. These controls should reduce accidental damage and credential exposure without replacing human judgment for high-risk changes.

## Set The Safety Posture

1. Start with workspace write plus interactive approvals for normal repo work.
2. Allow network only when the task requires it and the destination policy is clear.
3. Treat full access and `approval_policy = "never"` as explicit exceptions.
4. Protect version-control and instruction surfaces. Writable roots still have protected paths such as `.git`, `.agents`, and `.codex`.
5. Prefer granular approvals over broad relaxation.

## Network Rules

- Enable workspace network access only after confirming why network is needed.
- Use proxy allow/deny configuration when network access should be constrained.
- Denies should win over broad allows.
- Be careful with private/local addresses and DNS rebinding.

## Auto-Review Use

- Auto-review changes who reviews an approval request; it does not grant permission or weaken the sandbox.
- It applies to interactive approval flows, not `never`.
- It can review escalated shell, blocked network, out-of-root writes, MCP/app approval annotations, and new browser domains.
- Treat denial as a boundary. Do not search for a workaround unless the user changes the policy.

## Authoring Guidance

- If approval noise is high, fix the sandbox, command rules, MCP policy, or tool scope first.
- Do not reduce review strictness to hide bad workflow design.
- For side-effecting tools, make intent and rollback plan explicit before requesting approval.

## supaschema Delivery Pattern

- Keep repo safety defaults in Codex config or rules, not scattered skill prose.
- Skill references may explain how to choose safety posture, but should not silently change it.
