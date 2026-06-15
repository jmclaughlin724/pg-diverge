import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { extractCatalogModel } from "./catalog.js";
import { checkMigrationSql } from "./check.js";
import { resolveConfig } from "./config.js";
import type { Diagnostic, ExtractOptions, SchemaModel, VerifyMigrationOptions } from "./core.js";
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
  try {
    assertLocalDatabaseUrl(options.databaseUrl, "SUPASCHEMA_VERIFY_ALLOW_REMOTE");
  } catch (error) {
    return [
      diagnostic("SUPA_VERIFY_FAILED", "error", errorMessage(error), {
        hint: "verify creates and drops databases; non-local hosts require SUPASCHEMA_VERIFY_ALLOW_REMOTE=1.",
      }),
    ];
  }
  const migrationSql = await readFile(options.migrationPath, "utf8");
  const extractOptions: ExtractOptions = {};
  if (options.config !== undefined) {
    extractOptions.config = options.config;
  }
  if (options.cwd !== undefined) {
    extractOptions.cwd = options.cwd;
  }
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
    await admin.connect();
    const capability = await preflightCapability(admin);
    if (capability) {
      diagnostics.push(capability);
      await admin.end().catch(() => undefined);
      return diagnostics;
    }
    for (const databaseName of [migrationDb, targetDb]) {
      await createDatabaseWithRetry(admin, `CREATE DATABASE ${quoteIdent(databaseName)}`);
      created.push(databaseName);
    }
    const migrationUrl = databaseUrlWithDatabase(options.databaseUrl, migrationDb);
    const targetUrl = databaseUrlWithDatabase(options.databaseUrl, targetDb);
    if (options.ensureRoles === true) {
      for (const role of await collectReferencedRoles([from, to])) {
        await admin.query(
          `DO $supaschema$\nBEGIN\n  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = ${quoteRoleLiteral(role)}) THEN\n    CREATE ROLE ${quoteIdent(role)} NOLOGIN;\n  END IF;\nEND\n$supaschema$`,
        );
      }
    }
    if (environmentEnsured) {
      // Stubs land in both databases, so catalog parity is unaffected.
      await applySql(migrationUrl, supabaseEnvironmentStubSql, "per-statement");
      await applySql(targetUrl, supabaseEnvironmentStubSql, "per-statement");
    }
    await applyModel(migrationUrl, from);
    await applySql(migrationUrl, migrationSql, config.transactionMode);
    await applySql(migrationUrl, migrationSql, config.transactionMode);
    await applyModel(targetUrl, to);
    const afterMigration = await extractCatalogModel({
      databaseUrl: migrationUrl,
      source: "verify:migration",
    });
    const expectedTarget = await extractCatalogModel({
      databaseUrl: targetUrl,
      source: "verify:target",
    });
    diagnostics.push(...afterMigration.diagnostics, ...expectedTarget.diagnostics);
    if (afterMigration.fingerprint !== expectedTarget.fingerprint) {
      diagnostics.push(
        diagnostic(
          "SUPA_VERIFY_FINGERPRINT_MISMATCH",
          "error",
          "migration result catalog fingerprint does not match target catalog fingerprint",
          {
            hint: fingerprintMismatchHint(afterMigration, expectedTarget),
          },
        ),
      );
    }
    // Reconvergence: the fingerprint check compares two databases built from
    // the same models, so a modeling error symmetric in the models passes it.
    // Cross-lane diffing the migrated catalog against the target *model*
    // requires the diff itself to converge to zero — the detector for false
    // drift (catalog-invisible no-ops, built-in objects, spelling drift).
    const reconvergence = planSchemaDiff(afterMigration, to, {
      config: { ...config, hints: { destructive: ["*"], renames: [] } },
    });
    // Environment-pack stubs exist only in the temp databases; subtract their
    // object keys so they do not read as residual drift.
    const stubKeys = new Set<string>();
    if (environmentEnsured) {
      const stubs = await extractObjectsFromSql(supabaseEnvironmentStubSql, { config });
      for (const object of stubs.objects) {
        stubKeys.add(object.key);
      }
    }
    const residualOperations = reconvergence.operations.filter(
      (operation) => !stubKeys.has(operation.key),
    );
    if (residualOperations.length > 0) {
      const residual = residualOperations
        .slice(0, 6)
        .map((operation) => `${operation.kind} ${operation.key}`)
        .join(", ");
      diagnostics.push(
        diagnostic(
          "SUPA_VERIFY_RECONVERGENCE",
          "error",
          `${residualOperations.length} operation(s) remain between the migrated catalog and the target model; the diff would never converge to empty`,
          {
            hint: `residual: ${residual}. The target model declares state the catalog cannot reproduce (or vice versa); fix the model or the engine's lane parity.`,
          },
        ),
      );
    }
  } catch (error) {
    const message = errorMessage(error);
    diagnostics.push(
      diagnostic("SUPA_VERIFY_FAILED", "error", message, {
        hint: "Use a disposable PostgreSQL database URL whose role can CREATE DATABASE and DROP DATABASE.",
      }),
    );
    const stubbedSchema = environmentEnsured
      ? managedSchemaReferenced(message, config.managedSchemas)
      : undefined;
    if (stubbedSchema !== undefined) {
      diagnostics.push(
        diagnostic(
          "SUPA_VERIFY_STUB_REFERENCE",
          "warning",
          `verify failed while referencing the "${stubbedSchema}" managed schema, which --ensure-environment provisions only as a minimal stub`,
          {
            hint: `--ensure-environment stubs auth.users (the GoTrue column set), the auth.uid/role/jwt/email helpers, and the cron tables; other ${stubbedSchema} objects are absent. This may be a stub limitation rather than a real migration defect; confirm by applying the migration to a disposable database that provisions the managed surface. Use --no-ensure-environment only when the verification server itself provisions the managed surface in new databases.`,
          },
        ),
      );
    }
  } finally {
    if (options.keepDatabases === true && created.length > 0) {
      diagnostics.push(
        diagnostic(
          "SUPA_VERIFY_CLEANUP_FAILED",
          "warning",
          `kept temporary databases for inspection: ${created.join(", ")}`,
          { hint: "Drop them manually when done (--keep-databases was set)." },
        ),
      );
    } else {
      for (const databaseName of created.reverse()) {
        try {
          await admin.query(
            `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
            [databaseName],
          );
          await admin.query(`DROP DATABASE IF EXISTS ${quoteIdent(databaseName)} WITH (FORCE)`);
        } catch (cleanupError) {
          diagnostics.push(
            diagnostic("SUPA_VERIFY_CLEANUP_FAILED", "warning", errorMessage(cleanupError), {
              hint: `Temporary database ${databaseName} may need manual removal.`,
            }),
          );
        }
      }
    }
    await admin.end().catch(() => undefined);
  }
  return diagnostics;
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
      if (object.ref.kind === "grant" || object.ref.kind === "default-privilege") {
        add(object.metadata.grantee);
        add(object.metadata.forRole);
        continue;
      }
      if (object.ref.kind !== "policy") {
        continue;
      }
      const parsed = await parseSqlAst(object.sql);
      if (parsed.ast === undefined) {
        continue;
      }
      for (const statement of astStatements(parsed.ast, object.sql)) {
        const policy = asRecord(statement.node.CreatePolicyStmt);
        for (const role of Array.isArray(policy?.roles) ? policy.roles : []) {
          add(roleSpecName(role));
        }
      }
    }
  }
  return [...roles].sort((left, right) => left.localeCompare(right));
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
  mode: "per-migration" | "per-statement",
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
  return undefined;
}
