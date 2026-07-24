# src/contract - schema contract artifacts

## Contract

This directory turns typegen shapes into portable schema contracts and compares contract drift. It is included so consumers can gate API/type compatibility independently of migration rendering.

## Contents

- `schema.ts` defines the JSON-compatible schema contract and drift checks.
- `type-diff.ts` compares generated type surfaces.

## Working Rules

- Keep contract output stable, sorted, and JSON-compatible.
- Do not reach into migration planning from this layer.

## Verification

Run focused contract/type-diff tests when changed, then `npm run typecheck`.
