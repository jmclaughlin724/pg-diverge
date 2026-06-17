import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { extractCatalogModel } from "./catalog.js";
import { checkMigrationSql } from "./check.js";
import { resolveConfig, type SupaschemaConfig } from "./config.js";
import type {
  Diagnostic,
  ExtractOptions,
  MigrationOperation,
  SchemaModel,
  VerifyMigrationOptions,
} from "./core.js";
import {
  applyMigrationSql,
  applySql as applyPerStatementSql,
  assertLocalDatabaseUrl,
  createDatabaseWithRetry,
  databaseUrlWithDatabase,
  tempDatabaseName,
} from "./db-admin.js";
import { diagnostic, hasErrors } from "./diagnostics.js";
import { planSchemaDiff } from "./planner.js";
import { extractSourceModel } from "./source.js";
import { asRecord, astStatements, roleSpecName } from "./sql/ast.js";
import { extractObjectsFromSql } from "./sql/extract.js";
import { quoteIdent } from "./sql/identifiers.js";
import { parseSqlAst } from "./sql/parser.js";
import { preflightCapability, supabaseEnvironmentStubSql } from "./verify-environment.js";

export async function verifyMigration(options: VerifyMigrationOptions): Promise<Diagnostic[]> {
  const config = resolveConfig(options.config);
  const diagnostics: Diagnostic[] = [];
  const databaseDiagnostic = verifyDatabaseUrlDiagnostic(options.databaseUrl);
  if (databaseDiagnostic !== undefined) {
    return [databaseDiagnostic];
  }
  const migrationSql = await readFile(options.migrationPath, "utf8");
  const extractOptions = verificationExtractOptions(options);
  diagnostics.push(...(await checkMigrationSql(migrationSql, extractOptions)));
  if (hasErrors(diagnostics)) {
    return diagnostics;
  }
  const from = await extractSourceModel(options.from, extractOptions);
  const to = await extractSourceModel(options.to, extractOptions);
  diagnostics.push(...from.diagnostics, ...to.diagnostics);
  if (hasErrors(diagnostics)) {
    return diagnostics;
  }
  const admin = new Client({ connectionString: options.databaseUrl });
  const migrationDb = tempDatabaseName("migration");
  const targetDb = tempDatabaseName("target");
  const created: string[] = [];
  const environmentEnsured = options.ensureEnvironment ?? false;
  try {
    if (await connectVerificationAdmin(admin, diagnostics)) {
      return diagnostics;
    }
    await createVerificationDatabases(admin, [migrationDb, targetDb], created);
    const migrationUrl = databaseUrlWithDatabase(options.databaseUrl, migrationDb);
    const targetUrl = databaseUrlWithDatabase(options.databaseUrl, targetDb);
    if (options.ensureRoles === true) {
      await ensureReferencedRoles(admin, [from, to]);
    }
    await ensureVerificationEnvironment(environmentEnsured, migrationUrl, targetUrl);
    await applyVerificationScenario(migrationUrl, targetUrl, from, to, migrationSql, config);
    await compareVerificationCatalogs(
      migrationUrl,
      targetUrl,
      to,
      config,
      environmentEnsured,
      diagnostics
    );
  } catch (error) {
    diagnostics.push(...verifyFailureDiagnostics(error, environmentEnsured, config));
  } finally {
    await cleanupTempDatabases(admin, created, options.keepDatabases === true, diagnostics);
    await admin.end().catch(() => undefined);
  }
  return diagnostics;
}

function verifyDatabaseUrlDiagnostic(databaseUrl: string): Diagnostic | undefined {
  try {
    assertLocalDatabaseUrl(databaseUrl, "SUPASCHEMA_VERIFY_ALLOW_REMOTE");
    return;
  } catch (error) {
    return diagnostic("SUPA_VERIFY_FAILED", "error", errorMessage(error), {
      hint: "verify creates and drops databases; non-local hosts require SUPASCHEMA_VERIFY_ALLOW_REMOTE=1.",
    });
  }
}

