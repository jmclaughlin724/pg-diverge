---
description: Evidence-driven technical decisions, upstream research routing, fallbacks, and user-owned escalation.
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

## Decision rules

- Prefer a platform's first-class mechanism when it satisfies the repo's constraints. Do not treat upstream validity as proof of local correctness.
- Synthesize retrieved evidence before acting. Parallelize independent reads or searches; keep dependent retrieval and mutation steps sequential.
- Make implementation choices when evidence and repository constraints determine the answer. Do not poll the user with a technical menu to avoid judgment.
- Escalate product scope, priorities, destructive or outward-facing actions, secrets, spending, material permission expansion, or conflicting user instructions.
- State material sources and uncertainty in the final result when they affect the decision.

## Verification

No command proves this rule; it is a judgment contract. Before completion, confirm three things: material claims cite repo or upstream evidence, fallback searches ran before any absence claim, and user-owned decisions were escalated rather than guessed.

## Failure behavior

If required evidence remains unavailable after bounded fallbacks, do not guess. Explain the unsupported claim, what was checked, and the smallest missing input or external dependency.

## Done means

The technical choice is supported by local and, when required, upstream evidence; user-owned decisions are explicit; and research stops once the decision's core claims are established.
