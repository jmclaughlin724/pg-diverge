# Subagent MCP Configuration Reference

MCP (Model Context Protocol) server configuration patterns for Claude Code agents and subagents.

> **Source:** [Claude Code MCP](https://code.claude.com/docs/en/mcp), [Claude Code Agents](https://code.claude.com/docs/en/agents), and verified codebase patterns (February 2026).

## Contents

- [Configuration Approaches](#configuration-approaches)
- [Pattern 1: Reference by Name](#pattern-1-reference-by-name)
- [Pattern 2: Inline Stdio](#pattern-2-inline-stdio)
- [Pattern 3: Inline HTTP](#pattern-3-inline-http)
- [Pattern 4: Inline SSE](#pattern-4-inline-sse)
- [Pattern 5: Mixed Approach](#pattern-5-mixed-approach)
- [Scope Inheritance](#scope-inheritance)
- [MCP Tools in Agent Frontmatter](#mcp-tools-in-agent-frontmatter)
- [Decision Matrix](#decision-matrix)
- [Settings.json Configuration](#settingsjson-configuration)
- [Tool Naming Convention](#tool-naming-convention)
- [Environment Variables](#environment-variables)
- [Troubleshooting](#troubleshooting)

---

## Configuration Approaches

MCP servers can be configured at three levels, each with different scope and sharing characteristics.

| Level | Location | Scope | Shared via VCS |
| --- | --- | --- | --- |
| Global | `~/.claude/settings.json` | All projects | No |
| Project | `.claude/settings.json` | Current project | Yes |
| Project-local | `.claude/settings.local.json` | Current project | No |
| Agent-inline | `.claude/agents/*.md` frontmatter | Single agent | Yes |

---

## Pattern 1: Reference by Name

Reference MCP servers already configured in `settings.json`. The simplest approach when servers are shared across multiple agents.

### Agent Frontmatter

```yaml
---
name: data-analyst
description: |
  Analyzes database schemas and query performance.
  <example>
  context: Need to understand table relationships
  user: "Analyze the database schema"
  assistant: "Using data-analyst to inspect schema..."
  </example>
tools: Read, Grep, mcp__supabase_main__list_tables, mcp__supabase_main__search_docs
mcpServers:
  - supabase-main
  - sentry
---
```

> Note: Some Supabase MCP deployments do not expose `execute_sql`. Prefer `search_docs` + `list_tables` as baseline tools, and use `execute_sql` only when available.

### How It Works

1. Agent declares server names in `mcpServers` array
2. Claude resolves names against `settings.json` → `mcpServers` definitions
3. Named servers must already exist in settings; unresolved names cause startup errors

### When to Use

- Server is used by multiple agents
- Server configuration contains secrets (keep in `.local.json`)
- Server requires complex environment setup
- Team shares the same server definitions

---

## Pattern 2: Inline Stdio

Define a stdio-based MCP server directly in agent frontmatter. The server runs as a child process communicating over stdin/stdout.

### Agent Frontmatter

```yaml
---
name: postgres-analyst
description: |
  Direct PostgreSQL analysis specialist.
  <example>
  context: Database performance issue
  user: "Analyze slow queries"
  assistant: "Using postgres-analyst to query the database..."
  </example>
mcpServers:
  my-postgres:
    command: npx
    args:
      - "-y"
      - "@modelcontextprotocol/server-postgres"
    env:
      DATABASE_URL: "postgresql://localhost:5432/mydb"
---
```

### Fields

| Field | Required | Type | Description |
| --- | --- | --- | --- |
| `command` | Yes | string | Executable to run (`npx`, `node`, `python`, etc.) |
| `args` | No | array | Command-line arguments |
| `env` | No | object | Environment variables passed to the process |
| `cwd` | No | string | Working directory for the process |

### Common Stdio Servers

```yaml
# Filesystem server
mcpServers:
  filesystem:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed/dir"]

# GitHub server
mcpServers:
  github:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}"

# Brave Search server
mcpServers:
  brave-search:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-brave-search"]
    env:
      BRAVE_API_KEY: "${BRAVE_API_KEY}"

# SQLite server
mcpServers:
  sqlite:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-sqlite", "--db-path", "./data/app.db"]

# Custom local server
mcpServers:
  my-tools:
    command: node
    args: ["./scripts/mcp-server.js"]
    cwd: "/absolute/path/to/project"
```

### When to Use

- Agent-specific server not needed elsewhere
- Prototyping or testing a new MCP server
- Server has agent-specific environment variables
- Self-contained agent definition (no external config needed)

---

## Pattern 3: Inline HTTP

Define an HTTP-based MCP server using the Streamable HTTP transport. The server runs as a separate process and communicates via HTTP requests.

### Agent Frontmatter

```yaml
---
name: api-consumer
description: |
  Consumes data from REST/GraphQL APIs via MCP bridge.
  <example>
  context: Need to query internal API
  user: "Fetch user data from the API"
  assistant: "Using api-consumer to query the service..."
  </example>
mcpServers:
  internal-api:
    type: http
    url: "http://localhost:8080/mcp"
    headers:
      Authorization: "Bearer ${API_TOKEN}"
      X-Custom-Header: "value"
---
```

### Fields

| Field     | Required | Type   | Description                          |
| --------- | -------- | ------ | ------------------------------------ |
| `type`    | Yes      | string | Must be `"http"`                     |
| `url`     | Yes      | string | HTTP endpoint URL                    |
| `headers` | No       | object | HTTP headers (auth tokens, API keys) |

### When to Use

- Connecting to remote MCP servers
- Server runs as a standalone service
- Multiple clients share the same server
- Server is deployed to cloud infrastructure

---

## Pattern 4: Inline SSE

Define an SSE (Server-Sent Events) MCP server. Uses long-lived HTTP connections with event streaming. This is the legacy remote transport; prefer HTTP for new implementations.

### Agent Frontmatter

```yaml
---
name: stream-consumer
description: |
  Consumes streaming data via SSE-based MCP server.
  <example>
  context: Need real-time data
  user: "Monitor the event stream"
  assistant: "Using stream-consumer to subscribe..."
  </example>
mcpServers:
  event-stream:
    type: sse
    url: "http://localhost:9090/sse"
    headers:
      Authorization: "Bearer ${SSE_TOKEN}"
---
```

### Fields

| Field     | Required | Type   | Description                     |
| --------- | -------- | ------ | ------------------------------- |
| `type`    | Yes      | string | Must be `"sse"`                 |
| `url`     | Yes      | string | SSE endpoint URL                |
| `headers` | No       | object | HTTP headers for authentication |

### When to Use

- Legacy MCP servers that only support SSE transport
- Servers requiring long-lived streaming connections
- Backward compatibility with older MCP implementations

---

## Pattern 5: Mixed Approach

Combine referenced and inline servers in a single agent definition.

### Agent Frontmatter

```yaml
---
name: full-stack-debugger
description: |
  Full-stack debugging specialist with access to database, error tracking,
  and custom analysis tools.
  <example>
  context: Production error affecting multiple layers
  user: "Debug the 500 error in the loan submission flow"
  assistant: "Using full-stack-debugger to investigate across all layers..."
  </example>
tools: Read, Write, Edit, Grep, Glob, Bash, Skill, mcp__supabase_main__search_docs, mcp__sentry__search_issues, mcp__custom-analyzer__analyze
mcpServers:
  - supabase-main
  - sentry
  custom-analyzer:
    command: node
    args: ["./tools/analyzer-server.js"]
    env:
      ANALYSIS_DEPTH: "deep"
---
```

### How Mixed Resolution Works

1. Array entries (`- supabase-main`, `- sentry`) resolve from settings.json
2. Object entries (`custom-analyzer: { ... }`) define inline servers
3. Both types merge into the agent's available server pool
4. Tool names follow the same `mcp__servername__toolname` convention regardless of source

---

## Scope Inheritance

Subagents see globally and project-configured MCP servers by default.

### Inheritance Chain

```
Global settings (~/.claude/settings.json)
  └── Project settings (.claude/settings.json)
       └── Project-local settings (.claude/settings.local.json)
            └── Agent frontmatter (mcpServers field)
```

### Inheritance Rules

| Rule | Behavior |
| --- | --- |
| Parent servers visible | Agents see all MCP servers from parent session |
| Agent servers additive | Agent `mcpServers` adds to (does not replace) inherited set |
| Name collision | Agent-level definition overrides inherited definition |
| Tool filtering still applies | Agent's `tools` field controls which MCP tools are usable |

### Practical Implication

If `supabase-main` is configured in `settings.json`, every agent can use its tools without declaring `mcpServers`. The agent only needs `mcpServers` when:

1. Adding servers not in settings.json
2. Overriding a server's configuration for this specific agent
3. Making the dependency explicit for documentation purposes

---

## MCP Tools in Agent Frontmatter

MCP tools appear in the `tools` field using the fully qualified naming convention.

### Naming Convention

```
mcp__<server-name>__<tool-name>
```

- Double underscores separate server name from tool name
- Server name matches the key in `mcpServers` configuration
- Tool name is defined by the MCP server itself

### Examples

```yaml
# Specific tools from specific servers
tools: Read, Grep, mcp__supabase_main__search_docs, mcp__supabase_main__list_tables

# All tools from a server (wildcard)
tools: Read, Grep, mcp__perplexity__*

# Multiple MCP servers
tools: >-
  Read, Grep, Glob,
  mcp__sentry__search_issues,
  mcp__sentry__get_issue_details,
  mcp__supabase_main__get_logs,
  mcp__perplexity__search,
  mcp__perplexity__reason

# Mixed built-in and MCP tools
tools: Read, Write, Edit, Glob, Grep, Bash, Task, TaskOutput, mcp__context7__resolve-library-id, mcp__context7__get-library-docs
```

### Wildcard Patterns

| Pattern                 | Matches                          |
| ----------------------- | -------------------------------- |
| `mcp__sentry__*`        | All tools from the sentry server |
| `mcp__supabase_main__*` | All tools from supabase-main     |
| `mcp__perplexity__*`    | All tools from perplexity        |

### Tool Discovery

To see available tools from an MCP server:

1. Check the server's documentation
2. Look at `settings.json` for configured servers
3. In a Claude Code session, the tools appear in the available tools list at startup

---

## Decision Matrix

### Reference vs Inline

| Criterion                | Reference by Name     | Inline Definition     |
| ------------------------ | --------------------- | --------------------- |
| **Reuse across agents**  | Best (single config)  | Duplicated per agent  |
| **Secret management**    | Best (in .local.json) | Secrets in VCS risk   |
| **Self-contained agent** | Requires settings     | Fully portable        |
| **Prototyping speed**    | Slower (two files)    | Faster (one file)     |
| **Team collaboration**   | Shared via settings   | Shared via agent file |
| **Override per agent**   | Not directly          | Natural fit           |

### Transport Selection

| Transport | Connection Model | Best For | Latency |
| --- | --- | --- | --- |
| **stdio** | Child process | Local tools, CLI wrappers | Lowest |
| **http** | Request/response | Remote services, cloud deployment | Variable |
| **sse** | Long-lived streaming | Legacy servers, event streams | Variable |

### When to Use Each Pattern

| Scenario                             | Pattern               |
| ------------------------------------ | --------------------- |
| Supabase, Sentry, GitHub (team-wide) | Reference by name     |
| One-off database query tool          | Inline stdio          |
| Remote API bridge for specific agent | Inline HTTP           |
| Legacy streaming server              | Inline SSE            |
| Agent needs shared + custom servers  | Mixed approach        |
| Secrets involved                     | Reference (in .local) |

---

## Settings.json Configuration

MCP servers configured in settings files are available to all agents via reference.

### Stdio Server in Settings

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}"
      }
    }
  }
}
```

### HTTP Server in Settings

```json
{
  "mcpServers": {
    "remote-api": {
      "type": "http",
      "url": "https://api.example.com/mcp",
      "headers": {
        "Authorization": "Bearer ${API_TOKEN}"
      }
    }
  }
}
```

### SSE Server in Settings

```json
{
  "mcpServers": {
    "legacy-stream": {
      "type": "sse",
      "url": "http://localhost:9090/sse"
    }
  }
}
```

### Project-Level Enable All

In `.claude/settings.json`, enable all project-configured MCP servers:

```json
{
  "enableAllProjectMcpServers": true
}
```

This auto-approves MCP servers without per-server permission prompts.

---

## Tool Naming Convention

Understanding the naming convention is critical for the `tools` field in agent frontmatter and for `permissions` in settings.

### Format

```
mcp__<server-name>__<tool-name>
```

### Real-World Examples from This Codebase

| MCP Tool Name | Server | Tool |
| --- | --- | --- |
| `mcp__supabase_main__generate_typescript_types` | supabase-main | generate_typescript_types |
| `mcp__supabase_main__list_tables` | supabase-main | list_tables |
| `mcp__supabase_main__get_logs` | supabase-main | get_logs |
| `mcp__supabase_main__search_docs` | supabase-main | search_docs |
| `mcp__sentry__search_issues` | sentry | search_issues |
| `mcp__sentry__get_issue_details` | sentry | get_issue_details |
| `mcp__perplexity__search` | perplexity | search |
| `mcp__perplexity__reason` | perplexity | reason |
| `mcp__context7__resolve-library-id` | context7 | resolve-library-id |
| `mcp__context7__get-library-docs` | context7 | get-library-docs |
| `mcp__sequential-thinking__sequentialthinking` | sequential-thinking | sequentialthinking |
| `mcp__next_devtools__nextjs_index` | next-devtools | nextjs_index |
| `mcp__next_devtools__nextjs_call` | next-devtools | nextjs_call |

### Permission Patterns in Settings

MCP tools can be pre-approved in `settings.json` permissions:

```json
{
  "permissions": {
    "allow": [
      "mcp__supabase_main__list_tables",
      "mcp__supabase_main__get_advisors",
      "mcp__sequential-thinking__*",
      "mcp__perplexity__*",
      "mcp__context7__*"
    ]
  }
}
```

---

## Environment Variables

MCP server configurations support environment variable interpolation.

### Syntax

```yaml
env:
  DATABASE_URL: "${DATABASE_URL}" # From shell environment
  API_KEY: "${MY_API_KEY}" # From shell environment
  STATIC_VALUE: "hardcoded-value" # Literal string
```

### Best Practices

| Practice | Rationale |
| --- | --- |
| Use `${VAR}` for secrets | Never hardcode secrets in VCS files |
| Define secrets in `.claude/settings.local.json` | `.local.json` excluded from VCS |
| Use `env` in settings, not agent files | Secrets in agent files risk VCS leak |
| Reference servers with secrets by name | Indirection keeps agent files clean |

### Environment Variable Sources

| Source                                | Available To            |
| ------------------------------------- | ----------------------- |
| Shell environment                     | All MCP servers         |
| `settings.json` → `env` section       | All processes           |
| `settings.local.json` → `env` section | All processes (private) |
| Agent frontmatter `mcpServers.*.env`  | Specific server only    |

---

## Troubleshooting

| Issue | Cause | Resolution |
| --- | --- | --- |
| "Unknown MCP server" error | Server name not in settings.json | Add server to settings or use inline definition |
| MCP tools not appearing | Server failed to start or connect | Check `claude --debug` output for server errors |
| "Permission denied" on MCP tool | Tool not in agent's `tools` list | Add `mcp__server__tool` to `tools` field |
| Timeout on MCP server startup | Server takes too long to initialize | Increase `MCP_TIMEOUT` in settings env |
| Tools from wrong server version | Cached server process from different config | Restart Claude Code session |
| Environment variable not resolved | Variable not set in shell or settings | Verify with `echo $VAR_NAME` before starting |
| Duplicate server names | Same name in settings and agent frontmatter | Agent-level definition overrides settings |
| SSE connection dropping | Server or network instability | Switch to HTTP transport if possible |

### Debugging MCP Connections

```bash
# Check if MCP server starts correctly
npx -y @modelcontextprotocol/server-postgres 2>&1

# View Claude Code debug output for MCP
claude --debug

# Check MCP timeout configuration
echo $MCP_TIMEOUT
```

---

## Sources

- [Claude Code MCP Documentation](https://code.claude.com/docs/en/mcp) - Official MCP configuration
- [Claude Code Agents Documentation](https://code.claude.com/docs/en/agents) - Agent frontmatter specification
- [Model Context Protocol Specification](https://spec.modelcontextprotocol.io/) - MCP transport types
- [subagent-configuration.md](subagent-configuration.md) - Agent frontmatter field reference
- [tool-patterns.md](tool-patterns.md) - Tool integration patterns
