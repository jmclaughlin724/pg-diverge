---
"supaschema": patch
---

Fix destructive relation replace planning and forward-reference checks: canonicalize `IN`/`BETWEEN` predicates and constant literal casts in constraint hashing so catalog-decompiled and authored spellings plan identically, suppress separately rendered grant drops on replaced relations, order routine drops after the replace they depend on, and treat dropped relations as pre-existing in the forward-reference check while still flagging references inside the drop-recreate gap.
