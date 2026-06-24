# src/hooks - supaschema CLI hook runtime

## Contract

This directory implements the product hook commands used by editor and agent workflows. It is included so schema-write automation, generated-migration blocking, and hook output stay in the CLI package rather than maintainer-only agent hook infrastructure.

## Contents

- `config.ts` resolves schema path state and automatic sync plans.
- `targets.ts` identifies changed hook targets.
- `checks.ts` runs configured check and verify gates.
- `payload.ts` parses hook payloads.
- `commands.ts` resolves and runs the supaschema binary.
- `output.ts` renders agent/editor hook responses.

## Working Rules

- Keep this package-safe hook runtime separate from `scripts/agent-hooks/**`.
- Hook output must be deterministic, concise, and actionable for the calling editor or agent.
- Do not weaken generated-migration protection without updating policy, tests, and consumer docs.

## Verification

Run focused hook tests and `npm run typecheck`; for package-facing hook changes also run `npm run check:package`.
