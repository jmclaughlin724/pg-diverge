# SDK And Agents SDK Playbook

Sources verified 2026-05-25:

- https://developers.openai.com/codex/sdk
- https://developers.openai.com/codex/guides/agents-sdk

## Intent

Use the Codex SDK or Codex MCP server when Codex needs to be embedded into another application, workflow, or orchestrated agent system. Use the CLI directly for ordinary repository work.

## TypeScript SDK Pattern

1. Use `@openai/codex-sdk` on the server side.
2. Create a `Codex` client.
3. Start a thread for a unit of work.
4. Run the prompt with explicit cwd, sandbox, and approval expectations when available.
5. Persist `threadId` if follow-up work must resume the same context.

Use the SDK when the host application needs programmatic thread control, structured status, or integration into a larger product flow.

## Python SDK Pattern

- Treat Python SDK use as experimental.
- Confirm the local Codex app-server and checkout requirements before designing around it.
- Use async entrypoints when the host needs concurrent orchestration.
- Keep thread and run IDs durable if retries or resumptions matter.

## Agents SDK With Codex MCP

1. Start Codex as an MCP server with `codex mcp-server`.
2. Inspect tool behavior with MCP Inspector when debugging.
3. Use the `codex` tool to start work. Pass prompt, cwd, sandbox, approval policy, model, base instructions, and config intentionally.
4. Use `codex-reply` with `threadId` for continuation.
5. Wrap Codex in Agents SDK only when handoffs, traces, or multi-agent routing are real requirements.

## Output And Trace Discipline

- Capture the final message, changed files, and validation result from each run.
- Persist thread IDs in workflow state, not ad hoc logs.
- Keep orchestration prompts short and task-specific; durable behavior belongs in repo instructions.
