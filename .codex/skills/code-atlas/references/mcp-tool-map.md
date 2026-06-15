# MCP Tool Map

Prefer local Code Atlas first:

```bash
npm run code-atlas:build
node scripts/code-atlas/query.mjs impact <target> --json
```

Rule 10 (`.claude/rules/10-code-atlas.md`) owns Code Atlas MCP policy. Use `supaschema.code_atlas_query` only as its MCP-facing path to the fixed local query surface.

Use cclsp after Code Atlas identifies owner files, especially for rename, reference, definition, and symbol behavior questions.
