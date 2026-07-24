# Maintenance Commands

## Drift gate

```bash
supaschema --quiet diff --fail-on-diff
```

Interpret the exit code before continuing:

- `0`: no planned operations;
- `3`: drift exists and needs a reviewed migration;
- `1`: runtime or argument failure;
- `2`: one or more diagnostics are errors.

## History and safety

```bash
supaschema migrations --json
supaschema check
supaschema types
```

Use the JSON history report to reconcile disk migrations with the selected target. Run the full migration-directory replay check unless the owning workflow intentionally selects a narrower changed-file lane. Refresh generated contracts from the configured schema source and review their diff instead of patching generated files.

## Maintenance change

Re-run the drift gate after regeneration. A maintenance pull request should contain only the source intent, generated migration when drift exists, refreshed TypeScript/Zod contracts, and the command evidence needed to review them. Applying migrations and publishing the branch remain separately authorized actions.
