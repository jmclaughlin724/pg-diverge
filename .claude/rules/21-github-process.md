---
description: GitHub repository settings, direct-main push, pull-request preflight, merge method, branch cleanup, and post-merge verification.
codexExecPolicy: |
  [
    {
      "pattern": ["gh", "pr", "merge", "--squash"],
      "decision": "forbidden",
      "justification": "Rule 21 requires rebase merges with branch cleanup; use gh pr merge <number> --rebase --delete-branch after merge preflight.",
      "match": ["gh pr merge --squash 53"],
      "not_match": ["gh pr merge 53 --rebase --delete-branch"]
    },
    {
      "pattern": ["gh", "pr", "merge", "--merge"],
      "decision": "forbidden",
      "justification": "Rule 21 forbids merge commits; use gh pr merge <number> --rebase --delete-branch after merge preflight.",
      "match": ["gh pr merge --merge 53"],
      "not_match": ["gh pr merge 53 --rebase --delete-branch"]
    },
    {
      "pattern": ["gh", "pr", "merge", "--admin"],
      "decision": "forbidden",
      "justification": "Rule 21 forbids admin merge bypasses unless the user explicitly approves and records the exception.",
      "match": ["gh pr merge --admin 53"],
      "not_match": ["gh pr merge 53 --rebase --delete-branch"]
    },
    {
      "pattern": ["gh", "pr", "merge", "--disable-auto"],
      "decision": "forbidden",
      "justification": "Rule 21 forbids disabling auto-merge as a merge workaround.",
      "match": ["gh pr merge --disable-auto 53"],
      "not_match": ["gh pr merge 53 --rebase --delete-branch"]
    },
    {
      "pattern": ["gh", "pr", "merge"],
      "decision": "prompt",
      "justification": "Rule 21 requires Bash hook verification for PR merge commands because Codex prefix_rule cannot match selector-before-flag forms without overblocking the policy merge command.",
      "match": ["gh pr merge 53 --squash", "gh pr merge 53 --rebase --delete-branch"],
      "not_match": ["gh pr view 53"]
    },
    {
      "pattern": ["git", "push", "origin", "HEAD:main"],
      "decision": "allow",
      "justification": "Rule 21 allows direct fast-forward pushes to main after npm run guard and origin/main preflight.",
      "match": ["git push origin HEAD:main"],
      "not_match": ["git push --force origin main"]
    }
  ]
paths:
  - ".github/**"
  - "scripts/github/**"
  - "scripts/guards/ci-release/check-github-process.mjs"
  - "scripts/guards/check-all.mjs"
  - "package.json"
  - "AGENTS.md"
---

# Rule 21 — GitHub process

## Contract

This rule owns the GitHub lifecycle after local work exists: repository settings, `main` branch protection, direct fast-forward pushes, optional PR preflight, merge preflight, canonical merge method, branch cleanup, and post-merge verification.

Rule 09 owns GitHub Actions workflow posture. Rule 14 owns local edit/worktree/git safety and the main-agent-only staging, commit, and push boundary. Rule 19 owns release-version transactions. This rule owns remote GitHub process state, the repo-local GitHub scripts, and the commands that prove direct pushes and optional PRs can complete without hidden conflicts, stale branch policy, or local-main drift.

Sources:

- GitHub protected branches: <https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches>
- GitHub merge methods: <https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/about-merge-methods-on-github>
- GitHub rulesets: <https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets>
- GitHub ruleset rules: <https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets>
- GitHub branch protection REST API: <https://docs.github.com/en/rest/branches/branch-protection>
- GitHub Actions permissions REST API: <https://docs.github.com/en/rest/actions/permissions>
- GitHub repository topics REST API: <https://docs.github.com/en/rest/repos/repos#get-all-repository-topics>
- GitHub replace repository topics REST API: <https://docs.github.com/en/rest/repos/repos#replace-all-repository-topics>
- GitHub CLI `gh pr merge`: <https://cli.github.com/manual/gh_pr_merge>
- GitHub CLI `gh repo edit`: <https://cli.github.com/manual/gh_repo_edit>

