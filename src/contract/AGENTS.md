# src/contract - schema contract artifacts

## Contract

This directory turns typegen shapes into portable schema contracts and compares contract drift. It is included so consumers can gate API/type compatibility independently of migration rendering.

## Contents

- `schema.ts` defines the JSON-compatible schema contract and drift checks.
- `type-diff.ts` compares generated type surfaces.
- `registry-client.ts` pushes and pulls contracts from a registry endpoint.

## Working Rules

- Keep contract output stable, sorted, and JSON-compatible.
- Do not reach into migration planning from this layer.
- Registry behavior must stay explicit and side-effect free unless a caller invokes push or pull.

## Verification

Run focused contract/type-diff tests when changed, then `npm run typecheck`.
