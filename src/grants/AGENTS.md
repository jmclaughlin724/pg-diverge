# src/grants - grant normalization helpers

## Contract

This directory contains grant-specific normalization that does not belong in generic SQL extraction. It is included so default privileges and implied grants do not create noisy or unsafe migration plans.

## Contents

- `default-acl.ts` suppresses grants implied by default ACL objects already present in the model.

## Working Rules

- Keep grant semantics explicit and tied to PostgreSQL privilege facts.
- Do not hide user-authored grants; only suppress facts proven to be implied by modeled default ACLs.
- Coordinate changes with `src/sql/privileges.ts`, `src/planner`, and render tests.

## Verification

Run focused privilege/default-ACL tests when changed, then `npm run typecheck`.
