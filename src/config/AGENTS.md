# src/config - configuration contract

## Contract

This directory owns the runtime configuration schema, defaults, validation, and generated JSON-schema surface. It is included so the CLI, hooks, package scaffold, docs, and config contract all use one source of truth.

## Contents

- `contract.ts` defines canonical config constants, enum values, defaults, and install merge behavior.
- `schema.ts` builds and loads the zod-backed config schema.
- `validate.ts` reports config and path ownership diagnostics.
- `schema-gen.ts` emits generated config-schema artifacts.

## Working Rules

- Add config fields in `contract.ts` first, then wire schema, metadata, docs, and tests together.
- Do not duplicate default values in CLI, hooks, or package code.
- Keep generated schema output deterministic.

## Verification

Run `npm run build` after schema changes, plus focused config tests and `npm run typecheck`.
