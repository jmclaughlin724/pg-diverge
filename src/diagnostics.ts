import type { Diagnostic, DiagnosticSeverity, ObjectRef } from "./core.js";
import { redactSecrets } from "./redaction.js";

interface DiagnosticExtras {
  file?: string | undefined;
  hint?: string | undefined;
  ref?: ObjectRef | undefined;
  schemas?: string[] | undefined;
  statement?: string | undefined;
}

export function diagnostic(
  code: string,
  severity: DiagnosticSeverity,
  message: string,
  extras: DiagnosticExtras = {}
): Diagnostic {
  const output: Diagnostic = {
    code,
    message: redactSecrets(message),
    severity,
  };
  if (extras.file !== undefined) {
    output.file = extras.file;
  }
  if (extras.hint !== undefined) {
    output.hint = redactSecrets(extras.hint);
  }
  if (extras.ref !== undefined) {
    output.ref = extras.ref;
  }
  if (extras.statement !== undefined) {
    output.statement = redactSecrets(extras.statement);
  }
  if (extras.schemas !== undefined && extras.schemas.length > 0) {
    output.schemas = extras.schemas;
  }
  return output;
}
export function hasErrors(diagnostics: Diagnostic[]): boolean {
  return diagnostics.some((item) => item.severity === "error");
}

export function formatDiagnostic(item: Diagnostic): string {
  const location = item.file ? ` ${item.file}` : "";
  const ref = item.ref ? ` ${formatRef(item.ref)}` : "";
  const hint = item.hint ? `\n  hint: ${item.hint}` : "";
  return `${item.severity.toUpperCase()} ${item.code}${location}${ref}: ${item.message}${hint}`;
}

export function formatDiagnostics(diagnostics: Diagnostic[]): string {
  return diagnostics.map(formatDiagnostic).join("\n");
}

function formatRef(ref: ObjectRef): string {
  const schema = ref.schema ? `${ref.schema}.` : "";
  const table = ref.table ? ` on ${ref.schema ? `${ref.schema}.` : ""}${ref.table}` : "";
  const signature = ref.signature ? `(${ref.signature})` : "";
  return `[${ref.kind}:${schema}${ref.name}${signature}${table}]`;
}

