---
enforcement:
  type: judgment-only
description: Editing safety, dirty worktree handling, git shortcut bans, staging/commit discipline, and source deletion sweeps.
codexExecPolicy: |
  [
    {
      "pattern": ["git", "checkout"],
      "decision": "forbidden",
      "justification": "Rule 14 forbids git checkout; keep work in the current branch and use git show or git diff for read-only comparisons.",
      "match": ["git checkout main"],
      "not_match": ["git show main:package.json", "git diff main -- package.json"]
    },
    {
      "pattern": ["git", "switch", "-c"],
      "decision": "allow",
      "justification": "Rule 14 allows transactional topic-branch creation after explicit PR intent, origin/main fetch, and base proof; the Bash hook validates the complete command.",
      "match": ["git switch -c feature/demo origin/main"],
      "not_match": ["git switch --track origin/feature/demo", "git switch -C feature/demo origin/main"]
    },
    {
      "pattern": ["git", "switch", "--track"],
      "decision": "allow",
      "justification": "Rule 14 allows transactional tracking of an existing origin topic branch after explicit PR intent, fetch, and base proof; the Bash hook validates the complete command.",
      "match": ["git switch --track origin/feature/demo"],
      "not_match": ["git switch -c feature/demo origin/main", "git switch main"]
    },
    {
      "pattern": ["git", "switch", ["-C", "--force-create", "-f", "--force", "--discard-changes", "-m", "--merge"]],
      "decision": "forbidden",
      "justification": "Rule 14 forbids branch replacement and switch modes that discard, stash, or merge local changes.",
      "match": ["git switch -C feature/demo origin/main", "git switch --discard-changes feature/demo", "git switch --merge feature/demo"],
      "not_match": ["git switch -c feature/demo origin/main", "git switch --track origin/feature/demo"]
    },
    {
      "pattern": ["git", "branch"],
      "decision": "forbidden",
      "justification": "Rule 14 forbids direct git branch commands; use transactional git switch forms for PR branches and git rev-parse for discovery.",
      "match": ["git branch feature/demo", "git branch --show-current"],
      "not_match": ["git rev-parse --abbrev-ref HEAD", "git status --short"]
    },
    {
      "pattern": ["git", "worktree"],
      "decision": "forbidden",
      "justification": "Rule 14 forbids ad hoc CLI worktrees; use host-managed worktree isolation only when the host selects it before work begins.",
      "match": ["git worktree add ../demo HEAD", "git worktree list"],
      "not_match": ["git status --short"]
    },
    {
      "pattern": ["git", "reset"],
      "decision": "forbidden",
      "justification": "Rule 14 forbids git reset because it can discard unrelated work.",
      "match": ["git reset --hard"],
      "not_match": ["git status --short"]
    },
    {
      "pattern": ["git", "stash"],
      "decision": "forbidden",
      "justification": "Rule 14 forbids git stash; preserve unrelated work in place.",
      "match": ["git stash"],
      "not_match": ["git status --short"]
    },
    {
      "pattern": ["git", "clean"],
      "decision": "forbidden",
      "justification": "Rule 14 forbids destructive clean operations without explicit approval.",
      "match": ["git clean -fd"],
      "not_match": ["git status --ignored --short"]
    },
    {
      "pattern": ["git", "commit", "--no-verify"],
      "decision": "forbidden",
      "justification": "Rule 14 forbids bypassing hooks; fix the hook failure instead.",
      "match": ["git commit --no-verify -m skip"],
      "not_match": ["git commit --signoff -m update"]
    },
    {
      "pattern": ["git", "merge", "--squash"],
      "decision": "forbidden",
      "justification": "Rule 14 forbids local squash merges for PR merge workflow.",
      "match": ["git merge --squash feature/demo"],
      "not_match": ["git merge-base --is-ancestor HEAD origin/main"]
    },
    {
      "pattern": ["git", "push", "--force"],
      "decision": "forbidden",
      "justification": "Rule 14 forbids force-push shortcuts.",
      "match": ["git push --force origin main"],
      "not_match": ["git push origin HEAD:main"]
    },
    {
      "pattern": ["git", "push", "--force-with-lease"],
      "decision": "forbidden",
      "justification": "Rule 14 forbids force-push shortcuts.",
      "match": ["git push --force-with-lease origin main"],
      "not_match": ["git push origin HEAD:main"]
    },
    {
      "pattern": ["git", "restore", "--source"],
      "decision": "forbidden",
      "justification": "Rule 14 forbids git restore --source because it overwrites local files from another ref.",
      "match": ["git restore --source HEAD~1 src/index.ts"],
      "not_match": ["git diff -- src/index.ts"]
    },
    {
      "pattern": ["git", "restore", "-s"],
      "decision": "forbidden",
      "justification": "Rule 14 forbids git restore -s because it overwrites local files from another ref.",
      "match": ["git restore -s HEAD~1 src/index.ts"],
      "not_match": ["git show HEAD~1:src/index.ts"]
    }
  ]
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

