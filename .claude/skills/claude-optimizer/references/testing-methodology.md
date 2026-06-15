# Testing Methodology for Skills

Skills require testing just like code. Apply Test-Driven Development (TDD) principles: observe failures first, write minimal fixes, verify improvements.

## TDD for Skills

| TDD Concept         | Skill Application                            |
| ------------------- | -------------------------------------------- |
| Test case           | Pressure scenario with fresh Claude          |
| Production code     | SKILL.md content                             |
| Test fails (RED)    | Agent violates rules without skill           |
| Test passes (GREEN) | Agent complies with skill present            |
| Refactor            | Close loopholes while maintaining compliance |

## Evaluation-Driven Development

### Step 1: Establish Baseline (RED)

Run representative tasks WITHOUT the skill. Document:

- What choices did Claude make?
- What rationalizations did it use?
- Where did it fail or struggle?

**Example baseline test:**

```
Task: "Create a database migration for a new users table"
Without skill: Claude might edit migrations directly, skip idempotent patterns, forget RLS
```

### Step 2: Create Evaluations

Build 3+ test scenarios that:

- Match the skill's intended triggers
- Cover edge cases
- Test under pressure (time, complexity, sunk cost)

**Evaluation structure:**

```json
{
  "skill": "database-workflow",
  "query": "Add a status column to the loans table",
  "expected_behavior": [
    "Finds existing schema file",
    "Uses idempotent ALTER pattern",
    "Generates migration with descriptive name",
    "Runs drift check before committing"
  ]
}
```

### Step 3: Write Minimal Skill (GREEN)

Address ONLY the observed baseline failures. Avoid:

- Hypothetical edge cases
- Over-explanation
- Content for scenarios not tested

### Step 4: Verify Improvement

Run the same scenarios WITH the skill. Check:

- Does Claude now follow the workflow?
- Are the failure modes addressed?
- Any new rationalizations appearing?

### Step 5: Close Loopholes (REFACTOR)

If Claude finds workarounds:

1. Document the exact rationalization
2. Add explicit counter in SKILL.md
3. Re-test until bulletproof

## Testing Different Skill Types

### Discipline-Enforcing Skills

Skills that enforce rules (TDD, verification-before-completion).

**Test with:**

- Academic questions: Does Claude understand the rules?
- Pressure scenarios: Does it comply under stress?
- Combined pressures: Time + sunk cost + exhaustion

**Success:** Agent follows rule under maximum pressure.

### Technique Skills

Skills that teach methods (debugging, pattern implementation).

**Test with:**

- Application scenarios: Can Claude apply the technique?
- Variation scenarios: Does it handle edge cases?
- Missing information: Do instructions have gaps?

**Success:** Agent successfully applies technique to new scenarios.

### Reference Skills

Skills that provide documentation (API guides, schema references).

**Test with:**

- Retrieval scenarios: Can Claude find information?
- Application scenarios: Can it use what it found?
- Gap testing: Are common use cases covered?

**Success:** Agent finds and correctly applies reference information.

## Model-Specific Testing

Test with all models you plan to use:

| Model  | Test Focus                          |
| ------ | ----------------------------------- |
| Haiku  | Does skill provide enough guidance? |
| Sonnet | Is skill clear and efficient?       |
| Opus   | Does skill avoid over-explaining?   |

**Why:** What works for Opus may need more detail for Haiku.

## Common Rationalizations

When testing discipline skills, watch for these excuses:

| Rationalization | Reality |
| --- | --- |
| "Too simple to need this" | Simple tasks still fail. Test it. |
| "I'll do it after" | Tests passing after prove nothing. |
| "Spirit vs letter of the rule" | Violating the letter IS violating the spirit. |
| "This is different because..." | If it looks like the pattern, treat it as the pattern. |
| "Testing is overkill" | Untested skills have issues. Always. |

## Validation Checklist

Before deploying:

**Discovery:**

- [ ] Skill activates for relevant queries (test 3+)
- [ ] Skill does NOT activate for unrelated queries
- [ ] Description is specific enough for correct matching

**Content:**

- [ ] name ≤64 chars, hyphen-case
- [ ] description ≤1024 chars, third person
- [ ] SKILL.md <500 lines, <5000 words
- [ ] No TODO markers
- [ ] Quick Start provides immediate orientation

**Resources:**

- [ ] References properly linked and documented
- [ ] Scripts execute without errors
- [ ] References are one level deep

**Quality:**

- [ ] Tested with Haiku, Sonnet, and Opus
- [ ] Real usage scenarios verified
- [ ] Team feedback incorporated (if applicable)

## Iterative Improvement

After deployment:

1. **Use in real workflows** - Actual tasks, not test scenarios
2. **Observe behavior** - Where does Claude struggle or succeed?
3. **Refine with fresh Claude** - Explain observations, get suggestions
4. **Test changes** - Verify improvements with real scenarios
5. **Repeat** - Continue observe-refine-test cycle

**Why this works:** Skills improve based on observed behavior, not assumptions.