function verificationExtractOptions(options: VerifyMigrationOptions): ExtractOptions {
  const extractOptions: ExtractOptions = {};
  if (options.config !== undefined) {
    extractOptions.config = options.config;
  }
  if (options.cwd !== undefined) {
    extractOptions.cwd = options.cwd;
  }
  return extractOptions;
}

async function connectVerificationAdmin(
  admin: Client,
  diagnostics: Diagnostic[]
): Promise<boolean> {
  await admin.connect();
  const capability = await preflightCapability(admin);
  if (capability === undefined) {
    return false;
  }
  diagnostics.push(capability);
  return true;
}

async function createVerificationDatabases(
  admin: Client,
  databaseNames: string[],
  created: string[]
): Promise<void> {
  for (const databaseName of databaseNames) {
    await createDatabaseWithRetry(admin, `CREATE DATABASE ${quoteIdent(databaseName)}`);
    created.push(databaseName);
  }
}

async function ensureVerificationEnvironment(
  environmentEnsured: boolean,
  migrationUrl: string,
  targetUrl: string
): Promise<void> {
  if (!environmentEnsured) {
    return;
  }
  // Stubs land in both databases, so catalog parity is unaffected.
  await applySql(migrationUrl, supabaseEnvironmentStubSql, "per-statement");
  await applySql(targetUrl, supabaseEnvironmentStubSql, "per-statement");
}

async function applyVerificationScenario(
  migrationUrl: string,
  targetUrl: string,
  from: SchemaModel,
  to: SchemaModel,
  migrationSql: string,
  config: SupaschemaConfig
): Promise<void> {
  await applyModel(migrationUrl, from);
  await applySql(migrationUrl, migrationSql, config.transactionMode);
  await applySql(migrationUrl, migrationSql, config.transactionMode);
  await applyModel(targetUrl, to);
}

async function compareVerificationCatalogs(
  migrationUrl: string,
  targetUrl: string,
  to: SchemaModel,
  config: SupaschemaConfig,
  environmentEnsured: boolean,
  diagnostics: Diagnostic[]
): Promise<void> {
  const afterMigration = await extractCatalogModel({
    databaseUrl: migrationUrl,
    source: "verify:migration",
  });
  const expectedTarget = await extractCatalogModel({
    databaseUrl: targetUrl,
    source: "verify:target",
  });
  diagnostics.push(...afterMigration.diagnostics, ...expectedTarget.diagnostics);
  pushFingerprintMismatchDiagnostic(diagnostics, afterMigration, expectedTarget);
  await pushReconvergenceDiagnostic(diagnostics, afterMigration, to, config, environmentEnsured);
}

function pushFingerprintMismatchDiagnostic(
  diagnostics: Diagnostic[],
  afterMigration: SchemaModel,
  expectedTarget: SchemaModel
): void {
  if (afterMigration.fingerprint === expectedTarget.fingerprint) {
    return;
  }
  diagnostics.push(
    diagnostic(
      "SUPA_VERIFY_FINGERPRINT_MISMATCH",
      "error",
      "migration result catalog fingerprint does not match target catalog fingerprint",
      {
        hint: fingerprintMismatchHint(afterMigration, expectedTarget),
      }
    )
  );
}

async function pushReconvergenceDiagnostic(
  diagnostics: Diagnostic[],
  afterMigration: SchemaModel,
  to: SchemaModel,
  config: SupaschemaConfig,
  environmentEnsured: boolean
): Promise<void> {
  // Reconvergence catches false drift that symmetric catalog fingerprints miss.
  const reconvergence = planSchemaDiff(afterMigration, to, {
    config: { ...config, hints: { ...config.hints, destructive: ["*"], renames: [] } },
  });
  const stubKeys = environmentEnsured ? await stubObjectKeys(config) : new Set<string>();
  const result = reconvergenceResidualDiagnostic(reconvergence.operations, stubKeys);
  if (result !== undefined) {
    diagnostics.push(result);
  }
}

