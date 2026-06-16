# MCP Tool Map

Prefer local Code Atlas first:

```bash
npm run code-atlas:query -- pre-edit <target> --json
```

Use `trace-change <target>` when the agent needs consumers, owners, and verification commands. Use `regression-scope [filter]` before final verification to derive guard scope from git status/diff.

Rule 10 (`.claude/rules/10-code-atlas.md`) owns Code Atlas MCP policy. Use `supaschema.code_atlas_query` as the MCP-facing path to the fixed local query surface; do not add or auto-install a standalone `codeatlas` MCP server in repo config. CodeAtlas-Live can supplement exploration when already configured, but `npx` fallback must be explicit with `CODEATLAS_MCP_ALLOW_NPX=1` and live output is never final proof.

Use cclsp after Code Atlas identifies owner files, especially for rename, reference, definition, and symbol behavior questions.
