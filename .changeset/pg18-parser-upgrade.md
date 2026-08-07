---
"supaschema": minor
---

Upgrade the SQL parser to PostgreSQL 18: align `libpg-query` (17.7.4 → 18.1.4) with `pgsql-deparser` (18.x) so `CHECK … ENFORCED` / `NOT ENFORCED` round-trips natively instead of failing `SUPA_OBJECT_PARSE_FAILED` on the deparse→reparse validation. PG18 shifts statement `stmt_location` past leading comments and omits the `comment` field for empty-string and `NULL` comments, so statement text now preserves leading comments and `COMMENT … IS ''` is distinguished from `IS NULL` via the parser scanner. PG18 also changes several canonical AST shapes (including new `rexpr_list_*` positions on `IN` predicates and `is_enforced` on checks), so canonical hashes shift and `MODEL_FORMAT_VERSION` bumps 6 → 7; baselines recorded by an older format warn with `SUPA_MIGRATION_BASELINE_FORMAT_DRIFT` and re-establish on the next generated migration rather than hard-blocking.