function verifyFailureDiagnostics(
  error: unknown,
  environmentEnsured: boolean,
  config: SupaschemaConfig
): Diagnostic[] {
  const message = errorMessage(error);
  const out: Diagnostic[] = [
    diagnostic("SUPA_VERIFY_FAILED", "error", message, {
      hint: "Use a disposable PostgreSQL database URL whose role can CREATE DATABASE and DROP DATABASE.",
    }),
  ];
  const stubbedSchema = environmentEnsured
    ? managedSchemaReferenced(message, config.managedSchemas)
    : undefined;
  if (stubbedSchema !== undefined) {
    out.push(
      diagnostic(
        "SUPA_VERIFY_STUB_REFERENCE",
        "warning",
        `verify failed while referencing the "${stubbedSchema}" managed schema, which --ensure-environment provisions only as a minimal stub`,
        {
          hint: `--ensure-environment stubs auth.users (the GoTrue column set), the auth.uid/role/jwt/email helpers, and the cron tables; other ${stubbedSchema} objects are absent. This may be a stub limitation rather than a real migration defect; confirm by applying the migration to a disposable database that provisions the managed surface. Use --no-ensure-environment only when the verification server itself provisions the managed surface in new databases.`,
        }
      )
    );
  }
  return out;
}

async function cleanupTempDatabases(
  admin: Client,
  created: string[],
  keepDatabases: boolean,
  diagnostics: Diagnostic[]
): Promise<void> {
  if (keepDatabases && created.length > 0) {
    diagnostics.push(
      diagnostic(
        "SUPA_VERIFY_CLEANUP_FAILED",
        "warning",
        `kept temporary databases for inspection: ${created.join(", ")}`,
        { hint: "Drop them manually when done (--keep-databases was set)." }
      )
    );
    return;
  }
  for (const databaseName of created.reverse()) {
    try {
      await admin.query(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
        [databaseName]
      );
      await admin.query(`DROP DATABASE IF EXISTS ${quoteIdent(databaseName)} WITH (FORCE)`);
    } catch (cleanupError) {
      diagnostics.push(
        diagnostic("SUPA_VERIFY_CLEANUP_FAILED", "warning", errorMessage(cleanupError), {
          hint: `Temporary database ${databaseName} may need manual removal.`,
        })
      );
    }
  }
}
/**
 * Roles referenced by grants, default privileges, and policies. Roles are
 * cluster-level so models cannot create them; verify pre-creates missing
 * NOLOGIN roles when ensureRoles is set.
 */
async function collectReferencedRoles(models: SchemaModel[]): Promise<string[]> {
  const roles = new Set<string>();
  const add = (value: unknown): void => {
    if (typeof value === "string" && value.length > 0 && value !== "PUBLIC") {
      roles.add(value);
    }
  };
  for (const model of models) {
    for (const object of model.objects) {
      await collectRolesFromObject(object, add);
    }
  }
  return [...roles].sort((left, right) => left.localeCompare(right));
}

async function collectRolesFromObject(
  object: SchemaModel["objects"][number],
  add: (value: unknown) => void
): Promise<void> {
  if (object.ref.kind === "grant" || object.ref.kind === "default-privilege") {
    add(object.metadata.grantee);
    add(object.metadata.forRole);
    return;
  }
  if (object.ref.kind !== "policy") {
    return;
  }
  const parsed = await parseSqlAst(object.sql);
  if (parsed.ast === undefined) {
    return;
  }
  for (const statement of astStatements(parsed.ast, object.sql)) {
    const policy = asRecord(statement.node.CreatePolicyStmt);
    for (const role of Array.isArray(policy?.roles) ? policy.roles : []) {
      add(roleSpecName(role));
    }
  }
}

async function ensureReferencedRoles(admin: Client, models: SchemaModel[]): Promise<void> {
  for (const role of await collectReferencedRoles(models)) {
    await admin.query(
      `DO $supaschema$\nBEGIN\n  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = ${quoteRoleLiteral(role)}) THEN\n    CREATE ROLE ${quoteIdent(role)} NOLOGIN;\n  END IF;\nEND\n$supaschema$`
    );
  }
}

