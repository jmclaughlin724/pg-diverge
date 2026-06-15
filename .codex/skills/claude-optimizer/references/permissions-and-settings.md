# Permissions and Settings

How Claude Code's permission system, settings files, and managed policies fit together.

> Source: https://code.claude.com/docs/en/permissions. When that page contradicts this file, the official docs win — open a PR updating this reference.

## Contents

- [Precedence](#precedence)
- [Permission Modes](#permission-modes)
- [Rule Syntax](#rule-syntax)
- [Bash Specifics](#bash-specifics)
- [Read and Edit Path Patterns](#read-and-edit-path-patterns)
- [WebFetch, MCP, and Agent Rules](#webfetch-mcp-and-agent-rules)
- [Sandbox Interaction](#sandbox-interaction)
- [Working Directories](#working-directories)
- [Managed-Only Settings](#managed-only-settings)
- [Hooks and Permissions](#hooks-and-permissions)
- [Top-Level settings.json Key Catalog](#top-level-settingsjson-key-catalog)

---

## Precedence

Two precedence chains operate independently. Both follow deny-first semantics.

### Rule evaluation (per tool call)

Order: **deny → ask → allow**. First matching rule wins.

- A managed `deny` cannot be overridden by `--allowedTools`, `/permissions`, or any allow rule lower in the chain.
- An `ask` rule still prompts even when a PreToolUse hook returned `"allow"`.
- A PreToolUse hook that exits with code 2 blocks the call before rules are evaluated — so a blocking hook can override an `allow` rule.

### Settings precedence (across files)

Higher entries override lower ones; cannot be overridden by any level below.

1. **Managed settings** (`/Library/Application Support/ClaudeCode/managed-settings.json` on macOS; `/etc/claude-code/managed-settings.json` on Linux/WSL; `C:\Program Files\ClaudeCode\managed-settings.json` on Windows)
2. **Command line arguments** (`--allowedTools`, `--disallowedTools`, `--permission-mode`)
3. **Local project settings** (`.claude/settings.local.json`)
4. **Shared project settings** (`.claude/settings.json`)
5. **User settings** (`~/.claude/settings.json`)

If a tool is denied at any level, no other level can allow it. `--disallowedTools` can add restrictions beyond managed settings; it cannot relax them.

---

## Permission Modes

Set via the `defaultMode` settings field or the `--permission-mode` CLI flag. Agent definitions can override per-agent via `permissionMode` frontmatter.

| Mode | Behavior |
| --- | --- |
| `default` | Prompts for permission on first use of each tool |
| `acceptEdits` | Auto-accepts file edits and common filesystem commands (`mkdir`, `touch`, `mv`, `cp`) for paths in the working directory or `additionalDirectories` |
| `plan` | Plan Mode: gather context and draft plans |
| `auto` | Background classifier reviews each call; blocks scope escalation, unknown infrastructure, hostile-content-driven actions. Research preview. In `-p` non-interactive mode, aborts when the classifier repeatedly blocks |
| `dontAsk` | Auto-denies tools unless pre-approved via `/permissions` or `permissions.allow` rules |
| `bypassPermissions` | Skips all permission prompts. Root and home directory `rm -rf` still prompt as a circuit breaker. Writes to `.git`, `.claude`, `.vscode`, `.idea`, `.husky` are also not prompted |

### Locking out unsafe modes

- `permissions.disableBypassPermissionsMode: "disable"` — block `bypassPermissions`. Works from any settings scope; most useful in managed settings.
- `permissions.disableAutoMode: "disable"` — block `auto`.

---

## Rule Syntax

Permission rules follow `Tool` or `Tool(specifier)`.

| Form                           | Meaning                                 |
| ------------------------------ | --------------------------------------- |
| `Bash` or `Bash(*)`            | Matches all Bash commands               |
| `WebFetch`                     | Matches all web fetches                 |
| `Read`                         | Matches all file reads                  |
| `Bash(npm run build)`          | Exact-match command                     |
| `Read(./.env)`                 | Read of `.env` in the current directory |
| `WebFetch(domain:example.com)` | Fetch to example.com                    |

### Wildcards

- `*` matches any sequence including spaces; one wildcard can span multiple arguments.
- Trailing `:*` is equivalent to ` *`; only recognized at the end.
- Space before `*` enforces a word boundary: `Bash(ls *)` matches `ls -la` but not `lsof`; `Bash(ls*)` matches both.

The interactive "Yes, don't ask again" prompt writes the space-separated form.

---

## Bash Specifics

### Wrapper stripping

Claude Code strips a fixed set of process wrappers before matching, so `Bash(npm test *)` also matches the wrapped form.

Stripped: `timeout`, `time`, `nice`, `nohup`, `stdbuf`. Bare `xargs` (no flags) is also stripped; `xargs -n1 grep ...` is NOT stripped.

NOT stripped (write specific rules for these): `direnv exec`, `devbox run`, `mise exec`, `npx`, `docker exec`. Because they execute their argument as a command, a rule like `Bash(devbox run *)` matches whatever follows `run`, including `devbox run rm -rf .`. Approve specific inner commands: `Bash(devbox run npm test)`.

Always prompt — cannot be auto-approved via a prefix rule: `watch`, `setsid`, `ionice`, `flock`, plus `find` with `-exec` or `-delete`.

### Compound commands

Recognized separators: `&&`, `||`, `;`, `|`, `|&`, `&`, newlines. A rule must match each subcommand independently.

When "Yes, don't ask again" is selected for a compound command, Claude Code saves a separate rule for each subcommand that requires approval (up to 5 rules per compound).

### Non-Mutating Commands

Built-in set runs without a prompt in every mode (not configurable). Add an `ask` or `deny` rule to require prompts.

Non-mutating set: `ls`, `cat`, `head`, `tail`, `grep`, `find`, `wc`, `diff`, `stat`, `du`, `cd`, and inspection forms of `git`.

Unquoted globs are permitted when every flag is non-mutating (`ls *.ts`, `wc -l src/*.py`). Commands with write- or exec-capable flags (`find`, `sort`, `sed`, `git`) still prompt when an unquoted glob is present.

`cd` into a path inside the working directory or an additional directory is non-mutating. `cd path && ls` runs without a prompt; `cd path && git ...` always prompts.

### URL filtering caveat

Bash patterns that try to constrain command arguments are fragile. `Bash(curl http://github.com/ *)` does not match `curl -X GET http://github.com/...`, redirects, variables, or extra spaces. Use one of:

- Deny `curl`/`wget` in Bash; allow `WebFetch(domain:github.com)` instead.
- Use a PreToolUse hook that parses Bash command strings.

### PowerShell

Same rule shape as Bash. AST-aware: pipelines `|`, statement separators `;`, and (on PS 7+) `&&`/`||` split compound commands. Common aliases canonicalize: `PowerShell(Get-ChildItem *)` matches `gci`, `ls`, `dir`. Case-insensitive.

---

## Read and Edit Path Patterns

Read and Edit follow [gitignore](https://git-scm.com/docs/gitignore) semantics with four anchor types.

| Pattern | Anchor | Example | Resolves to |
| --- | --- | --- | --- |
| `//path` | Filesystem root | `Read(//Users/alice/secrets/**)` | `/Users/alice/secrets/**` |
| `~/path` | Home directory | `Read(~/Documents/*.pdf)` | `/Users/alice/Documents/*.pdf` |
| `/path` | Project root | `Edit(/src/**/*.ts)` | `<project root>/src/**/*.ts` |
| `path` or `./path` | Current directory | `Read(*.env)` | `<cwd>/*.env` |

`/Users/alice/file` is NOT absolute — it is relative to the project root. Use `//Users/alice/file` for absolute paths.

On Windows, paths normalize to POSIX form: `C:\Users\alice` → `/c/Users/alice`. Use `//c/**/.env` for files anywhere on that drive, `//**/.env` for any drive.

Bare filenames follow gitignore depth semantics: `Read(.env)` ≡ `Read(**/.env)` — matches any `.env` at or below the current directory.

`*` matches files in a single directory; `**` matches recursively. To allow all access, use `Read`, `Edit`, or `Write` without parentheses.

### Symlinks

- **Allow rules** apply only when both the symlink path and its target match. A symlink inside an allowed directory pointing outside still prompts.
- **Deny rules** apply when either the symlink path or its target matches. A symlink to a denied file is denied.

`Read` deny rules do NOT block Bash subprocesses. `Read(./.env)` blocks the Read tool; `cat .env` in Bash is not blocked. For OS-level enforcement, enable the sandbox.

---

## WebFetch, MCP, and Agent Rules

| Rule | Effect |
| --- | --- |
| `WebFetch(domain:example.com)` | Fetch to example.com |
| `mcp__puppeteer` | Any tool from the `puppeteer` MCP server |
| `mcp__puppeteer__*` | Same as above, explicit wildcard |
| `mcp__puppeteer__puppeteer_navigate` | One specific tool from the server |
| `Agent(Explore)` | The Explore subagent |
| `Agent(my-custom-agent)` | A custom subagent named `my-custom-agent` |

Use `Agent(...)` in the `deny` array (or `--disallowedTools`) to disable specific subagents.

---

## Sandbox Interaction

Permissions and [sandboxing](https://code.claude.com/docs/en/sandboxing) are complementary. Permissions apply to all tools; sandboxing applies only to Bash and its children.

- `sandbox.autoAllowBashIfSandboxed: true` (default) — sandboxed Bash runs without prompting even when `ask: Bash(*)` is set. Explicit deny rules and root/home `rm`/`rmdir` still prompt.
- `sandbox.filesystem.*` — the final filesystem boundary merges `allowRead`/`denyRead`/`allowWrite`/`denyWrite` from settings with Read/Edit deny rules.
- `sandbox.network.allowedDomains` / `deniedDomains` — merge with `WebFetch(domain:...)` rules to form the network boundary.

---

## Working Directories

Default access is the directory where Claude was launched. Extend via:

- Startup: `--add-dir <path>`
- Session: `/add-dir`
- Persistent: `additionalDirectories` in settings

Files in additional directories follow the same permission rules as the original working dir.

### What configuration loads from `--add-dir`

Adding a directory grants file access — not full configuration discovery. Only a few config types load from additional directories:

| Configuration | Loads from `--add-dir`? |
| --- | --- |
| Skills (`.claude/skills/`) | Yes, with live reload |
| Plugin settings in `.claude/settings.json` | `enabledPlugins` and `extraKnownMarketplaces` only |
| CLAUDE.md, `.claude/rules/`, CLAUDE.local.md | Only when `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1` is set (and `CLAUDE.local.md` additionally requires the `local` setting source) |
| Subagents, commands, output styles, hooks, other settings | No |

To share configuration across projects, use user-level configuration (`~/.claude/agents/`, `~/.claude/output-styles/`, `~/.claude/settings.json`), package as a plugin, or launch Claude from the config-owning directory.

---

## Managed-Only Settings

Read only from the managed settings file. Placing them in user or project settings has no effect.

| Setting | Description |
| --- | --- |
| `allowedChannelPlugins` | Allowlist of channel plugins that may push messages |
| `allowManagedHooksOnly` | Block user/project/non-force-enabled plugin hooks |
| `allowManagedMcpServersOnly` | Only `allowedMcpServers` from managed settings respected (deny still merges) |
| `allowManagedPermissionRulesOnly` | Block user/project allow/ask/deny rules; only managed rules apply |
| `blockedMarketplaces` | Blocklist of plugin marketplace sources (checked before download) |
| `channelsEnabled` | Allow channels org-wide |
| `forceRemoteSettingsRefresh` | Block CLI startup until remote managed settings are fetched |
| `pluginTrustMessage` | Custom message appended to plugin install warning |
| `sandbox.filesystem.allowManagedReadPathsOnly` | Only managed `filesystem.allowRead` paths respected |
| `sandbox.network.allowManagedDomainsOnly` | Only managed `allowedDomains` respected; non-allowed domains blocked silently |
| `strictKnownMarketplaces` | Controls which plugin marketplaces users may add |
| `wslInheritsWindowsSettings` | When set in Windows HKLM or `C:\Program Files\ClaudeCode\managed-settings.json`, WSL reads Windows policy chain |

`permissions.disableBypassPermissionsMode` and `permissions.disableAutoMode` are typically managed-only by policy but work from any scope; a user can lock themselves out of those modes in their own settings.

---

## Hooks and Permissions

[Hooks](https://code.claude.com/docs/en/hooks-guide) extend permission evaluation at runtime.

- PreToolUse hooks run **before** the permission prompt. Hook output can deny, force a prompt, or skip the prompt.
- Hook decisions do NOT bypass deny/ask rules. A managed deny still blocks the call even when the hook returned `"allow"`.
- A blocking hook (exit code 2) overrides allow rules — useful for "allow everything except this specific pattern".

Pattern: add `Bash` to your `allow` list and register a PreToolUse hook that rejects the specific commands you want blocked. See [hooks-reference.md](hooks-reference.md) for the response shape (`permissionDecision`, `hookEventName`, `updatedInput`).

---

## Top-Level settings.json Key Catalog

Top-level `settings.json` keys beyond the permission, mode, working-directory, sandbox, and managed-only fields covered above. `Source` tags how the row was verified: `docs` (official docs), `observed` (seen in live config/runtime), `inferred` (consistent with documented behavior, not explicitly enumerated upstream).

| Key | Type | Purpose | Source |
| --- | --- | --- | --- |
| `effortLevel` | string (enum: `"low"` \| `"medium"` \| `"high"` \| `"xhigh"`) | Controls reasoning depth and planning scope for Claude's responses and problem-solving. | docs |
| `outputStyle` | string (enum: `"default"` \| `"Explanatory"` \| `"Concise"`) | Sets the verbosity and explanation depth in Claude's responses. | docs |
| `statusLine` | object `{type: string, command?: string}` | Configures custom status line display showing session/project info in the terminal. | docs |
| `disableWorkflows` | boolean | Disables explicit workflow skill invocation and matching. | observed |
| `disableAllHooks` | boolean | Globally disables all Claude Code hooks (SessionStart, PreToolUse, PostToolUse, etc.). | observed |
| `skillOverrides` | object (map of skill names to override config) | Per-skill runtime configuration overrides for prompt matching, invocation rules, and visibility. | inferred |
| `skillListingBudgetFraction` | number (0 to 1) | Controls fraction of context window reserved for skill catalog discovery and matching. | docs |
| `alwaysThinkingEnabled` | boolean | Enables extended thinking (Claude Opus reasoning mode) by default for all sessions. | docs |
| `showThinkingSummaries` | boolean | Displays thinking process summaries to user when extended thinking is active. | inferred |
| `awaySummaryEnabled` | boolean | Generates a summary of work completed when returning to a paused session. | inferred |
| `autoMode` | string (enum: `"auto"` \| `"plan"` \| `"acceptEdits"` \| `"default"`) | Default permission mode controlling whether Claude auto-accepts edits, requires approval, or asks per-tool. | observed |
| `modelOverrides` | object (map of surface names to model strings) | Per-surface model selection overrides (e.g., terminal, vs-code, web, desktop). | inferred |
| `availableModels` | array of strings | Restricts user model selection to a whitelist of available model identifiers. | docs |
| `attribution` | boolean | Enables attribution metadata and source citations in Claude's responses. | inferred |
| `autoUpdatesChannel` | string (enum: `"stable"` \| `"latest"`) | Controls automatic update frequency: stable (weekly) or latest (daily/as-released). | docs |
| `spinnerTipsEnabled` | boolean | Shows helpful tips and context while Claude is processing and thinking. | docs |
| `teammateMode` | string (enum: `"auto"` \| `"on"` \| `"off"`) | Controls shared-session collaboration and visibility when multiple users are working together. | inferred |
| `agent` | object (agent configuration) | Configuration for agent-specific behavior and agentic-loop tuning. | inferred |
| `enabledMcpjsonServers` | array of strings | Whitelist of MCP server identifiers to enable from `.mcp.json` registry. | inferred |
| `disabledMcpjsonServers` | array of strings | Blacklist of MCP server identifiers to disable despite being defined in `.mcp.json`. | inferred |
| `enabledPlugins` | object (map of plugin IDs to boolean) | Per-plugin enable/disable toggle for installed Claude Code plugins and marketplace extensions. | docs |
| `showClearContextOnPlanAccept` | boolean | Displays context-clearing prompt when user accepts a plan in plan-review mode. | docs |
| `plansDirectory` | string (file path) | Filesystem path where Claude saves plan documents (`.claude/plans` by default). | docs |
| `cleanupPeriodDays` | number (integer days) | Retention window in days for automatic cleanup of old session files and chat history. | docs |

See [effort-and-thinking.md](effort-and-thinking.md) for the full effort + thinking-token system (`effortLevel`, `alwaysThinkingEnabled`, `showThinkingSummaries`).

See [output-and-session-surfaces.md](output-and-session-surfaces.md) for `outputStyle`, `statusLine`, and `/rewind` checkpointing.

---

## Related References

- [frontmatter-reference.md](frontmatter-reference.md) — `permissionMode` frontmatter field on agents
- [agents-patterns.md](agents-patterns.md) — agent permission mode table
- [hooks-reference.md](hooks-reference.md) — PreToolUse hook response shape
- Official docs: https://code.claude.com/docs/en/permissions, https://code.claude.com/docs/en/settings, https://code.claude.com/docs/en/sandboxing
