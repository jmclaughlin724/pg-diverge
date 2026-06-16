# Research Delegation Patterns

Patterns for delegating broad, ambiguous, or multi-surface research to Explore agents without blocking simple direct confirmation reads.

## Core Principle

**Prefer delegated research for broad audits and unpredictable discovery work.** The orchestrating agent may still read known owning files directly to confirm specific claims or apply narrow edits.

## When to Apply

| Scenario | Apply? | Why |
| --- | --- | --- |
| Skill needs broad codebase context | YES | Dispatch Explore agents |
| Command needs to understand existing patterns | YES | Dispatch explore agents |
| Agent needs to find files before implementing | YES | Dispatch parallel agents |
| Simple file read for a known path | NO | Direct Read is acceptable |
| User provides explicit file paths | NO | No exploration needed |

## Mandatory Constraints

Add these constraints to skills that benefit from delegated research:

```markdown
## Research Delegation (MANDATORY)

**Delegation-first for broad research:** Use Explore agents for wide or ambiguous discovery work. Your role: identify research needs, dispatch agents when they materially help, validate results, and synthesize findings.

**Allowed orchestrator actions:**

- Read specific files when path is explicitly provided by user
- Read reference files within the skill's own directory
- Use `search_tool_bm25` to activate MCP tools, then query external documentation via the relevant MCP server
- Use built-in web tools only when no suitable MCP server is available

**Avoid when delegation is the better fit:**

- Large search sweeps across many folders
- Pattern hunting where the owner is unknown
- Multi-file discovery work that can run in parallel
```

## Parallel Agent Dispatch Pattern

### Minimum Agent Count

Dispatch multiple agents in a single message when the research has independent questions or surfaces.

```typescript
// ❌ WRONG - Sequential dispatch
const patterns = await spawn_agent({
  agent_type: "explorer",
  message: "Find patterns",
});
await wait_agent({ ids: [patterns.id] });
const types = await spawn_agent({
  agent_type: "explorer",
  message: "Find types",
});

// ✅ CORRECT - Dispatch all independent agents first
const patterns = await spawn_agent({
  agent_type: "explorer",
  message: "Find patterns",
});
const types = await spawn_agent({
  agent_type: "explorer",
  message: "Find types",
});
await wait_agent({ ids: [patterns.id, types.id] });
```

### Agent Selection for Research

| Research Need | Agent Type | Prompt Focus |
| --- | --- | --- |
| Find existing code patterns | `explorer` | File paths, code examples, reuse opportunities |
| Analyze type definitions | `explorer` | Interfaces, imports, type errors |
| Research external best practices | `explorer` | Documentation, API patterns, recommendations |
| Database schema investigation | `explorer` | Tables, RLS policies, migrations |
| Security audit | `default` | Vulnerabilities and auth patterns |

### Explore Agent Prompt Template

```markdown
Explore the codebase for: [RESEARCH_TOPIC]

**MANDATORY: Use ripgrep (Grep tool) before Read to avoid token limits.**

Search for:

1. [Specific pattern 1]
2. [Specific pattern 2]
3. [Specific pattern 3]

Report with citations:

- File paths with line numbers
- Relevant code snippets (< 20 lines each)
- Patterns suitable for reuse
- Potential conflicts or considerations
```

## Blocking Collection Pattern

**⛔ NO OUTPUT until ALL agents complete**

```typescript
// Dispatch all agents first, then wait when blocked on results.
await wait_agent({
  ids: [agent1.id, agent2.id, agent3.id],
  timeout_ms: 300000,
});
```

### Collection Rules

| Phase      | Output Allowed? | Why                   |
| ---------- | --------------- | --------------------- |
| Dispatch   | ❌ No           | Agents just started   |
| Collection | ❌ No           | Results incomplete    |
| Validation | ❌ No           | Cross-checking claims |
| Synthesis  | ✅ Yes          | Complete report only  |

## Validation Checklist

Before synthesizing agent findings:

| Check | Action | If Fails |
| --- | --- | --- |
| **Consensus** | Do agents agree on key findings? | Flag contradictions explicitly |
| **Evidence** | Each finding cites file:line? | Reject uncited claims |
| **Accuracy** | Spot-check 2-3 claims with Read | Reject if source doesn't match |
| **Completeness** | Did agents answer the query? | Re-dispatch with clarification |

