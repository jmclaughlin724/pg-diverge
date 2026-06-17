---
enforcement:
  type: judgment-only
description: Editing safety, dirty worktree handling, git shortcut bans, staging/commit discipline, and source deletion sweeps.
paths:
  - "src/**"
  - "tests/**"
  - "docs/**"
  - "scripts/**"
  - "bin/**"
  - "services/agent-mcp/**"
  - ".claude/**"
  - ".codex/**"
  - ".agents/**"
  - "AGENTS.md"
  - "CLAUDE.md"
---

# Rule 14 — Editing, worktree, and git

## Contract

This rule owns edit safety, dirty-worktree handling, generated mirror discipline, deletion/rename sweeps, and git shortcut bans. It prevents agents from overwriting user-owned work or treating a clean worktree as a prerequisite.

## Editing rules

- Read enough local context before editing.
- Keep changes owner-scoped and use the narrowest owner that can satisfy the request.
- Prefer structured edits (`apply_patch`, editor tool, AST/LSP rename, or repo codemod) over shell write tricks for source changes.
- Do not use broad replacement on substrings of wider identifiers. Verify uniqueness or use AST/LSP rename.
- Do not hand-edit generated artifacts such as `dist/**`, generated config contract outputs, generated migrations, generated docs output, Code Atlas scratch output, or LLM mirrors.
- For generated surfaces, edit the canonical owner and run the generator or sync command.

## Dirty worktree rules

- A dirty worktree is a normal state. Do not block on a clean tree.
- You may edit task-owned dirty files, but preserve hunks you did not intentionally author in the current task.
- Do not revert, stash, reset, clean, or overwrite unrelated tracked or untracked files.
- If a file changed since you read it, re-read it, preserve unrelated hunks, and continue.
- Treat watcher, dev-server, hook, subagent, and parallel-agent work as user-owned unless you started the process in the current task.

## Git safety

- Commit only when explicitly asked.
- Before committing, branch off the default branch if the repo workflow requires it.
- Let lefthook/pre-commit/pre-push run. Never use `--no-verify`.
- Do not use `git reset --hard`, `git checkout --`, `git restore --source`, `git stash`, force-push, or destructive branch operations without explicit approval.
- Do not use `git push` as a diagnostic. Use the repo pre-push script or `git push --dry-run` only when remote negotiation itself must be tested.
- Before creating or replacing a PR, verify the intended base branch, current head branch, upstream, existing PRs for the head branch, commit count, changed-file count, and mergeability.
- Do not open a PR from a long-lived, release-scoped, conflict-producing, or overbroad branch that contains commits outside the requested task. Create a clean task branch from the intended base instead.
- If a PR was opened from the wrong branch, create and verify a clean replacement PR before closing or superseding the bad PR. Document why the old PR was superseded.
- Subagents and workers may edit files only. They must not stage, commit, push, switch branches, create branches, create worktrees, force-push, merge, or open/replace PRs.
- Only the main agent may stage, commit, or push, and only on the current branch after explicit user instruction. The main agent owns final integration, branch cleanup, PR creation/replacement, merge, and final verification.

## Delete, rename, and export-shape sweeps

Before deleting, renaming, privatizing, or changing a public export/package surface:

1. Query Code Atlas for owners and consumers.
2. Use cclsp/LSP for references when the symbol is in code.
3. Use exact fixed-string search for docs, fixtures, generated-surface references, package manifests, examples, and prose.
4. Update or retire consumers in the same change.
5. Update tests, docs, package boundary expectations, and generated mirrors if the public surface changed.

## Verification

Before closeout or staging:

```bash
git status --short
git diff -- <touched files>
```

Before PR creation or replacement:

```bash
git status --short --branch
git log --oneline --left-right <base>...HEAD
git diff --stat <base>...HEAD
git merge-tree --write-tree --name-only --messages <base> HEAD
```

Run the owner checks for the changed surface. For source deletion, rename, export, package, or generated-surface work, include Code Atlas or cclsp/source evidence for the consumer sweep.

## Failure behavior

If verification fails, fix failures caused by the current change and rerun the failed command. Do not revert unrelated user work to reach a cleaner diff. If another session owns overlapping generated output, preserve unrelated hunks and rerun the canonical sync/generator.

## Done means

- Only task-owned hunks were changed.
- Unrelated dirty work was preserved.
- Generated mirrors were synced from their owners, not patched directly.
- Delete/rename/export changes include consumer-sweep evidence.
- Requested commit/push/PR work used approved git paths, verified the intended scope, and did not bypass hooks.
