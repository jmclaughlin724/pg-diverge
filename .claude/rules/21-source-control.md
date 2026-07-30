---
enforcement:
  type: judgment-only
description: Single source-control owner for worktrees, Git commands, branches, commits, pushes, GitHub settings, pull requests, merges, and cleanup.
codexExecPolicy: |
  [
    {
      "pattern": ["git", "checkout"],
      "decision": "forbidden",
      "justification": "Rule 21 forbids git checkout; keep work in the current branch and use git show or git diff for read-only comparisons.",
      "match": ["git checkout main"],
      "not_match": ["git show main:package.json", "git diff main -- package.json"]
    },
    {
      "pattern": ["git", "switch", "main"],
      "decision": "allow",
      "justification": "Rule 21 allows returning to main after the current topic PR is verified merged; the Bash hook validates command shape.",
      "match": ["git switch main"],
      "not_match": ["git switch -C main origin/main"]
    },
    {
      "pattern": ["git", "switch", "-c"],
      "decision": "allow",
      "justification": "Rule 21 allows transactional topic-branch creation once origin/main fetch and base proof are complete; the Bash hook validates command shape.",
      "match": ["git switch -c feature/demo origin/main"],
      "not_match": ["git switch --track origin/feature/demo", "git switch -C feature/demo origin/main"]
    },
    {
      "pattern": ["git", "switch", "--track"],
      "decision": "allow",
      "justification": "Rule 21 allows tracking an existing origin topic branch once fetch and base proof are complete; the Bash hook validates command shape.",
      "match": ["git switch --track origin/feature/demo"],
      "not_match": ["git switch -c feature/demo origin/main", "git switch main"]
    },
    {
      "pattern": ["git", "switch", ["-C", "--force-create", "-f", "--force", "--discard-changes", "-m", "--merge"]],
      "decision": "forbidden",
      "justification": "Rule 21 forbids branch replacement and switch modes that discard, stash, or merge local changes.",
      "match": ["git switch -C feature/demo origin/main", "git switch --discard-changes feature/demo", "git switch --merge feature/demo"],
      "not_match": ["git switch -c feature/demo origin/main", "git switch --track origin/feature/demo"]
    },
    {
      "pattern": ["git", "branch"],
      "decision": "allow",
      "justification": "The Bash hook limits git branch to one merged-topic deletion and blocks creation, discovery, main deletion, and unsupported forms.",
      "match": ["git branch -D feature/demo", "git branch feature/demo"],
      "not_match": ["git rev-parse --abbrev-ref HEAD", "git status --short"]
    },
    {
      "pattern": ["git", "worktree"],
      "decision": "forbidden",
      "justification": "Rule 21 forbids every worktree command; continue only in the active primary checkout.",
      "match": ["git worktree list --porcelain -z", "git worktree add ../demo HEAD"],
      "not_match": ["git status --short"]
    },
    {
      "pattern": ["git", "reset"],
      "decision": "forbidden",
      "justification": "Rule 21 forbids git reset because it can discard unrelated work.",
      "match": ["git reset --hard"],
      "not_match": ["git status --short"]
    },
    {
      "pattern": ["git", "stash"],
      "decision": "forbidden",
      "justification": "Rule 21 forbids git stash; preserve unrelated work in place.",
      "match": ["git stash"],
      "not_match": ["git status --short"]
    },
    {
      "pattern": ["git", "clean"],
      "decision": "forbidden",
      "justification": "Rule 21 forbids destructive clean operations without explicit approval.",
      "match": ["git clean -fd"],
      "not_match": ["git status --ignored --short"]
    },
    {
      "pattern": ["git", "commit", "--no-verify"],
      "decision": "forbidden",
      "justification": "Rule 21 forbids bypassing hooks; fix the hook failure instead.",
      "match": ["git commit --no-verify -m skip"],
      "not_match": ["git commit --signoff -m update"]
    },
    {
      "pattern": ["git", "merge", "--squash"],
      "decision": "forbidden",
      "justification": "Rule 21 forbids local squash merges for PR merge workflow.",
      "match": ["git merge --squash feature/demo"],
      "not_match": ["git merge-base --is-ancestor HEAD origin/main"]
    },
    {
      "pattern": ["git", "push", "--force"],
      "decision": "forbidden",
      "justification": "Rule 21 forbids force-push shortcuts.",
      "match": ["git push --force origin main"],
      "not_match": ["git push origin HEAD:main"]
    },
    {
      "pattern": ["git", "push", "--force-with-lease"],
      "decision": "forbidden",
      "justification": "Rule 21 forbids force-push shortcuts.",
      "match": ["git push --force-with-lease origin main"],
      "not_match": ["git push origin HEAD:main"]
    },
    {
      "pattern": ["git", "restore", "--source"],
      "decision": "forbidden",
      "justification": "Rule 21 forbids git restore --source because it overwrites local files from another ref.",
      "match": ["git restore --source HEAD~1 src/index.ts"],
      "not_match": ["git diff -- src/index.ts"]
    },
    {
      "pattern": ["git", "restore", "-s"],
      "decision": "forbidden",
      "justification": "Rule 21 forbids git restore -s because it overwrites local files from another ref.",
      "match": ["git restore -s HEAD~1 src/index.ts"],
      "not_match": ["git show HEAD~1:src/index.ts"]
    },
    {
      "pattern": ["gh", "pr", "merge", "--rebase"],
      "decision": "forbidden",
      "justification": "Rule 21 uses GitHub squash merges with branch cleanup; use gh pr merge <number> --squash --delete-branch.",
      "match": ["gh pr merge --rebase 53"],
      "not_match": ["gh pr merge 53 --squash --delete-branch"]
    },
    {
      "pattern": ["gh", "pr", "merge", "--merge"],
      "decision": "forbidden",
      "justification": "Rule 21 forbids merge commits; use gh pr merge <number> --squash --delete-branch.",
      "match": ["gh pr merge --merge 53"],
      "not_match": ["gh pr merge 53 --squash --delete-branch"]
    },
    {
      "pattern": ["gh", "pr", "merge", "--admin"],
      "decision": "forbidden",
      "justification": "Rule 21 forbids admin merge bypasses unless the user explicitly approves and records the exception.",
      "match": ["gh pr merge --admin 53"],
      "not_match": ["gh pr merge 53 --squash --delete-branch"]
    },
    {
      "pattern": ["gh", "pr", "merge", "--disable-auto"],
      "decision": "forbidden",
      "justification": "Rule 21 forbids disabling auto-merge as a merge workaround.",
      "match": ["gh pr merge --disable-auto 53"],
      "not_match": ["gh pr merge 53 --squash --delete-branch"]
    },
    {
      "pattern": ["gh", "pr", "merge"],
      "decision": "prompt",
      "justification": "Keep selector-before-flag merge forms behind policy validation; the Bash hook then permits only GitHub squash merge with branch deletion.",
      "match": ["gh pr merge 53 --rebase", "gh pr merge 53 --squash --delete-branch"],
      "not_match": ["gh pr view 53"]
    },
    {
      "pattern": ["git", "push", "origin", "HEAD:main"],
      "decision": "forbidden",
      "justification": "Rule 21 requires all main updates to pass through a protected pull request.",
      "match": ["git push origin HEAD:main"],
      "not_match": ["git push -u origin codex/feature"]
    }
  ]
