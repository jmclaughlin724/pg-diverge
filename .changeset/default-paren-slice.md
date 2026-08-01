---
"supaschema": patch
---

Fix unbalanced parenthesized column DEFAULT expressions in extraction: PostgreSQL reports the expression location after the opening paren, so rendered ALTER COLUMN ... SET DEFAULT statements kept the closing paren but dropped the opening one, producing SQL that failed replay checks with a syntax error (SUPA_PARSE_ERROR). The slice now re-extends across enclosing parens.
