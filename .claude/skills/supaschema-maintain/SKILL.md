---
name: supaschema-maintain
description: Audit and maintain an existing Supaschema workflow by detecting schema drift, reconciling migration history, replay-checking SQL, refreshing generated contracts, and preparing a reviewable maintenance change. Use for CI drift failures, stale generated outputs, migration-history anomalies, and routine maintenance pull requests.
---

# Supaschema Maintain

## Contract

Restore a configured project to a zero-drift, replay-safe, generated-contract-current state. Never hand-edit generated migrations, generated TypeScript, or generated Zod output. Read [commands.md](references/commands.md) before running the workflow.

## Workflow

1. Read `supaschema.config.json`, the configured schema trees, and the existing migration directory before classifying drift.
2. Run `supaschema --quiet diff --fail-on-diff`. Exit 0 means the declarative model is converged; exit 3 means operations exist and a migration change is required. Treat exits 1 and 2 as command or diagnostic failures, not drift success.
3. Run `supaschema migrations --json` and resolve pending, ghost, out-of-order, stale-baseline, or lineage findings in their owning source.
4. Run `supaschema check`, then `supaschema types`. Fix unsafe SQL or stale model coverage in the canonical schema, migration, parser, or type-generation owner and regenerate.
5. Review every generated-file delta for declared schema intent and unexpected destructive behavior. Keep the maintenance change focused and include the schema source, migration, generated contracts, and command evidence together.
6. Prepare the maintenance pull request only after the drift gate, migration reconciliation, replay checks, and generated-contract review are green. Do not stage, commit, push, or open a pull request without the user's authorization.
