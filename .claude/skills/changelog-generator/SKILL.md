---
name: changelog-generator
description: "Generate release changelog entries from git history, release diffs, PR summaries, or supplied notes. Use for CHANGELOG.md entries, GitHub release notes, npm release notes, and customer-facing update summaries."
argument-hint: "<range | version | notes source>"
metadata:
  keywords:
    - "changelog"
    - "CHANGELOG.md"
    - "release notes"
    - "GitHub release"
    - "npm release"
    - "customer-facing updates"
    - "summarize commits"
    - "version notes"
  file-triggers:
    - "CHANGELOG.md"
---

# Changelog Generator

## Contract

This skill is a direct execution contract. Use it only when the user asks for changelog, release-note, or customer-update text from commits, tags, diffs, PRs, or supplied notes.

Produce accurate, source-grounded release notes. Do not invent user impact, dates, version numbers, issue numbers, or breaking-change claims. Keep repo/package release policy in `.claude/rules/19-version-control-release.md` and public docs in `docs/**` as higher-priority owners when they apply.

## Use When

- Write or update `CHANGELOG.md` entries.
- Draft GitHub or npm release notes from a tag range, commit range, branch diff, PR list, or explicit notes.
- Convert technical commit messages into user-facing summaries.
- Summarize unreleased changes for internal release prep without editing files unless asked.

## Direct Workflow

1. Identify the requested output: target audience, version/date/range, destination file, and whether to edit or draft only. If the range is missing, infer conservatively from tags and `CHANGELOG.md`, then state the range used.
2. Gather evidence from the narrowest source available:
   - supplied notes first;
   - otherwise `git tag --sort=-creatordate`, `git log --oneline --decorate <range>`, `git diff --stat <range>`, and changed-file reads as needed;
   - for repo releases, read `CHANGELOG.md`, `package.json`, and `.claude/rules/19-version-control-release.md`.
3. Classify only evidence-backed changes into `Added`, `Changed`, `Fixed`, `Security`, `Deprecated`, `Removed`, and `Breaking` when applicable. Omit empty sections unless preserving an existing format.
4. Rewrite technical details into plain user impact. Keep exact CLI flags, diagnostic codes, config keys, file paths, package names, and commands in backticks when they are user-visible.
5. Filter maintenance-only commits unless they affect users, packaging, docs, install, compatibility, security, CI workflows users rely on, or agent behavior.
6. Before editing a changelog file, match the existing structure and insertion point. Preserve prior entries and links. Do not stage, tag, version bump, or publish.
7. Close with the evidence range, changed files if edited, and any uncertainty that requires maintainer review.

## Output Shape

- For `CHANGELOG.md`, preserve the file's existing style.
- For GitHub or npm release notes, use a short title plus grouped bullets.
- Lead with user-visible changes, then operational or developer notes.
- Include a `Breaking` section only when source evidence proves a breaking change.

## Boundaries

- Do not fabricate impact from commit subjects alone when the diff does not prove it.
- Do not expose secrets, internal-only implementation notes, or raw noisy commit lists in public-facing text.
- Do not run release, publish, tag, package, or git-staging commands unless explicitly asked.
- Do not edit generated files except through their canonical generator workflow.
