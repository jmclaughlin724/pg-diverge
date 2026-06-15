# Concurrency Policy

Loaded by `task-creator` when deciding wave composition, worker ownership, and verification ordering. Parallelism is useful only when ownership is clear.

## Default Policy

- Run evidence-gathering exploration in parallel when it does not mutate shared state.
- Serialize write-heavy work that touches the same files or neighboring code.
- Allow verification to run in parallel only when it exercises a different area or a stable artifact.
- Prefer disjoint write ownership over optimistic coordination.

## Concurrency Classes

### Evidence-Gathering

Safe to parallelize freely:

- file discovery
- grep or glob searches
- code reading
- architecture mapping
- test inventory

### Write-heavy

Keep one worker at a time per overlapping file set:

- refactors in the same module
- edits in the same file or adjacent region
- migrations that change shared interfaces
- formatting or codemods over the same tree

### Verification

Can overlap with implementation when:

- it targets a different file area
- it validates a stable artifact
- it does not depend on an uncommitted in-flight edit

Do not run verification against code that is still moving under it.

## Ownership Rule

Every implementation task should name its write scope up front.

Good:

- Worker A owns `src/auth/*`
- Worker B owns `src/ui/login/*`
- Verifier owns test execution only

Bad:

- "Both of you fix auth edge cases"
- "Take whatever files seem relevant"

The single-file write scope with a narrow sibling-file extraction escape clause is documented in the `worker-prompt-craft` skill. Use it whenever an agent's mandated edits could push the target file past the 500-line hard cap in `.claude/rules/14-file-size-and-composition.md`.

## Isolation Rule

When concurrent workers need local context, use per-worker state rather than globals.

Operationally, that means:

- do not rely on mutable global assumptions
- keep prompts self-contained
- keep write scopes disjoint
- assume concurrent tasks may finish in any order

## Scheduling Heuristic

1. Fan out broad research first.
2. Collapse findings into a single plan.
3. Split implementation by disjoint ownership.
4. Serialize any shared-file edits.
5. Run verification with fresh context.

This heuristic is the source for the `task-creator` wave ordering (Wave 0 research → Wave 1 foundation → Wave 2+ disjoint implementation → final verification wave).

## Anti-Patterns

- Parallel edits to the same file
- Verification on code that has not stabilized
- Shared mutable scratch state with unclear ownership
- Launching workers in sequence when the tasks are obviously independent

## Litmus Test

Before parallelizing, ask:

- Is this task evidence-gathering, or does it write files?
- If it writes, exactly which files does it own?
- Could another worker change the same area before this one finishes?
- Does the verifier need fresh eyes or in-flight context?

If you cannot answer those four questions, do not parallelize the task yet.
