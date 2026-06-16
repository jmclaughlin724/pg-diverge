# Output Styles, Status Line, and Checkpointing

Three session-surface config areas: output styles (system-prompt persona), the status line (custom bottom bar), and checkpointing/rewind (session-state recovery).

> Sources: https://code.claude.com/docs/en/output-styles, https://code.claude.com/docs/en/statusline, https://code.claude.com/docs/en/checkpointing. When those pages contradict this file, the official docs win — open a PR updating this reference.

## Contents

- [Output Styles](#output-styles)
- [Status Line](#status-line)
- [Checkpointing and Rewind](#checkpointing-and-rewind)

---

## Output Styles

Output styles modify the **system prompt** — role, tone, output format — not what Claude knows. Use one when you keep re-prompting for the same voice/format, or want Claude to act as something other than a software engineer. For project conventions use CLAUDE.md instead.

### Built-in styles

| Style | Behavior |
| --- | --- |
| `Default` | Standard software-engineering system prompt |
| `Proactive` | Execute immediately, make reasonable assumptions, prefer action over planning. Stronger autonomy than auto mode, but does **not** change permission mode or override this repo's actionable-prompt context gate |
| `Explanatory` | Adds educational "Insights" while completing tasks |
| `Learning` | Collaborative learn-by-doing; inserts `TODO(human)` markers for you to implement |

### Setting one

- `/config` → **Output style** (selection saved to `.claude/settings.local.json`).
- Or set the `outputStyle` settings key directly (e.g. `"outputStyle": "Explanatory"`).
- The standalone `/output-style` command was deprecated in v2.1.73 and removed in v2.1.91.
- Output style is in the system prompt (read once at session start). Mid-session changes apply only after `/clear` or a new session — see [prompt-caching-runtime.md](prompt-caching-runtime.md#actions-that-keep-the-cache).

### Custom styles

A Markdown file: frontmatter + instructions appended to the system prompt. Locations: `~/.claude/output-styles` (user), `.claude/output-styles` (project), managed settings dir, or a plugin's `output-styles/`. Filename is the style name unless `name` is set.

| Frontmatter | Purpose | Default |
| --- | --- | --- |
| `name` | Display name if not the filename | filename |
| `description` | Shown in the `/config` picker | none |
| `keep-coding-instructions` | Keep Claude Code's built-in SWE instructions | `false` |
| `force-for-plugin` | Plugin-only: auto-apply when the plugin is enabled, overriding the user's `outputStyle` | `false` |

Related: `--append-system-prompt` (one-off addition), [agents](subagent-configuration.md) (separate scoped system prompt), [skills](skills-patterns.md) (task instructions on invoke).

---

## Status Line

A custom bottom bar that runs a shell script each update, receiving session JSON on stdin and printing whatever it outputs.

### Configure

```json
{
  "statusLine": {
    "type": "command",
    "command": "~/.claude/statusline.sh",
    "padding": 2
  }
}
```

| Field | Purpose |
| --- | --- |
| `type` | `"command"` |
| `command` | Script path or inline shell (e.g. a `jq` one-liner) |
| `padding` | Extra horizontal spacing in chars (default `0`) |
| `refreshInterval` | Re-run every N seconds (min `1`) for time-based data or idle background updates |
| `hideVimModeIndicator` | Suppress built-in `-- INSERT --` when the script renders `vim.mode` itself |

`/statusline <description>` generates a script and wires settings automatically; `/statusline delete` removes it. Updates fire after each assistant message, after `/compact`, on permission-mode change, and on vim-mode toggle (debounced 300ms; in-flight runs cancelled). Read terminal width from `COLUMNS`/`LINES` env vars (v2.1.153+), not `tput`. Runs locally; no API tokens.

### Available stdin JSON fields

| Field | Description |
| --- | --- |
| `model.id`, `model.display_name` | Model identifier and display name |
| `cwd`, `workspace.current_dir`, `workspace.project_dir`, `workspace.added_dirs` | Directories (current, launch, `--add-dir`) |
| `workspace.git_worktree`, `workspace.repo.{host,owner,name}` | Worktree + origin-remote identity |
| `cost.total_cost_usd`, `cost.total_duration_ms`, `cost.total_api_duration_ms`, `cost.total_lines_added`, `cost.total_lines_removed` | Session cost/time/diff |
| `context_window.total_input_tokens`, `context_window.total_output_tokens`, `context_window.context_window_size`, `context_window.used_percentage`, `context_window.remaining_percentage`, `context_window.current_usage` | Context usage (`current_usage` carries `cache_creation_input_tokens` / `cache_read_input_tokens` — see [prompt-caching-runtime.md](prompt-caching-runtime.md#check-performance)) |
| `exceeds_200k_tokens` | Total tokens exceed 200k (fixed threshold) |
| `effort.level` | Live effort (`low`–`max`; ultracode reports as `xhigh`); absent when model lacks effort support |
| `thinking.enabled` | Extended thinking on/off |
| `rate_limits.five_hour.*`, `rate_limits.seven_day.*` | `used_percentage` + `resets_at` (epoch seconds) |
| `session_id`, `session_name`, `transcript_path`, `version` | Session/build metadata |
| `output_style.name` | Current output style |
| `vim.mode`, `agent.name` | Vim mode; `--agent` name |
| `pr.number`, `pr.url`, `pr.review_state` | Open PR for the branch (`approved`/`pending`/`changes_requested`/`draft`) |
| `worktree.{name,path,branch,original_cwd,original_branch}` | `--worktree` session details |

Output supports multiple lines (one per `echo`), ANSI colors, and OSC 8 clickable links.

---

## Checkpointing and Rewind

Claude Code automatically checkpoints code state before each of Claude's file edits.

- Every user prompt creates a checkpoint; checkpoints persist across sessions (available in resumed conversations) and are cleaned up with sessions after `cleanupPeriodDays` (default 30).
- Open the menu with `/rewind` or `Esc Esc` when the prompt input is empty (with text, double-`Esc` clears it — saved to input history, recall with `Up`).

| Action | Effect |
| --- | --- |
| Restore code and conversation | Revert both to the selected point |
| Restore conversation | Rewind messages, keep current code |
| Restore code | Revert files, keep the conversation |
| Summarize from here | Compress the selected message forward into a summary |
| Summarize up to here | Compress before the selected message, keep later messages |
| Never mind | Cancel |

`/rewind` truncates to a prefix that is already cached, unlike `/compact` which rebuilds — see [prompt-caching-runtime.md](prompt-caching-runtime.md#actions-that-keep-the-cache).

**Not tracked:** files changed by Bash commands (`rm`, `mv`, `cp`), and external/other-session edits unless they touch the same files. Checkpoints are session-level "local undo," not a Git replacement. Disable file checkpointing with `CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING=1`.

## Related References

- [prompt-caching-runtime.md](prompt-caching-runtime.md) — output style sits in the system-prompt cache layer; statusline `current_usage` fields
- [effort-and-thinking.md](effort-and-thinking.md) — `effort.level` / `thinking.enabled` statusline fields
- [permissions-and-settings.md](permissions-and-settings.md) — `outputStyle`, `statusLine`, `cleanupPeriodDays` in the key catalog
- Official docs: https://code.claude.com/docs/en/output-styles, https://code.claude.com/docs/en/statusline, https://code.claude.com/docs/en/checkpointing
