# src/render - migration SQL rendering

## Contract

This directory renders planned operations into replay-safe SQL. It is included so guard SQL, operation comments, idempotency wrappers, and statement formatting are centralized after planning has made policy decisions.

## Contents

- `migration.ts` renders complete migration output and split output.
- `guards.ts` renders reusable SQL guards, reverse grants, renames, and qualified references.

## Working Rules

- Render from operation metadata; do not infer new planner policy here.
- Keep output idempotent where the operation contract requires it.
- Include operation comments for destructive or guarded behavior that humans must review.

## Verification

Run focused render/generated-output tests for changed SQL output, then `npm run typecheck`.