paths:
  - ".github/**"
  - ".gitignore"
  - ".gitattributes"
  - ".claude/rules/21-source-control.md"
  - ".claude/hooks/**"
  - ".codex/hooks/**"
  - "scripts/github/**"
  - "scripts/guards/ci-release/check-github-process.mjs"
  - "scripts/guards/check-all.mjs"
  - "package.json"
  - "AGENTS.md"
  - "CLAUDE.md"
---

# Rule 21 - Source control and GitHub

## Contract

This rule is the single owner for source-control state and lifecycle: dirty worktrees, Git command safety, branch creation, staging, commits, pushes, GitHub repository settings, pull requests, squash merging, local and remote branch cleanup, and live settings audit.

Rule 14 owns file-edit safety and deletion/rename sweeps. Rule 09 owns GitHub Actions workflow posture. Rule 19 owns release-version transactions.

Upstream sources:

- GitHub protected branches: <https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches>
- GitHub merge methods: <https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/about-merge-methods-on-github>
- GitHub ruleset rules: <https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets>
- GitHub automatic branch deletion: <https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-the-automatic-deletion-of-branches>
- GitHub CLI `gh pr merge`: <https://cli.github.com/manual/gh_pr_merge>
- GitHub CLI `gh repo edit`: <https://cli.github.com/manual/gh_repo_edit>
- Git worktrees: <https://git-scm.com/docs/git-worktree>