async function stubObjectKeys(config: SupaschemaConfig): Promise<Set<string>> {
  const stubKeys = new Set<string>();
  const stubs = await extractObjectsFromSql(supabaseEnvironmentStubSql, { config });
  for (const object of stubs.objects) {
    stubKeys.add(object.key);
  }
  return stubKeys;
}

function reconvergenceResidualDiagnostic(
  operations: MigrationOperation[],
  stubKeys: Set<string>
): Diagnostic | undefined {
  const residualOperations = operations.filter((operation) => !stubKeys.has(operation.key));
  if (residualOperations.length === 0) {
    return;
  }
  const residual = residualOperations
    .slice(0, 6)
    .map((operation) => `${operation.kind} ${operation.key}`)
    .join(", ");
  return diagnostic(
    "SUPA_VERIFY_RECONVERGENCE",
    "error",
    `${residualOperations.length} operation(s) remain between the migrated catalog and the target model; the diff would never converge to empty`,
    {
      hint: `residual: ${residual}. The target model declares state the catalog cannot reproduce (or vice versa); fix the model or the engine's lane parity.`,
    }
  );
}

function quoteRoleLiteral(role: string): string {
  return `'${role.replaceAll("'", "''")}'`;
}

const mismatchSampleLimit = 12;

function fingerprintMismatchHint(migration: SchemaModel, target: SchemaModel): string {
  const appliedHashes = new Map(migration.objects.map((object) => [object.key, object.hash]));
  const targetHashes = new Map(target.objects.map((object) => [object.key, object.hash]));
  const missing: string[] = [];
  const changed: string[] = [];
  for (const [key, hash] of targetHashes) {
    const applied = appliedHashes.get(key);
    if (applied === undefined) {
      missing.push(key);
    } else if (applied !== hash) {
      changed.push(key);
    }
  }
  const unexpected = [...appliedHashes.keys()].filter((key) => !targetHashes.has(key));
  const parts: string[] = [];
  for (const [label, keys] of [
    ["missing from migration result", missing],
    ["not present in target", unexpected],
    ["definition differs", changed],
  ] as const) {
    if (keys.length === 0) {
      continue;
    }
    const sorted = [...keys].sort((left, right) => left.localeCompare(right));
    const sample = sorted.slice(0, mismatchSampleLimit).join(", ");
    const suffix =
      sorted.length > mismatchSampleLimit ? ` (+${sorted.length - mismatchSampleLimit} more)` : "";
    parts.push(`${label}: ${sample}${suffix}`);
  }
  return parts.join("; ") || `migration=${migration.fingerprint} target=${target.fingerprint}`;
}

async function applyModel(databaseUrl: string, model: SchemaModel): Promise<void> {
  const sql = model.objects
    .sort((left, right) => left.ordinal - right.ordinal)
    .map((object) => object.sql)
    .join(";\n");
  await applySql(databaseUrl, sql, "per-statement");
}
/**
 * "per-migration" wraps the whole file in one transaction to mirror runners
 * like `supabase db push`; statement-by-statement autocommit would mask
 * transactional failures such as using an enum value added in the same file
 * or CREATE INDEX CONCURRENTLY inside a transaction block.
 */
async function applySql(
  databaseUrl: string,
  sql: string,
  mode: "per-migration" | "per-statement"
): Promise<void> {
  if (mode === "per-migration") {
    await applyMigrationSql(databaseUrl, sql);
    return;
  }
  await applyPerStatementSql(databaseUrl, sql);
}
function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function managedSchemaReferenced(message: string, managedSchemas: string[]): string | undefined {
  const lower = message.toLowerCase();
  for (const schema of managedSchemas) {
    if (lower.includes(`${schema.toLowerCase()}.`)) {
      return schema;
    }
  }
  return;
}