export const diagnosticCatalog: Record<string, string> = {
  SUPA_CONFIG_INVALID:
    "supaschema.config.json failed schema validation; fix the reported fields against supaschema-config.schema.json.",
  SUPA_CATALOG_EXTRACT_FAILED: "Live catalog extraction failed; check the database URL and role.",
  SUPA_CATALOG_SNAPSHOT_VERSION:
    "The catalog snapshot was produced by a different supaschema model version; hashes may not be comparable.",
  SUPA_CHECK_ADD_CONSTRAINT_GUARD: "ADD CONSTRAINT must be wrapped in a catalog guard DO block.",
  SUPA_CHECK_ALTER_COLUMN_TYPE_REWRITE:
    "ALTER COLUMN TYPE can rewrite the table under an ACCESS EXCLUSIVE lock.",
  SUPA_CHECK_CASCADE: "Implicit CASCADE is forbidden; drop dependents explicitly in order.",
  SUPA_CHECK_CREATE_EXTENSION_GUARD: "CREATE EXTENSION must use IF NOT EXISTS.",
  SUPA_CHECK_CREATE_INDEX_GUARD: "CREATE INDEX must use IF NOT EXISTS.",
  SUPA_CHECK_CREATE_MATERIALIZED_VIEW_GUARD: "CREATE MATERIALIZED VIEW must use IF NOT EXISTS.",
  SUPA_CHECK_CREATE_ROUTINE_REPLACE: "FUNCTION and PROCEDURE creation must use OR REPLACE.",
  SUPA_CHECK_CREATE_SCHEMA_GUARD: "CREATE SCHEMA must use IF NOT EXISTS.",
  SUPA_CHECK_CREATE_SEQUENCE_GUARD: "CREATE SEQUENCE must use IF NOT EXISTS.",
  SUPA_CHECK_CREATE_TABLE_GUARD: "CREATE TABLE must use IF NOT EXISTS.",
  SUPA_CHECK_CREATE_TRIGGER_REPLACEMENT:
    "CREATE TRIGGER must use OR REPLACE or follow DROP TRIGGER IF EXISTS.",
  SUPA_CHECK_CREATE_TYPE_GUARD: "TYPE and DOMAIN creation must be wrapped in a catalog guard.",
  SUPA_CHECK_CREATE_VIEW_REPLACE: "VIEW creation must use OR REPLACE.",
  SUPA_CHECK_DML_REVIEW: "Data-modifying statements need explicit idempotency review.",
  SUPA_CHECK_DROP_IF_EXISTS: "DROP statements must use IF EXISTS.",
  SUPA_CHECK_INSERT_ON_CONFLICT: "INSERT statements in migrations must use ON CONFLICT.",
  SUPA_DIFF_LINEAGE_BROKEN:
    "The plan's from-state does not continue the newest pending supaschema migration; regenerate from the post-migration state.",
  SUPA_DIFF_LINEAGE_DUPLICATE:
    "A pending supaschema migration already covers this exact from/to transition.",
  SUPA_DIFF_OUTPUT_EXISTS:
    "The output migration file already exists; supaschema never overwrites migrations.",
  SUPA_CHECK_ENUM_VALUE_USE_SAME_TRANSACTION:
    "An enum value added in this migration is used later in the same file; transactional runners fail.",
  SUPA_CHECK_NONTRANSACTIONAL_INDEX:
    "CREATE INDEX CONCURRENTLY cannot run inside a transaction block.",
  SUPA_CHECK_NONTRANSACTIONAL_REFRESH:
    "REFRESH MATERIALIZED VIEW CONCURRENTLY cannot run inside a transaction block.",
  SUPA_CHECK_SEARCH_PATH: "Migrations must not set the session search_path.",
  SUPA_CHECK_SECURITY_DEFINER_SEARCH_PATH:
    "SECURITY DEFINER functions should set a function-local search_path.",
  SUPA_CHECK_SET_NOT_NULL_SCAN:
    "SET NOT NULL scans the table unless a validated CHECK constraint proves it.",
  SUPA_CHECK_VOLATILE_DEFAULT_REWRITE: "ADD COLUMN with a volatile default rewrites the table.",
  SUPA_CHECK_DEPARSE_MISMATCH:
    "A migration statement does not round-trip through the deparser to an identical parse tree; canonical-output normalization would alter it.",
  SUPA_CHECK_DEPARSE_UNSUPPORTED:
    "A migration statement cannot be deparsed for the round-trip proof; normalization would fall back to source text for it.",
  SUPA_CORPUS_RECONVERGENCE:
    "The corpus oracle did not converge: residual operations remain after applying the rendered reconciliation to the dirty corpus database, or the second apply changed the catalog.",
  SUPA_EXTRACT_DUPLICATE_OBJECT: "Two source statements declare the same object identity.",
  SUPA_MIGRATIONS_GHOST_VERSIONS:
    "The target's history table records versions with no migration file on disk; the worktree cannot reproduce the target.",
  SUPA_MIGRATIONS_HISTORY_TABLE:
    "The migration history table is missing or not schema-qualified; pass --history-table for non-Supabase runners.",
  SUPA_MIGRATIONS_NO_TARGET:
    "No database URL resolved; the migrations report covers disk files only.",
  SUPA_MIGRATIONS_OUT_OF_ORDER:
    "Pending migration files are older than the target's newest applied version; a runner may skip or misorder them.",
  SUPA_MIGRATIONS_TARGET_UNAVAILABLE: "The migrations target database could not be read.",
  SUPA_SYNC_DISABLED: "workflow.migration_sync is disabled, so configured apply/deploy is refused.",
  SUPA_SYNC_ENV_UNKNOWN: "The selected sync environment is not defined in config.environments.",
  SUPA_SYNC_FINAL_RECONCILE_FAILED:
    "The selected target did not reconcile after the migration runner completed.",
  SUPA_SYNC_REMOTE_APPROVAL_REQUIRED:
    "Automatic remote sync requires the configured runtime approval environment variable.",
  SUPA_SYNC_RUNNER_FAILED:
    "The selected migration runner exited nonzero during sync; supaschema gates but the runner owns apply/deploy.",
  SUPA_SYNC_RUNNER_UNAVAILABLE:
    "The selected migration runner could not be launched or connected. supaschema gates and delegates apply to the runner.",
  SUPA_SYNC_TARGET_OVERRIDE_MULTI:
    "A database URL or environment override can only be used when exactly one sync target is selected.",
  SUPA_SYNC_TARGET_UNKNOWN: "The selected sync target is not configured.",
  SUPA_SYNC_TARGET_URL_UNRESOLVED: "The selected sync target's database URL could not be resolved.",
  SUPA_DIFF_LINEAGE_GAP:
    "The newest pending supaschema migration does not chain into the next schema diff.",
  SUPA_NORMALIZE_FIDELITY:
    "Deparsed SQL did not reparse to the identical parse tree, so the object kept its source text.",
  SUPA_NORMALIZE_UNSUPPORTED:
    "The deparser cannot render this object, so it kept its source text under normalize mode.",
  SUPA_EXTRACT_PARSER_REQUIRED: "AST extraction requires the libpg-query parser.",
  SUPA_EXTRACT_SIDE_EFFECT_UNSUPPORTED:
    "Side-effect statements are not schema objects; keep them in reviewed migrations.",
  SUPA_EXTRACT_UNSUPPORTED: "Unsupported or ambiguous DDL; extend support or hand-author it.",
  SUPA_INTAKE_MALFORMED:
    "Customer-supplied intake payload is not a JSON object or exceeds the nesting limit; submit a well-formed object.",
  SUPA_INTAKE_MISSING_SCOPE:
    "Customer-supplied intake payload is missing a required scope field; include every required key.",
  SUPA_INTAKE_SECRET:
    "Customer-supplied intake payload contains a secret-shaped value; redact credentials before submitting.",
  SUPA_RULE_DESTRUCTIVE_OP:
    "A destructive operation will run in this migration; review it for data loss and lock impact before deploy.",
  SUPA_RULE_POLICY_MISSING_PREDICATE:
    "An RLS policy lacks the USING or WITH CHECK predicate needed for its command class.",
  SUPA_RULE_POLICY_MISSING_REQUIRED_COLUMN:
    "An RLS policy lacks a configured table column in its effective predicate.",
  SUPA_OBJECT_PARSE_FAILED:
    "Object SQL did not parse, so its identity hash fell back to normalized text.",
  SUPA_PARSE_ERROR: "SQL failed to parse with the PostgreSQL parser.",
  SUPA_PARSE_UNAVAILABLE: "libpg-query did not expose a parser entrypoint.",
  SUPA_PLAN_ADD_COLUMN_UNSAFE:
    "Added column needs review: inline constraint, identity/generated, or NOT NULL without default.",
  SUPA_PLAN_COLUMN_ALTER_HINT_REQUIRED:
    "Column drops and type changes render data-preserving ALTERs only after a destructive-change hint.",
  SUPA_PLAN_COLUMN_TYPE_USING_REVIEW:
    "A column type change renders an identity USING cast; PostgreSQL rejects it unless an assignment cast exists. Review and replace the USING expression for non-trivial conversions.",
  SUPA_PLAN_CONCURRENT_INDEX_UNSUPPORTED:
    "CREATE INDEX CONCURRENTLY cannot run inside the transaction the migration runner uses.",
  SUPA_PLAN_DEPENDENCY_CYCLE: "Dependency ordering found a reference cycle between objects.",
  SUPA_PLAN_DESTRUCTIVE_HINT_REQUIRED:
    "Destructive change requires the object key in hints.destructive.",
  SUPA_PLAN_EMPTY_WITH_DRIFT:
    "The plan contains no operations but the model fingerprints differ; an empty migration would silently mask real drift.",
  SUPA_PLAN_RENAME_HINT_UNMATCHED: "Rename hint does not match both source and target objects.",
  SUPA_PLAN_ROUTINE_RETURN_TYPE_CHANGED:
    "Routine return type or OUT parameters changed; CREATE OR REPLACE cannot apply it.",
  SUPA_PLAN_RENAME_KIND_MISMATCH: "Rename hint changes the object kind.",
  SUPA_PLAN_RENAME_SET_SCHEMA_UNSUPPORTED: "Rename hints cannot move objects between schemas.",
  SUPA_PLAN_RENAME_UNSUPPORTED: "This object kind has no safe rename rendering yet.",
  SUPA_PLAN_RENAME_VERIFY_REQUIRED: "Rename hints must be verified against a disposable database.",
  SUPA_PLAN_VIEW_REPLACE_INCOMPATIBLE:
    "View replacement drops, renames, or reorders output columns; CREATE OR REPLACE VIEW cannot apply it.",
  SUPA_PLAN_VIEW_REPLACE_VERIFY_REQUIRED:
    "CREATE OR REPLACE VIEW only allows compatible column shapes; verify before release.",
  SUPA_SELFCHECK_HASH_MISMATCH:
    "A catalog object hashes differently after its rendered SQL is re-extracted; cross-lane diffs would report a false change.",
  SUPA_SELFCHECK_MISSING: "A catalog object disappeared when its rendered SQL was re-extracted.",
  SUPA_SELFCHECK_UNEXPECTED: "Re-extraction produced an object the catalog model does not contain.",
  SUPA_SUPABASE_MANAGED_SCHEMA: "Configured managed schemas are not declarative source owners.",
  SUPA_SUPABASE_VIEW_SECURITY_INVOKER:
    "Views in exposed schemas should set security_invoker so RLS applies to the querying role.",
  SUPA_VALIDATOR_FAILED: "A configured external validator reported diagnostics.",
  SUPA_VALIDATOR_UNAVAILABLE: "A configured external validator is not installed.",
  SUPA_VALIDATOR_UNKNOWN: "Unknown validator name in the validators config.",
  SUPA_VERIFY_CLEANUP_FAILED: "A temporary verification database could not be dropped.",
  SUPA_VERIFY_FAILED: "Verification could not complete against the database.",
  SUPA_VERIFY_ROLE_CAPABILITY:
    "The verification role cannot CREATE DATABASE; verify needs a role with CREATEDB (on local Supabase stacks prefer supabase_admin).",
  SUPA_VERIFY_STUB_REFERENCE:
    "Verify failed referencing a managed schema that --ensure-environment only stubs minimally; the failure may be a stub limitation, not a real migration defect. Confirm by applying the migration to a real disposable database that provisions the managed surface. Use --no-ensure-environment only when the verification server itself provisions the managed surface in new databases.",
  SUPA_VERIFY_FINGERPRINT_MISMATCH:
    "Catalog after from+migration+migration differs from the target catalog.",
  SUPA_VERIFY_RECONVERGENCE:
    "Cross-lane diff of the migrated catalog against the target model is not empty; the model declares state the catalog cannot reproduce (false drift), or lane parity is broken. A converged diff must re-diff to zero.",
};