## Dirty worktree rules

- A dirty worktree is normal. Do not block on a clean tree unless a specific Git operation requires it.
- Preserve hunks and files not intentionally authored in the current task.
- Do not revert, stash, reset, clean, or overwrite unrelated tracked or untracked work.
- A file changed by a watcher, dev server, hook, subagent, or parallel session is user-owned unless the current task started that process.
- Stage only task-owned hunks after reviewing the intended diff.

## Git safety

- Commit, push, open a PR, or merge only when explicitly requested. Branch creation, switching, and merged-topic deletion are judged by command shape: the Bash hook permits only the transactional forms below, and the agent still needs a task reason to use them.
- Deleting a merged topic branch is routine cleanup, not a gated action. Once a topic PR is proved merged, delete the local branch as part of post-merge closeout without waiting for separate approval.
- Every update to `main` uses a protected pull request. Direct pushes to `main` are prohibited.
- The checkout and branch active when work begins are the only authorized workspace by default. Do not create a worktree, enter a linked worktree, or move work to another checkout.
- Keep one active topic branch at a time. Do not create a separate branch off the active branch (no stacked branches); follow-up commits and review fixes for an open PR stay on its branch. Once the active branch's PR is squash-merged, the branch is archived: complete the post-merge closeout below and delete it locally and remotely before any new work, which starts on a fresh topic from `origin/main`.
- When the current user prompt explicitly requests a topic branch, run `git fetch origin main`, prove `HEAD` equals `origin/main`, and create and enter the topic branch atomically with `git switch -c <branch> origin/main`.
- When continuing an existing remote topic branch that has no local ref, fetch it, prove `HEAD` equals `origin/main` and the remote topic is based on fetched `origin/main`, then use `git switch --track origin/<branch>`.
- When returning to a topic branch that already exists locally — for example to address PR review findings after working elsewhere — use `git switch --no-guess <branch>`. `--no-guess` is required: Git's default DWIM behavior would otherwise create and track a new local branch from a unique `origin/<branch>`, bypassing the fetch and base-proof path above. Verify the local ref matches its pushed remote first so the return cannot silently resurrect stale work.
- Never commit PR-scoped work on local `main` and push it to a branch ref. Do not create a recovery path that moves task commits off local `main` after the fact.
- Let lefthook, pre-commit, and pre-push run. Never use `--no-verify`.
- Do not use `git checkout` or `git branch` for creation or discovery. Do not run any `git worktree` command. Apart from the four forms above — `git switch main` after verified PR merge, `git switch --no-guess <existing local topic>`, `git switch -c <topic> origin/main`, and `git switch --track origin/<topic>` — do not use `git switch`.
- Branch operands must be literal, validated topic-branch names. Revision expressions such as `@{-1}`, `HEAD~1`, or `topic^`, and unexpanded shell operands such as `$BRANCH` or `$(cmd)`, are rejected: Git resolves them to other refs, including `main`, and `git branch -D` deletes regardless of merge state.
- Subagents must never create, switch, or delete a branch. The Bash hook denies every branch command when the call carries `agent_id`, because subagents share the active primary checkout.
- After proving a topic PR merged and preserving all dirty work elsewhere, delete the local topic with `git branch -D <topic>`. Never delete `main`, an unmerged branch, or more than one branch per command.
- Do not use `git switch -C`, `--force-create`, `--force`, `--discard-changes`, `--merge`, or their short forms.
- Do not use `git reset`, `git restore --source`, `git stash`, `git merge --squash`, force-push, or destructive branch operations without explicit approval.
- Do not use `git push` as a diagnostic. Use the repo pre-push script or `git push --dry-run` only when remote negotiation itself must be tested.
- Run `git commit`, `git push`, and merge commands bare. Never pipe them through `tail`, `head`, or another truncator: the pipe hides hook output and replaces the command's exit status with the truncator's, so a failed commit reads as success. When output must be scoped, redirect to a file, verify the exit code explicitly, then read the file. The Bash-safety hook blocks the piped shapes; the `codexExecPolicy` argv grammar cannot express pipes, so this shape is hook-enforced only.
- Subagents and workers may edit files only inside the active primary checkout. They must not stage, commit, push, switch branches, create branches or worktrees, merge, or open or replace PRs.
- Only the main agent may stage, commit, push, create or replace a PR, merge, clean up branches, and perform final source-control verification.

