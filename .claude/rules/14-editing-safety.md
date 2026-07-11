---
enforcement:
  type: judgment-only
description: Editing safety, generated-artifact discipline, concurrent-change preservation, and source deletion sweeps.
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

# Rule 14 - Editing safety

## Contract

This rule owns file-edit safety, generated-artifact discipline, concurrent-change preservation, and deletion/rename sweeps. Rule 21 is the single owner for worktrees, Git commands, staging, commits, pushes, branches, pull requests, merges, and branch cleanup. Rule 20 owns the consolidated anti-pattern index.

## Editing rules

- Read enough local context before editing.
- Keep changes owner-scoped and use the canonical owner that satisfies the requested end state.
- Prefer structured edits (`apply_patch`, editor tool, AST/LSP rename, or repo codemod) over shell write tricks for source changes.
- Do not use broad replacement on substrings of wider identifiers. Verify uniqueness or use AST/LSP rename.
- Do not hand-edit generated artifacts such as `dist/**`, generated config contract outputs, generated migrations, generated docs output, Code Atlas scratch output, or LLM mirrors.
- For generated surfaces, edit the canonical owner and run the generator or sync command.

## Concurrent changes

- Preserve edits and files not intentionally authored in the current task.
- If a file changed since it was read, re-read it, preserve unrelated hunks, and continue.
- Treat watcher, dev-server, hook, subagent, and parallel-agent output as user-owned unless the current task started that process.
- If another session owns overlapping generated output, preserve unrelated hunks and rerun the canonical sync or generator.

## Delete, rename, and export-shape sweeps

Before deleting, renaming, privatizing, or changing a public export/package surface:

1. Query Code Atlas for owners and consumers.
2. Use cclsp/LSP for references when the symbol is in code.
3. Use exact fixed-string search for docs, fixtures, generated-surface references, package manifests, examples, and prose.
4. Update or retire consumers in the same change.
5. Update tests, docs, package boundary expectations, and generated mirrors if the public surface changed.

## Verification

Review every touched file and run its owner checks. Before staging or any other source-control action, follow Rule 21.

## Failure behavior

Fix failures caused by the current change and rerun the failed owner check. Do not overwrite unrelated work to reach a simpler diff.

## Done means

- Only task-owned hunks were changed.
- Unrelated concurrent work was preserved.
- Generated mirrors were synced from their owners, not patched directly.
- Delete, rename, and export changes include consumer-sweep evidence.
