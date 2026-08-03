# Coding Agent Instructions

## Contract

This is the canonical root instruction brief for the repository.

Read only the rules and skills directly applicable to the current task.

## Rule Routing

| When the task concerns | Canonical owner |
| --- | --- |
| General operating discipline, gates, `$elegant`, enforcement closure, or closeout | `.claude/rules/01-operating-rules.md` |
| Public Blume docs pages under `docs/`, their writing standard, or their components | `.claude/rules/02-blume-writing-standards.md`, `.claude/rules/03-blume-component-reference.md` |
| Technical decisions, upstream research, evidence fallbacks, or escalation | `.claude/rules/05-decision-protocol.md` |
| Repository discovery, LSP coverage, formatter and linter ownership, or npm-only tooling | `.claude/rules/06-multi-language-toolchain.md` |
| PostgreSQL or Supabase migrations, source-intent extraction, or generated schema surfaces | `.claude/rules/supaschema.md` |
| Agent MCP or FastMCP behavior and public surfaces | `.claude/rules/11-agent-mcp-fastmcp.md` |
| Skill loading, hook context, observable loading, enforcement, or hook state | `.claude/rules/12-skill-loading-enforcement.md` |
| Package exports, npm package boundaries, or public consumers | `.claude/rules/13-npm-package-boundary.md` |
| Editing safety, deletions, or required removal sweeps | `.claude/rules/14-editing-safety.md` |
| Agent instructions, prompts, tool routing, or response standards | `.claude/rules/17-prompt-craft-standards.md` |
| Context-surface ownership or synchronization | `.claude/rules/18-context-surface-sync.md` |
| Git, branches, worktrees, commits, pushes, GitHub, pull requests, merges, or cleanup | `.claude/rules/21-source-control.md` |
| Generated agent rules, skills, or configuration projections | `.claude/rules/22-agent-surface-sync-ownership.md` |
| Repository documentation creation or editing | `.claude/rules/24-repo-documentation.md` |

When multiple rows apply, read each applicable owner. Do not load unrelated rules merely because they are listed here.

## Repository Ownership

Canonical repository policy lives in `.claude/rules/**`.

Reusable workflows and supporting task instructions live in their applicable skill owners.

Do not copy detailed rule or skill procedures into this file.

Generated Claude, Gemini, OpenCode, or other managed agent surfaces must be changed through their canonical source owner. Do not edit a generated projection when an owned source exists.

Do not introduce duplicate owners for:

- repository policy;
- public contracts;
- generated surfaces;
- schemas or generated types;
- package exports;
- prompts or agent instructions;
- validation or enforcement workflows.

When ownership is unclear, determine the existing owner before adding a new file, abstraction, contract, or configuration surface.

## Engineering Principles

Assume the user is a principal engineer.

Write code that is **accessible, performant, type-safe, and maintainable**. Focus on clarity and explicit intent over brevity.

Implement the requested behavior using the simplest maintainable approach that fits the existing repository.

- Follow established architecture, naming, contracts, and frameworks as defined by rules.
- Absorb enough surrounding code to understand the affected behavior and ownership boundary, then stop exploring.
- Keep changes within the smallest practical behavioral and ownership surface.
- Prefer clear names, strong types, simple control flow, minimal mutation, and focused functions.
- Prefer direct implementations over speculative frameworks or generalized infrastructure.
- Use structured APIs, parsers, AST tooling, or language-server tooling instead of ad hoc text manipulation when practical.
- Add an abstraction only when it removes meaningful complexity or duplication or clearly matches an established repository pattern.
- Preserve existing public contracts unless the requested work explicitly replaces them.
- Avoid unrelated refactoring, formatting churn, file movement, metadata changes, and opportunistic cleanup.

Avoid:

- single-use abstractions;
- pass-through wrappers;
- helpers that merely rename another operation;
- speculative utilities;
- convenience entry points without a distinct owner or requirement;
- duplicate maps, constants, types, or generated contracts;
- compatibility layers that are not explicitly required;
- broad validation or enforcement layers for a narrow local change.

Patch the narrow failing path first. Expand only when the requested behavior or an applicable repository contract requires it.

### Type Safety & Explicitness

- Use explicit types for function parameters and return values when they enhance clarity
- Prefer `unknown` over `any` when the type is genuinely unknown
- Use const assertions (`as const`) for immutable values and literal types
- Leverage TypeScript's type narrowing instead of type assertions
- Use meaningful variable names instead of magic numbers - extract constants with descriptive names

