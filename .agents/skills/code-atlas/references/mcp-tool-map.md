# MCP Tool Map

Prefer local Code Atlas first:

```bash
npm run code-atlas:query -- trace-change <target> --json
```

Rule 10 (`.claude/rules/10-code-atlas.md`) owns Code Atlas MCP policy. Use `supaschema.code_atlas_query` only as its MCP-facing path to the fixed local query surface. CodeAtlas-Live can supplement exploration when configured, but `npx` fallback must be explicit with `CODEATLAS_MCP_ALLOW_NPX=1` and live output is never final proof.

Use cclsp after Code Atlas identifies owner files, especially for rename, reference, definition, and symbol behavior questions.
