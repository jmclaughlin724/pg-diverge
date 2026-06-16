# Prompt Caching (Runtime)

How Claude Code uses prompt caching at runtime — what's cached, what invalidates it, TTL, scope, and how to check the hit rate. Claude Code manages this automatically; this reference explains the behavior so config audits don't accidentally tank the cache.

> Source: https://code.claude.com/docs/en/prompt-caching. When that page contradicts this file, the official docs win — open a PR updating this reference.
>
> **Scope note:** this is the Claude Code _runtime_ caching behavior. Authoring API prompts for cache efficiency (stable prefix first, volatile last) is covered in [prompt-engineering-techniques.md](prompt-engineering-techniques.md). No overlap — this file is about what the running CLI caches.

## How the Cache Is Organized

Each turn re-sends the full context; the API matches the **prefix** (exact match) against recently processed content and only reprocesses what changed. There is no per-file or per-segment caching. Claude Code orders the request so rarely-changing content comes first:

| Layer | Content | Invalidates when |
| --- | --- | --- |
| System prompt | Core instructions, tool definitions, output style | Loaded tool-definition set changes, or Claude Code upgrades |
| Project context | CLAUDE.md, auto memory, unscoped rules | Session start, `/clear`, `/compact` |
| Conversation | Messages, responses, tool results | Every turn (appended, so cache survives) |

Two values are **cache keys but not part of the prefix text**:

- **Model** — each model has its own cache. Switching = full miss.
- **Effort level** — each effort has its own cache per model. Switching mid-session = full miss; Claude Code shows a confirm dialog first (a no-op change that resolves to the same level skips it).

## Actions That Invalidate the Cache

One slower/costlier turn, then the new prefix is cached. Most are avoidable mid-task:

- **Switch models** (`/model`) — incl. `opusplan` plan-mode toggle (Opus↔Sonnet).
- **Change effort** (`/effort`).
- **Connect/disconnect an MCP server** — only when its tools load **into the prefix**; deferred tools ([tool search](#)) only append. Loaded-into-prefix happens on Haiku, Vertex, custom `ANTHROPIC_BASE_URL` gateways, `alwaysLoad` servers, or threshold loading. A stdio process exit / HTTP session expiry / auto-reconnect can trigger this without user action.
- **Enable/disable a plugin** — only if it provides MCP servers loaded into the prefix; skills/commands/agents/hooks/LSP/monitors/themes never invalidate.
- **Deny an entire tool** — a bare `Bash` / `WebFetch` deny rule (or `Bash(*)`) removes the definition from the system prompt. Scoped denies (`Bash(rm *)`) and all allow/ask rules don't.
- **Compact** (`/compact`) — replaces conversation history with a summary (the summary request itself shares the prefix and reads cache; the post-compaction turn is not the slow part).
- **Upgrade Claude Code** — new system prompt/tools; applied at next launch, so it shows as an uncached first turn (resuming a long session after upgrade reprocesses the whole history).

## Actions That Keep the Cache

Append or no-op:

- **Edit repo files** — reads append; a later edit adds a `<system-reminder>`, not a history rewrite.
- **Edit CLAUDE.md mid-session** — no-op until `/clear`, `/compact`, or restart (this is why the edit "doesn't apply" mid-session).
- **Change output style** — no-op until `/clear` or restart.
- **Change permission mode** — cache-safe, except `opusplan` plan toggle (a model switch).
- **Invoke skills/commands** — injected as user messages.
- **`/recap`** — appends a summary; unlike `/compact`, history is unchanged.
- **`/rewind`** — truncates to an earlier turn whose prefix is already cached (warm if within TTL).
- **Spawn a subagent** — builds its own cache; parent prefix intact.

## Cache Lifetime (TTL)

- **Claude subscription:** 1-hour TTL automatically (no extra cost). Drops to 5 minutes if over plan limit and drawing on usage credits.
- **API key / Bedrock / Vertex / Foundry / Claude Platform on AWS:** 5-minute default. `ENABLE_PROMPT_CACHING_1H=1` opts into 1-hour.
- **Override:** `FORCE_PROMPT_CACHING_5M=1` forces 5-minute regardless of auth (useful to override an `ENABLE_PROMPT_CACHING_1H` in managed settings).

Each cache hit resets the timer. Set TTL/disable vars in the `env` block of managed settings for org-wide policy.

## Cache Scope

Effectively one machine + directory: the system prompt embeds working directory, platform, shell, OS version, and auto-memory paths. Worktrees of the same repo have different caches. Parallel sessions in the same directory share; sequential sessions share only when the startup git-status snapshot matches (branch/recent commits are captured too).

Subagents use the 5-minute TTL even on a subscription. A fork inherits the parent's prefix and reads its cache.

## Check Performance

The API reports two fields per response (read them live via a [statusline script](output-and-session-surfaces.md#status-line) `current_usage` object):

| Field | Meaning |
| --- | --- |
| `cache_creation_input_tokens` | Written to cache this turn (cache-write rate) |
| `cache_read_input_tokens` | Served from cache (~10% of input rate) |

High read-to-creation ratio = caching working. Persistent high creation = the prefix keeps changing (see invalidation list). OpenTelemetry exporter reports both per user/session.

## Disable

| Variable                        | Effect      |
| ------------------------------- | ----------- |
| `DISABLE_PROMPT_CACHING`        | All models  |
| `DISABLE_PROMPT_CACHING_HAIKU`  | Haiku only  |
| `DISABLE_PROMPT_CACHING_SONNET` | Sonnet only |
| `DISABLE_PROMPT_CACHING_OPUS`   | Opus only   |

For normal use, leave caching enabled (disable only when debugging cache behavior).

## Related References

- [effort-and-thinking.md](effort-and-thinking.md) — effort and model are cache keys; switching invalidates
- [output-and-session-surfaces.md](output-and-session-surfaces.md) — statusline `current_usage` fields; output style is in the system-prompt layer
- [subagent-advanced.md](subagent-advanced.md) — subagent/fork cache behavior
- Official docs: https://code.claude.com/docs/en/prompt-caching