## Canonical policy

`.github/repo-policy.json` is the machine-readable owner for the intended GitHub repository and branch-protection state.

Required repository settings:

- `default_branch` MUST be `main`.
- Repository topics MUST match `repositoryTopics` in `.github/repo-policy.json`.
- `allow_rebase_merge` MUST be `true`.
- `allow_merge_commit` MUST be `false`.
- `allow_squash_merge` MUST be `false`.
- `allow_auto_merge` SHOULD be `true`.
- `delete_branch_on_merge` MUST be `true`.
- `web_commit_signoff_required` MUST be `false`.
- Commit signoff MUST NOT be enforced by GitHub settings, CI, package scripts, PR template checklists, or repo guards unless the user explicitly approves a new contributor-certificate policy in the same change.

Required GitHub Actions repository settings:

- GitHub Actions MUST be enabled.
- Repository Actions policy MUST require full-length SHA pinning.
- Repository Actions policy MAY allow all actions because Rule 09 and `npm run guard:ci` enforce immutable action pins in workflow files.
- Default `GITHUB_TOKEN` permissions MUST be read-only.
- GitHub Actions MUST NOT be allowed to create or approve pull-request reviews.
- First-time outside contributor workflow approval MUST remain enabled for public-fork PRs.

Required `main` branch protection:

- `required_linear_history` MUST be `true`.
- `direct_pushes` MUST be `true`; direct fast-forward pushes to `main` are allowed by policy.
- `required_status_checks` MUST NOT be configured on `main`.
- `required_pull_request_reviews` MUST NOT be configured on `main`.
- `required_conversation_resolution` MUST be `true` for PRs when PRs are used.
- `enforce_admins` MUST be `true`.
- `allow_force_pushes` MUST be `false`.
- `allow_deletions` MUST be `false`.
- `required_signatures` MUST be `false` while GitHub rebase merge is the only enabled merge method, because GitHub-created rebase commits cannot be signed by the original author.
- Review and status-check settings MUST match `.github/repo-policy.json`; if required reviews or status checks are reintroduced, update the policy, CODEOWNERS expectations, PR template, merge scripts, and this rule in the same change.

Required repository ruleset:

- A repository branch ruleset named `main branch policy` MUST be active and target the default branch.
- The ruleset MUST block deletion and non-fast-forward updates and require linear history.
- The ruleset MUST NOT require pull requests or required status checks while `.github/repo-policy.json` has `branches.main.direct_pushes: true`.
- Ruleset bypass actors MUST remain empty unless the user explicitly approves a break-glass path and the reason is recorded in the rule.

CODEOWNERS is advisory while `required_approving_review_count` is `0` and `require_code_owner_reviews` is `false`. Do not describe code-owner review as enforced unless those settings change.

## Direct-main workflow

Use this path when the user asks to push, deploy, merge to `main`, or release without explicitly asking for a PR.

Before pushing to `main`, run:

```bash
npm run guard
git fetch origin main
```

The branch MUST be current with `origin/main`, the update MUST be a fast-forward, and the commit MUST contain only task-owned tracked changes. Preserve unrelated local and ignored maintainer surfaces.

Commit with signoff:

```bash
git commit --signoff
```

Push directly:

```bash
git push origin HEAD:main
```

After pushing, verify:

```bash
git fetch origin main
git merge-base --is-ancestor HEAD origin/main
npm run github:audit-settings
```

If GitHub rejects the push because a PR, review, or required status check is required, treat live GitHub settings as policy drift. Fix by reconciling live settings to `.github/repo-policy.json` with `npm run github:audit-settings` evidence. Do not add PR or required-check gates back to satisfy the rejection unless the user explicitly requests a policy change.

## Pull-request workflow

Use this path only when the user asks for a PR or when an external contribution requires review flow.

Before opening or replacing a PR, run:

```bash
npm run github:pr-preflight -- --base main
```

The PR branch MUST be a task branch, MUST be ahead of `origin/main`, MUST not be behind `origin/main`, MUST merge cleanly into `origin/main`, and MUST not contain uncommitted task-owned files. Use `--allow-dirty` only when dirty files are unrelated, preserved, and explicitly documented in the PR body.

