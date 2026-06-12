# Diagnostics

Diagnostics have `code`, `severity`, `message`, and optional `ref`, `file`, `statement`, and `hint` fields.

| Code | Severity | Meaning |
| --- | --- | --- |
| `SUPA_PARSE_ERROR` | error | `libpg-query` could not parse the SQL. |
| `SUPA_PARSE_UNAVAILABLE` | warning | The parser dependency did not expose an expected parser function. |
| `SUPA_EXTRACT_PARSER_REQUIRED` | error | AST extraction requires the `libpg-query` parser; there is no regex fallback. |
| `SUPA_EXTRACT_UNSUPPORTED` | error | The source contains DDL that `supaschema` cannot model safely. |
| `SUPA_EXTRACT_DUPLICATE_OBJECT` | error | Two source statements claim the same object identity. |
| `SUPA_EXTRACT_SIDE_EFFECT_UNSUPPORTED` | error | The source contains a data/control-plane side-effect statement that is not a replay-safe schema object. |
| `SUPA_OBJECT_PARSE_FAILED` | error | Object SQL did not parse, so its identity hash fell back to normalized text. |
| `SUPA_SUPABASE_MANAGED_SCHEMA` | error | A Supabase-managed schema was edited as declarative source. |
| `SUPA_SUPABASE_VIEW_SECURITY_INVOKER` | warning | A view in an exposed schema does not set `security_invoker`, so RLS applies as the view owner. |
| `SUPA_CATALOG_EXTRACT_FAILED` | error | Catalog extraction failed against the supplied database. |
| `SUPA_CATALOG_SNAPSHOT_VERSION` | warning | A `catalog:` snapshot was produced by a different supaschema model version; regenerate it to keep hashes comparable. |
| `SUPA_OBJECT_PARSE_FAILED` | error | Object SQL did not parse, so its identity hash fell back to normalized text. |
| `SUPA_DIFF_LINEAGE_BROKEN` | error | The plan's from-state does not continue the newest pending supaschema migration in the output directory. |
| `SUPA_DIFF_LINEAGE_DUPLICATE` | error | A pending supaschema migration already covers this exact from/to transition. |
| `SUPA_DIFF_OUTPUT_EXISTS` | error | The output migration file already exists; supaschema never overwrites migrations. |
| `SUPA_PLAN_DESTRUCTIVE_HINT_REQUIRED` | error | A destructive change lacks an explicit hint. |
| `SUPA_PLAN_ADD_COLUMN_UNSAFE` | error | An additive column change needs explicit migration review. |
| `SUPA_PLAN_COLUMN_ALTER_HINT_REQUIRED` | error | Column drops and type changes render data-preserving ALTERs only after a destructive-change hint. |
| `SUPA_PLAN_DEPENDENCY_CYCLE` | error | Dependency ordering produced a cycle. |
| `SUPA_PLAN_EMPTY_WITH_DRIFT` | error | The plan has no operations but the model fingerprints differ; an empty migration would silently mask real drift. |
| `SUPA_PLAN_RENAME_HINT_UNMATCHED` | error | A rename hint did not match both source and target objects. |
| `SUPA_PLAN_RENAME_KIND_MISMATCH` | error | A rename hint maps between different object kinds. |
| `SUPA_PLAN_RENAME_SET_SCHEMA_UNSUPPORTED` | error | A rename hint attempts to move an object between schemas. |
| `SUPA_PLAN_RENAME_UNSUPPORTED` | error | The object kind cannot yet be renamed safely by the renderer. |
| `SUPA_PLAN_RENAME_VERIFY_REQUIRED` | warning | Rename output must be verified against PostgreSQL before release. |
| `SUPA_PLAN_ROUTINE_RETURN_TYPE_CHANGED` | error | The routine's return type or OUT parameters changed; `CREATE OR REPLACE` cannot apply it without a hinted drop. |
| `SUPA_PLAN_VIEW_REPLACE_INCOMPATIBLE` | error | The view drops, renames, or reorders output columns; `CREATE OR REPLACE VIEW` cannot apply it without a hinted drop. |
| `SUPA_PLAN_VIEW_REPLACE_VERIFY_REQUIRED` | warning | View output columns are statically unknowable; verify the replacement against PostgreSQL rules. |
| `SUPA_PLAN_CONCURRENT_INDEX_UNSUPPORTED` | error | `CREATE INDEX CONCURRENTLY` cannot run inside the transaction the migration runner uses. |
| `SUPA_CHECK_CASCADE` | error | `CASCADE` appears in migration SQL. |
| `SUPA_CHECK_DROP_IF_EXISTS` | error | A `DROP` statement lacks `IF EXISTS`. |
| `SUPA_CHECK_CREATE_SCHEMA_GUARD` | error | `CREATE SCHEMA` lacks `IF NOT EXISTS` or a catalog guard. |
| `SUPA_CHECK_CREATE_EXTENSION_GUARD` | error | `CREATE EXTENSION` lacks `IF NOT EXISTS` or a catalog guard. |
| `SUPA_CHECK_CREATE_TABLE_GUARD` | error | `CREATE TABLE` lacks `IF NOT EXISTS` or a catalog guard. |
| `SUPA_CHECK_CREATE_SEQUENCE_GUARD` | error | `CREATE SEQUENCE` lacks `IF NOT EXISTS` or a catalog guard. |
| `SUPA_CHECK_CREATE_INDEX_GUARD` | error | `CREATE INDEX` lacks `IF NOT EXISTS` or a catalog guard. |
| `SUPA_CHECK_CREATE_MATERIALIZED_VIEW_GUARD` | error | `CREATE MATERIALIZED VIEW` lacks `IF NOT EXISTS` or a catalog guard. |
| `SUPA_CHECK_CREATE_VIEW_REPLACE` | error | `CREATE VIEW` lacks `OR REPLACE`. |
| `SUPA_CHECK_CREATE_ROUTINE_REPLACE` | error | `CREATE FUNCTION` or `CREATE PROCEDURE` lacks `OR REPLACE`. |
| `SUPA_CHECK_CREATE_TYPE_GUARD` | error | `CREATE TYPE` or `CREATE DOMAIN` is not wrapped in a catalog guard. |
| `SUPA_CHECK_ADD_CONSTRAINT_GUARD` | error | `ALTER TABLE ... ADD CONSTRAINT` is not wrapped in a catalog guard. |
| `SUPA_CHECK_CREATE_TRIGGER_REPLACEMENT` | error | `CREATE TRIGGER` is not preceded by `DROP TRIGGER IF EXISTS`. |
| `SUPA_CHECK_SEARCH_PATH` | error | Migration SQL depends on session `search_path`. |
| `SUPA_CHECK_SECURITY_DEFINER_SEARCH_PATH` | warning | A `SECURITY DEFINER` function lacks function-local `SET search_path`. |
| `SUPA_CHECK_ENUM_VALUE_USE_SAME_TRANSACTION` | error/warning | An enum value added in this migration is used later in the same file; transactional runners fail. Error under `transactionMode: "per-migration"`, warning under `per-statement`. |
| `SUPA_CHECK_NONTRANSACTIONAL_INDEX` | error/warning | `CREATE INDEX CONCURRENTLY` needs transaction wrapping disabled. Error under `supabase-auto` or `per-migration` mode. |
| `SUPA_CHECK_NONTRANSACTIONAL_REFRESH` | error/warning | `REFRESH MATERIALIZED VIEW CONCURRENTLY` needs transaction wrapping disabled. Error under `supabase-auto` or `per-migration` mode. |
| `SUPA_CHECK_ALTER_COLUMN_TYPE_REWRITE` | warning | `ALTER COLUMN TYPE` can rewrite the table under an `ACCESS EXCLUSIVE` lock. |
| `SUPA_CHECK_SET_NOT_NULL_SCAN` | warning | `SET NOT NULL` scans the table unless a validated `CHECK` constraint already proves it. |
| `SUPA_CHECK_DEPARSE_MISMATCH` | warning | A statement does not round-trip through the deparser to an identical parse tree; `normalize: "deparse"` would keep its source text. |
| `SUPA_CHECK_DEPARSE_UNSUPPORTED` | warning | A statement cannot be deparsed for the round-trip proof. |
| `SUPA_NORMALIZE_FIDELITY` | warning | Deparsed SQL did not reparse to the identical parse tree; the object kept its source text under `normalize: "deparse"`. |
| `SUPA_NORMALIZE_UNSUPPORTED` | warning | The deparser cannot render this object; it kept its source text under `normalize: "deparse"`. |
| `SUPA_CORPUS_RECONVERGENCE` | error | The corpus oracle did not converge: residual operations remain after applying the rendered reconciliation to the dirty corpus database, the second apply changed the catalog, or a pipeline stage failed (see `docs/corpus.md`). |
| `SUPA_CHECK_VOLATILE_DEFAULT_REWRITE` | warning | `ADD COLUMN` with a volatile default rewrites the whole table. |
| `SUPA_CHECK_INSERT_ON_CONFLICT` | error | `INSERT` statements in migrations must use `ON CONFLICT` for replay safety. |
| `SUPA_CHECK_DML_REVIEW` | warning | `UPDATE`/`DELETE` statements need explicit idempotency review. |
| `SUPA_CHECK_POLICY_REPLACEMENT` | error | `CREATE POLICY` should be paired with an explicit prior drop for replacement. |
| `SUPA_SELFCHECK_HASH_MISMATCH` | error | A catalog object hashes differently after its rendered SQL is re-extracted; cross-lane diffs would report a false change. |
| `SUPA_SELFCHECK_MISSING` | error | A catalog object disappeared when its rendered SQL was re-extracted. |
| `SUPA_SELFCHECK_UNEXPECTED` | error | Re-extraction produced an object the catalog model does not contain. |
| `SUPA_VALIDATOR_FAILED` | error | A configured external validator reported diagnostics. |
| `SUPA_VALIDATOR_UNAVAILABLE` | error | A configured external validator binary was not found. |
| `SUPA_VALIDATOR_UNKNOWN` | error | The config references an unknown validator. |
| `SUPA_VERIFY_CLEANUP_FAILED` | warning | A temporary verification database could not be dropped and may need manual removal. |
| `SUPA_VERIFY_FINGERPRINT_MISMATCH` hints | — | The mismatch hint names the differing objects: missing from the migration result, not present in the target, and definition differs. |
| `SUPA_VERIFY_FAILED` | error | Temporary database verification failed. |
| `SUPA_VERIFY_FINGERPRINT_MISMATCH` | error | Applying the migration twice did not produce the target catalog fingerprint. |
