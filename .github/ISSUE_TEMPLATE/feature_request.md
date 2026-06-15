---
name: Feature request
about: Propose new DDL coverage, a CLI capability, or a developer-experience improvement
title: "[feat] "
labels: enhancement
assignees: ""
---

## Problem

The use case or limitation you're hitting. If supaschema currently fails closed
with a diagnostic (e.g. an unsupported-DDL `SUPA_*` code), include it — that
tells us exactly which model path needs to grow.

## Proposed solution

What you'd like supaschema to do. For new SQL/DDL coverage, give a concrete
declarative-tree input and the migration SQL you'd expect it to render.

```sql
-- desired input
```

```sql
-- desired generated migration
```

## Alternatives considered

Other approaches, workarounds, or related tools.

## Scope notes

- [ ] This is expressible from the declarative SQL tree (not hand-authored migration SQL).
- [ ] This keeps generated migrations idempotent and replay-safe.
- [ ] If it touches SQL semantics, it can be driven from the AST / model (not ad hoc regex).
- [ ] This should be available as both a CLI flag and a typed library API where reusable.

## Additional context

Links, prior art, provider-specific behavior, or anything else.