## Canonical policy

`.github/repo-policy.json` is the machine-readable owner for intended GitHub repository and branch-protection state.

Required repository settings:

- `default_branch` MUST be `main`.
- Repository topics MUST match `repositoryTopics` in `.github/repo-policy.json`.
- `allow_squash_merge` MUST be `true`.
- `allow_rebase_merge` MUST be `false`.
- `allow_merge_commit` MUST be `false`.
- `allow_auto_merge` SHOULD be `true`.
- `delete_branch_on_merge` MUST be `true`.
- `web_commit_signoff_required` MUST be `false`.
- Commit signoff MUST NOT be enforced by GitHub settings, CI, package scripts, PR template checklists, or repo guards unless the user explicitly approves a new contributor-certificate policy in the same change.

Required GitHub Actions repository settings:

- GitHub Actions MUST be enabled.
- Repository Actions policy MUST require full-length SHA pinning.
- Repository Actions policy MUST allow GitHub-owned actions plus only the reviewed third-party repositories named by `.github/repo-policy.json`; every executable ref remains full-SHA pinned.
- Default `GITHUB_TOKEN` permissions MUST be read-only.
- GitHub Actions MUST NOT be allowed to create or approve pull-request reviews.
- First-time outside contributor workflow approval MUST remain enabled for public-fork PRs.

Required `main` branch protection:

- `required_linear_history` MUST be `true`.
- `direct_pushes` MUST be `false`; every update to `main` must use a pull request.
- Classic branch protection MUST NOT duplicate required status checks or pull-request review settings; the repository ruleset owns those gates.
- `required_conversation_resolution` MUST be `true` for PRs when PRs are used.
- `enforce_admins` MUST be `true`.
- `allow_force_pushes` MUST be `false`.
- `allow_deletions` MUST be `false`.
- `required_signatures` MUST be `false`.
- Review and status-check settings MUST match `.github/repo-policy.json`; if required reviews or status checks are introduced, update the policy, CODEOWNERS expectations, PR template, and this rule in the same change.

Required repository ruleset:

- A repository branch ruleset named `main branch policy` MUST be active and target the default branch.
- The ruleset MUST block deletion and non-fast-forward updates and require linear history.
- The ruleset MUST require pull requests with squash as the only merge method and zero approvals while the repository has only one independent maintainer.
- The ruleset MUST require the stable `CI required` and Dependency Review from the GitHub Actions integration, with strict current-main testing.
- Ruleset bypass actors MUST remain empty unless the user explicitly approves a break-glass path and the reason is recorded in the rule.
- A `release tag policy` ruleset MUST block deletion and non-fast-forward updates for `v*` tags.
- The `release` environment MUST allow only the `main` branch. Add an independent required reviewer when the maintainer set can satisfy that gate without self-approval.

