# src/planning

This directory owns source-driven planning context for migration generation.

It resolves generation-safe source defaults, blocks live database catalogs from generation, loads the configured migration corpus, and extracts the before/after schema models before `src/pipeline` builds a plan.

Keep database-backed inspection, verification, drift, and target-safety logic outside this owner unless the workflow is explicitly non-generation.

## Verification

Run focused source-resolution, corpus, sync, and pipeline tests for changed behavior, then `npm run typecheck`.
