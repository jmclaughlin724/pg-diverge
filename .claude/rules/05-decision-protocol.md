---
enforcement:
  type: judgment-only
description: Evidence-driven technical decisions, upstream research routing, fallbacks, and user-owned escalation.
paths:
  - "src/**"
  - "tests/**"
  - "docs/**"
  - "scripts/**"
  - "bin/**"
  - "benchmarks/**"
  - "services/**"
  - ".claude/**"
  - ".codex/**"
  - ".agents/**"
  - ".github/**"
  - "AGENTS.md"
  - "CLAUDE.md"
  - "package.json"
  - "biome.jsonc"
  - "lefthook.yml"
  - "wrangler.toml"
  - "tsconfig*.json"
---

# Rule 05 - Decision protocol

## Contract

Resolve technical decisions from the best available evidence. Ask the user only for choices that are genuinely theirs.

## Research boundary

Use authoritative upstream sources when:

- the user requests current guidance, citations, comparison, research, or verification;
- a material claim is temporally unstable, externally defined, security-sensitive, or version-dependent;
- local source, tests, or installed-package evidence cannot establish the required behavior; or
- the decision changes a public, runtime, migration, package, or interoperability contract.

Do not research stable local facts already established by direct source or tests. Prefer the owning first-party docs or MCP source, then official specifications, release notes, or source repositories. For partial or empty results, try one or two meaningful alternatives and distinguish missing evidence from evidence of absence. Stop when the claims needed for the decision are supported.

## Research-before-acting gate

Review the available tools and the owning context, complete the research the decision needs, then act. Writing and asking are both the last step, never the first.

- Before the first write of a change, establish: the canonical owner and its current source, the applicable rules and skills, the tools actually available for the job (MCP servers, language server, parsers, repo scripts), and the upstream answer whenever Research boundary requires one. Writing before those are established is a rule violation, not a shortcut.
- Prefer the owning MCP or first-party documentation lane over recall. Not knowing a tool exists is not evidence that it does not.
- Presenting a technical choice to the user before the owner-source lane and, when Research boundary requires it, the upstream lane have run is a rule violation. Run them, then decide.
- Only these are user-owned: product scope and priorities, destructive or outward-facing actions, secrets, spending, material permission expansion, and conflicting user instructions. Everything else is the agent's judgment.
- When a decision is genuinely user-owned, deliver the researched recommendation with its evidence and the rejected alternatives with the reason each was rejected. Never offer an unresearched menu of options.
- Verify a mechanism is reachable before designing for it. A failure mode that cannot be reproduced does not justify code; record the disproof and drop the item.
- A repeated question after the user has already answered, or a menu offered to avoid judgment, is a defect in this rule's application, not a clarification.
- Rediscovering mid-change that the chosen mechanism was wrong, superseded, unreachable, or already implemented means the gate was skipped. Treat it as a rule failure and restate the corrected evidence, not as new information.

## Decision rules

- Prefer a platform's first-class mechanism when it satisfies the repo's constraints. Do not treat upstream validity as proof of local correctness.
- Synthesize retrieved evidence before acting. Parallelize independent reads or searches; keep dependent retrieval and mutation steps sequential.
- Make implementation choices when evidence and repository constraints determine the answer. Do not poll the user with a technical menu to avoid judgment.
- State material sources and uncertainty in the final result when they affect the decision.

## Verification

No command proves this rule; it is a judgment contract. Before completion, confirm four things: material claims cite repo or upstream evidence, fallback searches ran before any absence claim, every question asked was user-owned and research-backed, and user-owned decisions were escalated rather than guessed.

## Failure behavior

If required evidence remains unavailable after bounded fallbacks, do not guess. Explain the unsupported claim, what was checked, and the smallest missing input or external dependency.

## Done means

The technical choice is supported by local and, when required, upstream evidence; every question asked was user-owned and carried a researched recommendation; unreachable failure modes were disproved rather than coded around; and research stops once the decision's core claims are established.