CODEOWNERS is advisory while `required_approving_review_count` is `0` and `require_code_owner_reviews` is `false`. Do not describe code-owner review as enforced unless those settings change.

## Repository surface policy

This rule owns `.gitignore` content policy. Repo surfaces stay tracked or stay out; the publish surface is Rule 13's `package.json#files` allowlist, never `.gitignore`.

- `.gitignore` covers only build artifacts, env/secret files, OS noise, agent session/personal state (`.claude/plans`, `.claude/agents/`, `.codex/agents/`, `.claude/scheduled_tasks.lock`, `.claude/settings.local.json`), editor state (`.vscode/`), and the held business-sensitive set: `advisor-plans/`, `.planning/`. Publishing a held path is an irreversible public-repo exposure and requires an explicit user decision in the same change.
- `scripts/guards/repo-surface/private-paths.json` is the machine-readable owner of the private-path set, in two buckets: `heldPrivate` (never public, never agent-MCP-readable: `advisor-plans/`, `.planning/`) and `agentPrivate` (public-repo-private user state: `.claude/plans/`, `.claude/agents/`, `.codex/agents/`, `.vscode/`). The repo-surface guard and the agent-MCP `repo_context_query` read path both consume this file; do not maintain a third private-path list anywhere else.
- `.gitignore` MUST NOT hide source surfaces that tracked files reference. Wired maintainer tooling stays tracked: `services/agent-mcp/`, `services/license-worker/`, `scripts/stripe/`, `cloudflare/`, `wrangler.toml`, `pyproject.toml`, `uv.lock`, `fastmcp.json`, `.mcp.json`, `.codex/config.toml`, and `.github/workflows/python.yml`.
- `scripts/guards/repo-surface/check-public-repo-surface.mjs` enforces both invariants: held-private paths are never tracked or stageable, and wired tooling present on disk is always tracked. Changing either set means updating `private-paths.json`, `.gitignore`, the guard, its tests, and this rule in the same change.
- The `.agents/.claude/.codex` ignore-with-unignore pattern is the deliberate privacy filter for the local skills library (the 2026-06 public-surface reduction); do not collapse it without an explicit user decision.

## Pull-request workflow

Use this path for every commit intended for `main`.

Enter the topic checkout before the first commit, so local `main` never carries unpublished work. Use the transactional branch paths defined above. Commit, push, and open the PR only from that topic checkout. A topic branch lives for exactly one PR cycle: while its PR is open, follow-up commits and review fixes stay on it; after squash merge it is archived, never reused for a follow-up PR. Do not open a PR from a long-lived, release-scoped, conflict-producing, or overbroad branch with commits outside the requested task.

Merge PRs with GitHub's squash merge path:

```bash
gh pr merge <number> --squash --delete-branch
```

Do not use `--merge`, `--rebase`, `--admin`, `--disable-auto`, local squash merges, force-push workarounds, or repo-local merge wrappers unless the user explicitly approves the exception and the reason is recorded in the PR.

### Multi-session branches

When more than one agent session works the same topic branch, keep one standing coordination note for the branch under `.claude/plans/` that records the current tip and check state, the files each session has in flight, review-thread resolutions the other session must not revert, and which session owns staging and commits. Announce in the note before editing a file another session has in flight, and re-read it before reverting or rewriting any hunk the current session did not author. `.claude/plans/` is agent-private, so the note never reaches the public repo; delete it during post-merge closeout.

## Post-merge closeout

After a PR merge, complete local and remote cleanup before starting another task:

1. Run `git fetch --prune origin` so deleted GitHub heads cannot survive as stale `origin/<branch>` refs.
2. Verify with `gh pr view <number> --json state,mergeCommit,headRefName,headRefOid,baseRefName` that the PR is merged and record the exact head and merge commit.
3. Verify the merge commit is contained by `origin/main`, the remote head is absent, the local head is absent, and the active checkout is no longer the merged topic branch.
4. Verify local `main` equals `origin/main` when the merge operated from the primary checkout.

