# Code Atlas Query Contract

Run:

```bash
npm run code-atlas:build
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
- `health [filter]`: consistency risks and missing registrations.
- `mcp-status [filter]`: optional live MCP wrapper status.
