---
"supaschema": patch
---

Fix destructive relation replace planning and forward-reference checks. Constraint hashing now folds `IN` and `= ANY`, and `NOT IN` and `<> ALL`, to a single form so catalog-decompiled and authored spellings plan identically, while keeping `= ALL`, `<> ANY`, and every other quantified operator distinct; constant literal casts are retained in the hash so casts that drive overload or polymorphic resolution no longer collide. Destructive relation replaces now suppress the matching grant drop from both the rendered plan and its diagnostics, re-issue unchanged grants and dependents on replaced foreign tables, and recognize `CREATE`/`DROP FOREIGN TABLE` in the forward-reference check. Model format bumped to 7 so existing lineage routes through the format-drift lane on upgrade instead of surfacing a baseline mismatch.