Squash merging creates a new commit and leaves the original topic commits outside `main` ancestry. An ahead count on a surviving squash-merged topic branch does not mean its content is unmerged; it means cleanup is incomplete. Archive the merged topic branch — delete it locally and remotely — instead of resetting, force-pushing, or continuing work on it.

STOP before further edits when the merge succeeds but local cleanup fails. Preserve any dirty work, prove the PR and tree state, and obtain explicit approval for destructive recovery rather than silently carrying new work on the merged branch.

## PR review and check resolution

Address every PR review comment and failing check before merge, and mark each resolved only when its correction lands — never before, and never for a valid finding left unaddressed.

1. Verify the finding against upstream canonical sources before acting (Rule 05): official docs, the repo's own rules, or the installed dependency. An unverified review claim is a blocker, not a directive. When a suggestion conflicts with repo policy or upstream guidance, resolve it with the upstream-correct action and note the conflict rather than following the literal suggestion.
2. Fix the finding in the canonical owner, or record an owner-scoped not-applicable reason with evidence, and commit that correction.
3. Only then resolve the review thread (`gh api graphql` `resolveReviewThread`) or re-run the failing check to success. Resolving a thread or dismissing a check before its correction is committed, or resolving a valid unaddressed finding, is prohibited.

`required_conversation_resolution` is enforced on `main` PRs, so unresolved threads block merge; do not resolve threads prematurely to unblock a merge.

## Enforced by

- SessionStart merged-topic detection: `scripts/agent-hooks/merged-branch-state.mjs` (via the shared hook runner) injects post-merge closeout context when the current checkout's unique commits are already tree-contained in `origin/main`, so a squash-merged topic surviving as the active checkout is self-announcing in both Claude and Codex sessions.
- `.claude/hooks/guards/bash-policy-checks.mjs` blocks `git commit`/`git merge` piped through `tail`/`head` and `git push` piped through output consumers, including when an fd redirection such as `2>&1` sits between the command and the pipe, so hook output and exit status cannot be silently masked.
- `npm run guard:github-process` (`scripts/guards/ci-release/check-github-process.mjs`) asserts the policy file, package commands, canonical Rule 21 path, retired duplicate rule paths, Bash hook, and PR template stay synchronized.
- `npm run guard` runs `guard:github-process` through `scripts/guards/check-all.mjs`.
- `npm run github:audit-settings` (`scripts/github/audit-settings.mjs`) compares live GitHub repository settings, Actions permissions, `main` branch protection, repository rulesets, and topics to `.github/repo-policy.json`.
- Rule 12 command evidence records GitHub check commands as `github-checks`; final claims must reflect the recorded result.
- `.github/PULL_REQUEST_TEMPLATE.md` records the short operator checklist for PR authors and reviewers.

## Verification

After GitHub process, PR template, policy, package script, guard, hook, or related rule changes, run:

```bash
npm run guard:github-process
npm run sync:llm
npm run sync:llm:check
```

For GitHub check evidence behavior, also run:

```bash
npm test -- tests/agent-hooks/agent-hook-core.test.ts
```

Before merging a PR, run:

```bash
npm run github:audit-settings
```

After merging a PR, run the post-merge closeout above and record the fetched ref and PR-state evidence.

## Failure behavior

Fix the worktree, branch, policy, GitHub setting, or failing check that failed. If `statusCheckRollup` evidence reports failed checks, fix the checks and record later successful evidence before claiming green. Do not bypass branch protection, push directly to `main`, use admin merge, force push, retarget the PR to avoid conflicts, loosen `.github/repo-policy.json`, discard unrelated work, or continue on a merged topic branch to make a command pass.

## Done means

One rule owns the entire source-control lifecycle; task-owned staging is verified; local and remote branch state agree; merged topic branches are absent; local `main` is current after primary-checkout merges; and repo policy, live GitHub settings, merge method, guard, PR template, and GitHub check evidence agree.
