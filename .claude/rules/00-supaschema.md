---
description: Compatibility pointer for the canonical supaschema migration policy rule.
---

# Rule 00 — supaschema Policy Pointer

## Contract

This numbered file exists only to preserve rule-citation compatibility. The canonical migration policy owner is `.claude/rules/supaschema.md`.


The canonical owner is `.claude/rules/supaschema.md`.

This numbered file exists only for rule-citation compatibility. Do not add migration policy here; update `.claude/rules/supaschema.md` and keep `.codex/rules/supaschema.rules` as a Codex-native pointer to that owner.

## Verification

When migration policy changes, update `.claude/rules/supaschema.md`, then keep this file as a pointer only and run the rule/context sync check that applies to the repo.

## Failure behavior

Do not add unique migration policy here. Move any new policy to `.claude/rules/supaschema.md` and keep Codex pointers aligned.

## Done means

This file remains a compatibility pointer and contains no unique migration policy.