Before merging a PR, run:

```bash
npm run github:merge-preflight -- --pr <number>
```

The PR MUST target `main`, MUST be open, MUST not be draft, MUST have `mergeStateStatus: CLEAN`, MUST not have requested changes, and MUST have no unresolved review threads when conversation resolution is required. Required status checks are not policy-owned while `.github/repo-policy.json` omits `branches.main.required_status_checks`.

Merge only with the policy merge method:

```bash
gh pr merge <number> --rebase --delete-branch
```

Do not use `--merge`, `--squash`, `--admin`, `--disable-auto`, or a force-push workaround unless the user explicitly approves the exception and records the reason in the PR. The Bash safety hook (`.claude/hooks/guards/bash-policy-checks.mjs`) blocks those flags in either position (`gh pr merge --squash 53` and `gh pr merge 53 --squash`); because Codex `prefix_rule(...)` is exact-prefix only, the rule entries forbid flag-first forms and prompt on every `gh pr merge` so selector-before-flag forms still reach the Bash hook.

After merge, run:

```bash
npm run github:post-merge-verify -- --pr <number>
```

The merged PR MUST report `MERGED` from GitHub, the merge commit MUST be contained in `origin/main`, and the local `origin/main` ref MUST be fetched before verification.

## Enforced by

- `npm run guard:github-process` (`scripts/guards/ci-release/check-github-process.mjs`) asserts the policy file, Rule 21, package commands, guard wiring, and PR template stay synchronized.
- `npm run guard` runs `guard:github-process` through `scripts/guards/check-all.mjs`.
- `npm run github:audit-settings` (`scripts/github/audit-settings.mjs`) compares live GitHub repository settings, Actions permissions, `main` branch protection, and repository rulesets to `.github/repo-policy.json`.
- `npm run github:audit-settings` also compares live repository topics to `repositoryTopics`. `npm run github:audit-settings -- --apply-topics` reconciles only topics, refuses to run unless `GITHUB_REPOSITORY_TOPICS_APPROVED=1` is already present, and does not apply topics while non-topic repository policy failures exist.
- `npm run github:pr-preflight`, `npm run github:merge-preflight`, and `npm run github:post-merge-verify` prove the optional PR lifecycle state before PR creation, merge, and closeout.
- Rule 12 response-shape enforcement records GitHub check commands as `github-checks` evidence and blocks green claims while failed check evidence remains unresolved.
- `.github/PULL_REQUEST_TEMPLATE.md` records the required operator checklist for PR authors and reviewers.

## Verification

After GitHub process, PR template, policy, package script, guard, or related rule changes, run:

```bash
npm run guard:github-process
npm run sync:llm
npm run sync:llm:check
```

For GitHub check evidence behavior, also run:

```bash
npm test -- tests/agent-hook-core.test.ts
```

Before direct-main push, also run:

```bash
npm run guard
git fetch origin main
```

Before creating or replacing a PR, also run:

```bash
npm run github:pr-preflight -- --base main
```

Before merging a PR, also run:

```bash
npm run github:audit-settings
npm run github:merge-preflight -- --pr <number>
```

After merging a PR, also run:

```bash
npm run github:post-merge-verify -- --pr <number>
```

## Failure behavior

Fix the branch, PR, policy, GitHub setting, local-main drift, or failing check that failed. If direct push fails because GitHub requires PRs, reviews, or status checks, fix live policy drift against `.github/repo-policy.json`; do not reintroduce required PR or status-check gates unless the user explicitly asks to change the policy. If `statusCheckRollup` evidence reports failed checks, fix the checks and record later successful `github-checks` evidence before claiming green. Do not bypass branch protection, use admin merge to skip checks, force push, change the PR base to avoid conflicts, or loosen `.github/repo-policy.json` to make a command pass.

## Done means

The repo policy, live GitHub settings, direct-main workflow, optional PR template, local guard, preflight scripts, merge method, branch cleanup, GitHub check evidence gate, and post-merge verification all agree.
