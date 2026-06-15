# Code Atlas Query Contract

Normal queries rebuild the atlas in memory, update `.tmp/code-atlas/atlas.json` only when the fingerprint changes, and answer from the fresh graph. Use `--no-rebuild` only when intentionally reading the cached scratch file.

Run:

```bash
npm run code-atlas:query -- <kind> [value] --json
node scripts/code-atlas/query.mjs <kind> [value] --json
```

Kinds:

- `route <value>`: Next route nodes.
- `file <path>`: file nodes.
- `package <value>`: package, external package, or Python package nodes.
- `symbol <value>`: TypeScript or Python symbol nodes.
- `db <value>`: database object nodes.
- `policy <value>`: database policy nodes.
- `api <value>`: API router and endpoint nodes.
- `worker <value>`: worker jobs and command groups.
- `search <value>`: broad node search.
- `consumers <file>`: incoming file importers.
- `entrypoints [filter]`: route, API, worker, and deploy entrypoints.
- `impact <target>`: owner files plus importers to depth 3 and affected surfaces.
- `pre-edit <target>`: impact plus capped immediate incoming and outgoing edges.
- `trace-change <target>`: impact, consumers, owners, and verification commands for agent execution.
- `file-owners <target>`: nearest `AGENTS.md` plus atlas/rule/skill owner files.
- `validate-coverage`: graph metadata, package-boundary, MCP-boundary, and stale-guidance checks.
- `health [filter]`: consistency risks and missing registrations.
- `mcp-status [filter]`: optional live MCP wrapper status.
