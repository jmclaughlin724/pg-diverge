# Migration Commands

## Adopt or initialize

```bash
supaschema onboard
supaschema onboard --from dir:database/schemas
supaschema init
supaschema config validate --json
```

Use `onboard` for a credential-free readiness report. Use `init` only from the package or workspace that owns the schema workflow. If init leaves `.supaschema/install.json`, resolve its candidate paths before generation.

## Inspect history

```bash
supaschema migrations --json
```

Read the configured migration directory even when no database target is available. Resolve ghost, out-of-order, stale-baseline, or broken-lineage findings before generating another migration.

## Generate and verify

```bash
supaschema diff
supaschema check
supaschema types
```

Use explicit `--from` or `--to` only when the requested workflow intentionally overrides config. Keep the schema edit, generated migration, and generated contracts together for review. `apply` and `sync` are separate target-mutating workflows and require explicit user intent plus all configured safety and approval gates.
