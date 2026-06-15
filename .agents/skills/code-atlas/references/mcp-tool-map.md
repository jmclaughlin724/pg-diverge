# MCP Tool Map

Prefer local Code Atlas first:

```bash
npm run code-atlas:build
node scripts/code-atlas/query.mjs impact <target> --json
```

Use `repo_context.code_atlas_query` when an MCP client needs the same fixed query shape through the read-only context server.

Use the optional `codeatlas` live MCP server only as supplemental context. It is resolved through `scripts/code-atlas/mcp-wrapper.mjs`; the wrapper must not replace the local atlas build or query for proof.

Use cclsp after Code Atlas identifies owner files, especially for rename, reference, definition, and symbol behavior questions.
