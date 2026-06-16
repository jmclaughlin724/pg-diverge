---
name: ultracite
description: "Use when working with this repo's lint and format stack. In supaschema, npm scripts run Ultracite, Ultracite wraps Biome, and Vitest is the test runner."
metadata:
  keywords:
    - "ultracite"
    - "biome config"
    - "npm run lint"
    - "npm run format"
    - "npm run lint:fix"
    - "biome.jsonc"
    - "lint fix"
    - "format code"
    - "biome diagnostic"
    - "biome error"
  file-triggers:
    - "biome.jsonc"
    - "vitest.config.ts"
    - "scripts/dependency-catalog.json"
---

# Ultracite / Lint

## Contract

Use the repo-owned npm scripts. Do not run `ultracite init`; the root `biome.jsonc` is the canonical configuration and already extends the repo-approved Ultracite presets.

## Repo Contract

- Package manager: npm only. Preserve `package-lock.json`; do not add pnpm, yarn, or bun lockfiles.
- Canonical lint config: root `biome.jsonc`.
- Canonical lint check: `npm run lint`, which runs `ultracite check .`.
- Canonical write/fix command: `npm run format`. It runs `ultracite fix .` as its Biome step, then the other language formatters/sorters (Prettier, pgformatter, taplo, shfmt, sort-package-json, ruff) — see Rule 06. `npm run lint:fix` is only the Biome substep; do not use `npm run lint fix`.
- Setup diagnosis: `npm run lint:doctor`.
- Tool versions are pinned in both `package.json` and `scripts/dependency-catalog.json`; keep them identical.
- `vitest.config.ts` owns test runner behavior. Keep DB-safe worker limits and V8 coverage reporting.

## Use This Skill For

- fixing lint and formatting failures
- changing `biome.jsonc`, lint scripts, or Ultracite/Biome/Vitest dependency pins
- deciding whether a lint exception belongs in root config or source code

## Required Context

- Read `biome.jsonc`, `package.json`, `scripts/dependency-catalog.json`, and `vitest.config.ts` before changing tooling behavior.
- Read `references/override-zones.md` before changing lint include/exclude or rule overrides.
- Read `references/code-standards.md` when fixing source diagnostics.

## Verification

- `npm run lint:doctor` after dependency/config changes.
- `npm run lint` for lint validation.
- `npm run format` when auto-fix is appropriate, then re-run the narrow validation gate.
- `npm test -- --reporter=dot` after changing test-runner configuration.