### Modern JavaScript/TypeScript

- Use arrow functions for callbacks and short functions
- Prefer `for...of` loops over `.forEach()` and indexed `for` loops
- Use optional chaining (`?.`) and nullish coalescing (`??`) for safer property access
- Prefer template literals over string concatenation
- Use destructuring for object and array assignments
- Use `const` by default, `let` only when reassignment is needed, never `var`

### Async & Promises

- Always `await` promises in async functions - don't forget to use the return value
- Use `async/await` syntax instead of promise chains for better readability
- Handle errors appropriately in async code with try-catch blocks
- Don't use async functions as Promise executors

## When Biome Can't Help

Biome's linter will catch most issues automatically. Focus your attention on:

1. **Business logic correctness** - Biome can't validate your algorithms
2. **Meaningful naming** - Use descriptive names for functions, variables, and types
3. **Architecture decisions** - Component structure, data flow, and API design
4. **Edge cases** - Handle boundary conditions and error states
5. **User experience** - Accessibility, performance, and usability considerations
6. **Documentation** - Prefer self-documenting code

## Discovery

Begin with the smallest relevant file, symbol, route, package, test, diff, log, or command.

Use focused source searches when the location or symbol is already known.

Keep potentially large command output scoped. Narrow the command before increasing its output limit, and preserve the underlying exit status when validation depends on it.

Do not dump full repositories, generated trees, large logs, minified files, databases, or large structured-data files unless the task specifically requires them.

Read applicable instruction files, rules, skills, and tool documentation completely unless a file is unexpectedly large.

## Editing

Review the available tools and the owning context, and complete the research the change depends on, before writing anything. `.claude/rules/05-decision-protocol.md` owns that gate.

Follow `.claude/rules/14-editing-safety.md` for editing and deletion requirements.

Follow `.claude/rules/21-source-control.md` for all source-control operations.

Follow `.claude/rules/22-agent-surface-sync-ownership.md` before changing generated agent instructions, skills, rules, prompts, or configuration projections.

Follow `.claude/rules/supaschema.md` before changing migrations, declarative SQL sources, database contracts, or generated schema surfaces.

Do not manually reproduce an existing generator, synchronization workflow, or canonical source contract.

Use the repository’s established formatting, generation, and migration mechanisms when they are required by the affected owner.

## Validation

Match validation to the changed behavior, risk, and ownership boundary.

Prefer, in order:

1. Targeted tests for the changed behavior.
2. Applicable targeted type, lint, schema, migration, or static checks.
3. Affected-package or affected-project validation.
4. A minimal smoke test when automated checks are unavailable or insufficient.

Do not run every validation layer when a narrower check provides adequate evidence.

Run repository-wide builds, tests, linting, synchronization, generation, or enforcement only when:

- the user explicitly requests it;
- an applicable canonical rule requires it; or
- narrower validation cannot establish correctness.

Validate behavior and resulting contracts, not merely command exit status.

Review the in-scope diff and directly generated outputs before completion.

When validation cannot run, state what remains unverified and the evidence that was obtained instead.

## Code Review

When the user requests a review, use a code-review stance unless they specify another review type.

Prioritize:

1. Correctness defects
2. Behavioral regressions
3. Security or data-integrity risks
4. Public contract violations
5. Ownership or generated-surface violations
6. Missing or inadequate tests
7. Maintainability problems that materially affect the change

Present findings first, ordered by severity and supported by file and line references.

After the findings, include only necessary assumptions, open questions, validation gaps, or a brief change summary.

When no findings are identified, say so clearly and identify any residual risk or test gap.

Do not modify code during a review unless the user explicitly requests changes.

## Delegation

Use subagents only when delegation materially improves speed, context use, specialist verification, or output quality.

Keep each delegated task narrow and provide:

- the controlling objective;
- the exact scope;
- applicable owner instructions;
- relevant canonical rules and skills;
- known constraints;
- required evidence;
- required validation.

For research, review, and exploration, ask subagents to investigate or verify rather than prescribing a preferred conclusion.

Require delegated results to identify:

- findings;
- supporting evidence;
- files inspected;
- files changed, if any;
- validation performed, if any;
- uncertainty or remaining risk.

The primary agent owns final judgment, integration, and verification.
