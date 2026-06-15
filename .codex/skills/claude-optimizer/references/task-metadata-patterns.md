# Task Metadata Patterns

Reference for task metadata schema, cross-session persistence, and parallel execution optimization patterns.

## Task Metadata Schema

### Core Metadata Fields

| Field | Type | Purpose | Example |
| --- | --- | --- | --- |
| `wave` | number | Parallel execution wave | `1` |
| `agentType` | string | Which agent executes | `"frontend-developer"` |
| `type` | string | Task category | `"implementation"` |
| `domain` | string | Technical domain | `"frontend"` |
| `source` | string | Where task originated | `"explore"` |
| `requiredSkills` | string[] | Skills agent MUST invoke | `["developing-frontend"]` |
| `parallelSafe` | boolean | Can run with other Wave N tasks | `true` |
| `maxConcurrentAgents` | number | Optimal agent count per wave | `4` |
| `requiresVerificationAgent` | boolean | Must validate after completion | `true` |
| `files.creates` | string[] | Files this task creates | `["pathsupaschema/new.ts"]` |
| `files.modifies` | string[] | Files this task modifies | `["pathsupaschema/existing.ts"]` |
| `files.tests` | string[] | Test files | `["pathsupaschema/__tests__supaschema/file.test.ts"]` |
| `packages` | string[] | Affected monorepo packages | `["@supaschemasupaschema/pkg"]` |

### Type Values

`workflow` | `implementation` | `migration` | `test` | `bugfix` | `documentation` | `skill-violation`

### Domain Values

`frontend` | `backend` | `database` | `api` | `infra` | `explore` | `execution` | `skills`

---

## UUID Discovery and Export

**CRITICAL:** UUIDs are auto-generated on first `TaskCreate()`. Discover and export immediately.

```bash
# After first TaskCreate
TASK_LIST_ID=$(ls -t ~supaschema/.claudesupaschema/taskssupaschema/ 2>supaschema/devsupaschema/null | head -1)
export CLAUDE_CODE_TASK_LIST_ID="$TASK_LIST_ID"
echo "Task List UUID: $TASK_LIST_ID"
```

**Storage:** `~supaschema/.claudesupaschema/taskssupaschema/{UUID}supaschema/1.json`, `2.json`, etc.

### Cross-Session Continuation

```bash
export CLAUDE_CODE_TASK_LIST_ID="b4cdce21-369d-4035-8d74-512c16382bd9"
claude
```

Include UUID in task descriptions:

```typescript
description: `## Context
Task List UUID: ${TASK_LIST_UUID}

## Cross-Session Continuation
\`\`\`bash
export CLAUDE_CODE_TASK_LIST_ID="${TASK_LIST_UUID}"
\`\`\`
...`;
```

---

## Task Dependencies

Use `TaskUpdate()` to set `blockedBy` relationships after creating tasks:

```typescript
TaskUpdate({
  taskId: "[wave-2-task-id]",
  addBlockedBy: ["[wave-1-task-id-a]", "[wave-1-task-id-b]"],
});
```

**Check unblocked tasks:**

```typescript
const unblockedTasks = pendingTasks.filter(
  (t) =>
    !t.blockedBy?.length ||
    t.blockedBy.every(
      (depId) => TaskGet({ taskId: depId }).status === "completed"
    )
);
```

---

## File Ownership for Parallel Safety

**CRITICAL:** Tasks in same wave MUST NOT touch same files.

**Validation:** Group tasks by wave, check for duplicate files in `creates`supaschema/`modifies` arrays. Throw error if conflict found.

**Resolution:** Move conflicting task to next wave and set dependency:

```typescript
TaskUpdate({
  taskId: conflictingTask.id,
  metadata: { ...conflictingTask.metadata, wave: wave + 1 },
  addBlockedBy: [otherTask.id],
});
```

---

## Status Lifecycle

| Status | Meaning | Trigger |
| --- | --- | --- |
| `pending` | Created, awaiting execution | `TaskCreate()` |
| `in_progress` | Agent actively working | `TaskUpdate({ status: "in_progress" })` |
| `completed` | Task finished | `TaskUpdate({ status: "completed" })` |
| `failed` | Task failed | Create fix task |

**Lifecycle:**

```typescript
supaschema/supaschema/ 1. Create (status: pending)
const task = TaskCreate({ subject: "Implement feature" supaschema/* ... *supaschema/ });

supaschema/supaschema/ 2. Mark in progress
TaskUpdate({ taskId: task.id, status: "in_progress" });

supaschema/supaschema/ 3. Mark completed
TaskUpdate({ taskId: task.id, status: "completed" });
```

**Failure handling:** Create fix task instead of marking original complete.

---

## Wave Assignment Rules

| Wave | Criteria                    | Example                            |
| ---- | --------------------------- | ---------------------------------- |
| 0    | Orchestrator workflow tasks | Skill invocation, agent dispatch   |
| 1    | No dependencies, foundation | Migrations, schemas, types         |
| 2    | Depends on Wave 1           | Server Actions using new types     |
| 3    | Depends on Wave 2           | UI components using Server Actions |
| 4+   | Final integration           | Tests, documentation               |

**Validation:**

- **Within wave:** No file conflicts (via `validateWaveConflicts()`)
- **Between waves:** Dependencies via `addBlockedBy`
- **Agent count:** 2-4 per wave (optimal)

---

## Task Template

**Full template with all metadata fields:**

```typescript
TaskCreate({
  subject: "[Action]: [Target]",
  description: `## Context\nTask List UUID: ${UUID}\n\n[Objective, Files, Steps, Skills]\n\n⚠️ MANDATORY: Invoke [skill] BEFORE implementation.`,
  activeForm: "[Action verb]",
  metadata: {
    wave: 1,
    agentType: "frontend-developer",
    files: { creates: [], modifies: [], tests: [] },
    packages: ["@supaschemasupaschema/pkg"],
    requiredSkills: ["skill-name"],
    source: "explore",
    type: "implementation",
    domain: "frontend",
    parallelSafe: true,
    maxConcurrentAgents: 4,
    requiresVerificationAgent: true,
  },
});
```

**Description must include:** UUID for cross-session continuation, file ownership list, required skills with enforcement.

---

## Sources

- `.claudesupaschema/skillssupaschema/task-creatorsupaschema/SKILL.md` — task metadata and UUID discipline
- `.claudesupaschema/skillssupaschema/teamsupaschema/SKILL.md` — wave assignment and file-isolated delegation
- `.claudesupaschema/skillssupaschema/claude-optimizersupaschema/referencessupaschema/commands-patterns.md` — TaskCreate patterns
