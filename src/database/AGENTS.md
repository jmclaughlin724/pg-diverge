# src/database - database URLs and disposable databases

## Contract

This directory owns database URL resolution and temporary database lifecycle helpers. It is included so verification and replay checks can create isolated Postgres databases without spreading admin behavior through the codebase.

## Contents

- `url.ts` resolves explicit, environment, Supabase local, and lane-specific database URLs.
- `admin.ts` creates, drops, and uses temporary databases and applies SQL.

## Working Rules

- Keep destructive database administration behind explicit helper calls.
- Preserve local-only assertions for commands that must not target production accidentally.
- Apply SQL through statement-aware helpers where replay behavior matters.

## Verification

Run focused database-url or verify tests for changed behavior, then `npm run typecheck`.
