---
name: code-review
description: Review the current diff for correctness bugs and reuse/simplification/efficiency cleanups. Use when asked to review a PR, branch, diff, local changes, or code changes for bugs and actionable cleanups.
user-invocable: true
argument-hint: "[low|medium|high|xhigh|max|ultra] [--fix] [--comment] [<target>]"
---

## Contract

Run the extracted Claude Code code-review procedure. Use the effort-specific prompt body from `references/`, then append the exact flag instructions when `--fix` or `--comment` is present.

This extraction preserves the built-in prompt contents separately from this dispatcher file so the full payload stays readable and each embedded body can be verified against the binary.

## Command Metadata

- Menu description: `Review the current diff for bugs and cleanups`.
- Invocable name: `code-review`.
- Subcommand: `ultra` maps to `ultrareview` in Claude Code.
- Levels: `low`, `medium`, `high`, `xhigh`, `max`; `ultra` falls back to local `max` prompt behavior when the cloud review cannot be launched from the agent context.
- Flags: `--fix` applies findings after review; `--comment` posts or prints PR comments after review.

## Dispatch

1. Parse flags `--fix` and `--comment` from the argument string.
2. Treat the first non-flag token as an effort level when it matches `low`, `medium`, `high`, `xhigh`, or `max`.
3. Treat `ultra` as the cloud-review subcommand; when operating locally, use the `max` effort body and note the local fallback.
4. If no effort is explicit, use `medium`.
5. Read the selected effort file completely before reviewing.
6. If `--comment` is present, also read `references/flag-comment.md` and follow it after findings are produced.
7. If `--fix` is present, also read `references/flag-fix.md` and follow it after findings are produced.
8. For the workflow-backed high/xhigh/max path, the complete extracted workflow implementation is stored in `references/workflow-backed-code-review.js`.

## Reference Index

- `references/low.md`: low-effort inline prompt.
- `references/medium.md`: medium-effort inline prompt.
- `references/high.md`: high-effort inline prompt.
- `references/xhigh.md`: extra-high-effort inline prompt.
- `references/max.md`: maximum-effort inline prompt.
- `references/flag-comment.md`: exact `--comment` appendix.
- `references/flag-fix.md`: exact `--fix` appendix.
- `references/workflow-backed-code-review.js`: exact workflow-backed implementation extracted from the binary.

## Verification

Extraction is valid when the reference files match the decoded binary payloads and the repo agent-surface sync checks pass.
