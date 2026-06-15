import { Client } from "pg";
import { extractCatalogModel } from "./catalog.js";
import { fingerprintObjects } from "./hash.js";
import { quoteIdent } from "./sql/identifiers.js";
import { splitSqlStatements } from "./sql/split.js";

const leadingSlashPattern = /^\//;

export interface CreateTemporaryDatabasesOptions {
  purpose?: string;
  templateName?: string;
}

export function tempDatabaseName(purpose: string, index = 0): string {
  const suffix = `${process.pid}_${Date.now()}_${index}_${Math.random().toString(16).slice(2)}`;
  return `supaschema_${purpose}_${suffix}`.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 60);
}

export function databaseUrlWithDatabase(databaseUrl: string, databaseName: string): string {
  const url = new URL(databaseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

/**
 * Concurrent CREATE DATABASE calls cloning the same template fail with
 * SQLSTATE 55006 ("source database is being accessed by other users");
 * parallel CI lanes and test workers hit this routinely, so creation
 * retries with backoff instead of failing on the first collision.
 */
export async function createDatabaseWithRetry(
  admin: Pick<Client, "query">,
  statement: string,
  attempts = 6
): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await admin.query(statement);
      return;
    } catch (error) {
      const busy =
        error instanceof Error && "code" in error && (error as { code?: string }).code === "55006";
      if (!busy || attempt >= attempts) {
        throw error;
      }
      process.stderr.write(
        `create database busy (template in use); retry ${attempt}/${attempts - 1}\n`
      );
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 200 * attempt));
    }
  }
}

export async function createTemporaryDatabases(
  adminUrl: string,
  count: number,
  options: CreateTemporaryDatabasesOptions = {}
): Promise<string[]> {
  const admin = new Client({ connectionString: adminUrl });
  const names: string[] = [];
  try {
    await admin.connect();
    for (let index = 0; index < count; index += 1) {
      const databaseName = tempDatabaseName(options.purpose ?? "temp", index);
      const templateClause = options.templateName
        ? ` TEMPLATE ${quoteIdent(options.templateName)}`
        : "";
      await createDatabaseWithRetry(
        admin,
        `CREATE DATABASE ${quoteIdent(databaseName)}${templateClause}`
      );
      names.push(databaseName);
    }
  } catch (error) {
    for (const databaseName of names.reverse()) {
      await admin
        .query(`DROP DATABASE IF EXISTS ${quoteIdent(databaseName)} WITH (FORCE)`)
        .catch(() => undefined);
    }
    throw error;
  } finally {
    await admin.end().catch(() => undefined);
  }
  return names.map((name) => databaseUrlWithDatabase(adminUrl, name));
}

export async function dropTemporaryDatabases(adminUrl: string, urls: string[]): Promise<void> {
  if (!adminUrl || urls.length === 0) {
    return;
  }
  const admin = new Client({ connectionString: adminUrl });
  try {
    await admin.connect();
    for (const url of [...urls].reverse()) {
      const databaseName = new URL(url).pathname.replace(leadingSlashPattern, "");
      await admin
        .query(
          "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
          [databaseName]
        )
        .catch(() => undefined);
      await admin
        .query(`DROP DATABASE IF EXISTS ${quoteIdent(databaseName)} WITH (FORCE)`)
        .catch(() => undefined);
    }
  } finally {
    await admin.end().catch(() => undefined);
  }
}

export async function withTemporaryDatabases<T>(
  adminUrl: string,
  count: number,
  callback: (databaseUrls: string[]) => Promise<T>,
  options: CreateTemporaryDatabasesOptions = {}
): Promise<T> {
  const urls = await createTemporaryDatabases(adminUrl, count, options);
  try {
    return await callback(urls);
  } finally {
    await dropTemporaryDatabases(adminUrl, urls);
  }
}

export function databasePair(databaseUrls: string[]): [string, string] {
  const [fromUrl, toUrl] = databaseUrls;
  if (!(fromUrl && toUrl)) {
    throw new Error("expected two temporary databases");
  }
  return [fromUrl, toUrl];
}

export async function applySql(databaseUrl: string, sql: string): Promise<void> {
  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    for (const statement of splitSqlStatements(sql)) {
      await client.query(statement);
    }
  } finally {
    await client.end().catch(() => undefined);
  }
}

// One transaction per migration mirrors runners like `supabase db push`;
// per-statement autocommit would mask transactional failures. An error
// leaves the transaction uncommitted and ending the connection aborts it.
export async function applyMigrationSql(databaseUrl: string, sql: string): Promise<void> {
  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    await client.query("BEGIN");
    for (const statement of splitSqlStatements(sql)) {
      await client.query(statement);
    }
    await client.query("COMMIT");
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function catalogFingerprint(databaseUrl: string, source = "catalog"): Promise<string> {
  const model = await extractCatalogModel({ databaseUrl, source });
  const errors = model.diagnostics.filter((item) => item.severity === "error");
  if (errors.length > 0) {
    throw new Error(errors.map((item) => item.message).join("; "));
  }
  return fingerprintObjects(model.objects);
}

export function assertLocalDatabaseUrl(
  value: string,
  allowRemoteEnv = "SUPASCHEMA_COMPARE_ALLOW_REMOTE"
): void {
  if (process.env[allowRemoteEnv] === "1") {
    return;
  }
  const host = new URL(value).hostname;
  const allowedHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  if (!allowedHosts.has(host)) {
    throw new Error(
      `Refusing to create/drop databases on non-local host "${host}". Set ${allowRemoteEnv}=1 to override.`
    );
  }
}