This rule owns edit safety, dirty-worktree handling, generated mirror discipline, deletion/rename sweeps, and local git shortcut bans. Rule 20 owns the consolidated anti-pattern index. Rule 21 owns GitHub repository settings, direct-main pushes, canonical PR merge method, branch cleanup, and settings audit.

## Editing rules

- Read enough local context before editing.
- Keep changes owner-scoped and use the canonical owner that satisfies the requested end state.
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
- Direct-`main` work (Rule 21) commits on `main` and pushes `git push origin HEAD:main`, so local `main` stays in sync with `origin/main`.
- PR work requires explicit PR intent and a topic checkout before the first commit. When the host selects managed worktree isolation before work begins, use that checkout. Otherwise run `git fetch origin main`, prove `HEAD` equals `origin/main`, and create and enter the topic branch atomically with `git switch -c <branch> origin/main`. A dirty index or worktree may move with the switch; Git must abort rather than lose changes.
- To continue an existing remote topic branch, fetch it, prove `HEAD` equals `origin/main` and the remote topic branch is based on that fetched `origin/main`, then use `git switch --track origin/<branch>`.
- Never commit PR-scoped work on local `main` and push it to a branch ref. Do not create a compatibility or recovery path that moves task commits off local `main` after the fact; the topic checkout is a pre-commit invariant.
- Let lefthook/pre-commit/pre-push run. Never use `--no-verify`.
- Do not use `git checkout`, direct `git branch`, or ad hoc `git worktree`. Apart from the two transactional topic-branch forms above, do not use `git switch`.
- Do not use `git switch -C`, `--force-create`, `--force`, `--discard-changes`, `--merge`, or their short forms.
- Do not use `git reset`, `git restore --source`, `git stash`, `git merge --squash`, force-push, or destructive branch operations without explicit approval.
- Do not use `git push` as a diagnostic. Use the repo pre-push script or `git push --dry-run` only when remote negotiation itself must be tested.
- Before creating or replacing a PR, follow Rule 21 and prove the active checkout is the intended topic branch.
- Do not open a PR from a long-lived, release-scoped, conflict-producing, or overbroad branch that contains commits outside the requested task. Rule 21 owns the remote PR checks that prove this.
- If a PR was opened from the wrong branch, follow Rule 21 to create and verify a clean replacement PR before closing or superseding the bad PR. Document why the old PR was superseded.
- Subagents and workers may edit files only. They must not stage, commit, push, switch branches, create branches, create worktrees, force-push, merge, or open/replace PRs.
- Only the main agent may stage, commit, or push, and only on the current branch after explicit user instruction. The main agent owns final integration, PR creation/replacement, merge, branch cleanup, and final verification through Rule 21.

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

Run the owner checks for the changed surface. For source deletion, rename, export, package, or generated-surface work, include Code Atlas or cclsp/source evidence for the consumer sweep. For anti-pattern changes, update Rule 20 and run its verification path.

## Failure behavior

If verification fails, fix failures caused by the current change and rerun the failed command. Do not revert unrelated user work to reach a cleaner diff. If another session owns overlapping generated output, preserve unrelated hunks and rerun the canonical sync/generator.

## Done means

- Only task-owned hunks were changed.
- Unrelated dirty work was preserved.
- Generated mirrors were synced from their owners, not patched directly.
- Delete/rename/export changes include consumer-sweep evidence.
- Requested commit/push/PR work used approved git paths, verified the intended scope, and did not bypass hooks.