### Spot-Check Pattern

```typescript
// Agent claims: "Pattern exists at src/app/actions.ts:45"
Read({ file_path: "src/app/actions.ts", offset: 40, limit: 20 });
// Verify the claimed pattern actually exists at that location

// If spot-check fails: Reject that agent's claim
// If multiple spot-checks fail: Re-dispatch agent with corrective prompt
```

## Red Flags Table

Add this table to skills that require research:

```markdown
## Research Delegation Red Flags

| Thought                                 | Reality                           |
| --------------------------------------- | --------------------------------- |
| "I'll search half the repo myself"      | Prefer Explore agents.            |
| "I already know the owning file"        | Read it directly and keep moving. |
| "This spans multiple surfaces"          | Parallelize with agents.          |
| "I only need to verify one exact claim" | A direct read is usually enough.  |
```

## Implementation in Skill Body

### Quick Start Section Addition

```markdown
## Research Workflow

**BEFORE any implementation:**

1. **Identify research needs** - What context is required?
2. **Dispatch Explore agents when discovery is broad** - Prefer a single parallel batch
3. **Wait for the needed results** - Do not synthesize partial findings
4. **Validate findings** - Spot-check 2-3 claims
5. **Synthesize** - Create consolidated understanding
6. **Proceed** - Then begin implementation
```

### Mandatory Workflow Section

```markdown
## Mandatory Research Delegation

**DURING skill execution:**

1. **Need broad codebase context?** → Dispatch Explore agents
2. **Need to understand patterns across multiple folders?** → Dispatch explore agents
3. **Need type information?** → Dispatch a type-focused agent when it helps
4. **Working from known owning files?** → Read them directly
5. **Results validated?** → Spot-check the important claims
```

## Enforcement

Research delegation is enforced through:

1. **Rules section** in command body — immutable constraints
2. **Red flags table** — counters for rationalization attempts

## Example: Full Research Delegation Flow

````markdown
**User request:** "Add a new form component following existing patterns"

**Step 1: Identify research needs**

- Existing form patterns in codebase
- Component naming conventions
- Validation schema patterns
- Server Action integration

**Step 2: Dispatch agents (SINGLE message)**

```typescript
const formPatterns = await spawn_agent({
  agent_type: "explorer",
  message: `Search for existing form implementations in apps/ and packages/ui/.
MANDATORY: Use ripgrep before Read.
Report: file paths, component patterns, props interfaces.`,
});

const validationPatterns = await spawn_agent({
  agent_type: "explorer",
  message: `Search for Zod schema patterns used with forms.
MANDATORY: Use ripgrep before Read.
Report: schema definitions, Server Action integration.`,
});

const typePatterns = await spawn_agent({
  agent_type: "explorer",
  message: `Find form-related type definitions and interfaces.
Report: FormProps patterns, validation types, action return types.`,
});
```
````

**Step 3: Collect ALL results**

```typescript
await wait_agent({
  ids: [formPatterns.id, validationPatterns.id, typePatterns.id],
  timeout_ms: 300000,
});
const validation = await TaskOutput({
  task_id: agent2,
  block: true,
  timeout: 300000,
});
const types = await TaskOutput({
  task_id: agent3,
  block: true,
  timeout: 300000,
});
```

**Step 4: Validate (spot-check)**

```typescript
// Agent 1 claimed: "ContactForm pattern at apps/web-admin/src/components/forms/ContactForm.tsx:15"
Read({
  file_path: "apps/web-admin/src/components/forms/ContactForm.tsx",
  offset: 10,
  limit: 30,
});
// Verify pattern exists as claimed
```

**Step 5: Synthesize findings** Present consolidated understanding from validated agent findings.

**Step 6: Proceed with implementation** Only NOW can implementation begin, using validated patterns.

```

## Related References

- [parallel-agent-patterns.md](parallel-agent-patterns.md) - Agent dispatch mechanics
- [workflow-patterns.md](workflow-patterns.md) - Orchestrator prohibition details
- [skill-detection-enforcement.md](skill-detection-enforcement.md) - Hook-based enforcement
```
