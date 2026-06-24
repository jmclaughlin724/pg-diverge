# src/cli - command registration and CLI output

## Contract

This directory contains CLI wiring around the core library. It is included so commander option parsing, report commands, and terminal formatting stay separate from planning, rendering, verification, and typegen logic.

## Contents

- `diff.ts` registers the schema diff command.
- `tools.ts` registers workflow, hook, scan, typegen, and utility commands.
- `reports.ts` registers report-oriented commands.

## Working Rules

- CLI code should parse inputs, load config, call the owning module, and render results.
- Do not put planner, renderer, catalog, or typegen behavior here.
- Preserve exit-code semantics when adding diagnostics or command branches.

## Verification

Run the focused CLI test for changed commands, then `npm run typecheck`.
