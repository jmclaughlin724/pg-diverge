---
name: Bug report
about: Report incorrect migration output, a crash, or a wrong diagnostic
title: "[bug] "
labels: bug
assignees: ""
---

<!--
Before filing: search existing issues, and run `supaschema explain <SUPA_CODE>`
if you hit a SUPA_* diagnostic — the recovery procedure may already resolve it.
Never paste real connection strings, passwords, JWTs, or tokens. supaschema
redacts secrets in its own output, but copy/pasted shell scrollback may not.
-->

## What happened

A clear description of the bug, including the exact `supaschema` command you ran.

## Expected behavior

What you expected the migration / check / types output to be.

## Reproduction

The smallest declarative SQL tree (or fixture) that reproduces it. Inline the relevant `.sql` files and your `supaschema.config.json` (`schemaPaths`, `adapter`, `managedSchemas`, `transactionMode`).

```sql
-- minimal schema-tree input
```

## Output / diagnostic

The full command output. Include any `SUPA_*` code and the rendered migration SQL if one was produced. Run with `--debug` / `--summary` where useful.

```
$ supaschema diff
...
```

## Environment

- supaschema version: <!-- `supaschema --version` -->
- Node version: <!-- `node --version` (project supports >=22.12) -->
- OS:
- Target provider: <!-- Supabase / Neon / AWS RDS / Cloud SQL / AlloyDB / Azure / plain Postgres -->
- Postgres version (if a DB lane was involved):

## Additional context

Anything else — was this a `diff`, `check`, `verify`, `types`, `sync`, or hook auto-diff path? Is the affected file a generated artifact (contains `-- supaschema: lineage`)?
