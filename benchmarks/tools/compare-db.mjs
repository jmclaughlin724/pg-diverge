import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "../..");
const { quoteIdent } = await import(join(packageRoot, "dist/sql/identifiers.js"));
const dbAdmin = await import(join(packageRoot, "dist/db-admin.js"));

export const {
  applyMigrationSql,
  applySql,
  assertLocalDatabaseUrl,
  databaseUrlWithDatabase,
  dropTemporaryDatabases,
} = dbAdmin;

export function createTemporaryDatabases(adminUrl, count, templateName) {
  return dbAdmin.createTemporaryDatabases(adminUrl, count, {
    purpose: "compare",
    ...(templateName ? { templateName } : {}),
  });
}

export function catalogFingerprint(url) {
  return dbAdmin.catalogFingerprint(url, "bench:catalog");
}

// The Supabase CLI's diff engines silently omit objects owned by
// supabase_admin (empty diff, exit 0). After seeding as the admin (which
// extension creation requires), hand every user-schema object to `role` so
// the engines can see them.
export async function transferOwnership(url, role) {
  const client = new Client({ connectionString: url });
  const owner = quoteIdent(role);
  try {
    await client.connect();
    const schemas = await client.query(
      "select nspname from pg_namespace where nspname !~ '^pg_' and nspname not in ('information_schema', 'extensions', 'vault') order by nspname"
    );
    for (const { nspname } of schemas.rows) {
      await client.query(`ALTER SCHEMA ${quoteIdent(nspname)} OWNER TO ${owner}`);
    }
    const relations = await client.query(`
      select n.nspname, c.relname, c.relkind
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname !~ '^pg_' and n.nspname not in ('information_schema', 'extensions', 'vault')
        and c.relkind in ('r', 'p', 'S', 'v', 'm', 'f')
        and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype in ('e', 'i'))
      order by n.nspname, c.relname
    `);
    const relationKinds = new Map([
      ["S", "SEQUENCE"],
      ["f", "FOREIGN TABLE"],
      ["m", "MATERIALIZED VIEW"],
      ["p", "TABLE"],
      ["r", "TABLE"],
      ["v", "VIEW"],
    ]);
    for (const row of relations.rows) {
      const kind = relationKinds.get(row.relkind);
      await client.query(
        `ALTER ${kind} ${quoteIdent(row.nspname)}.${quoteIdent(row.relname)} OWNER TO ${owner}`
      );
    }
    const routines = await client.query(`
      select n.nspname, p.proname, p.prokind,
             pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname !~ '^pg_' and n.nspname not in ('information_schema', 'extensions', 'vault')
        and p.prokind in ('f', 'p')
        and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype in ('e', 'i'))
      order by n.nspname, p.proname
    `);
    for (const row of routines.rows) {
      const kind = row.prokind === "p" ? "PROCEDURE" : "FUNCTION";
      await client.query(
        `ALTER ${kind} ${quoteIdent(row.nspname)}.${quoteIdent(row.proname)}(${row.args}) OWNER TO ${owner}`
      );
    }
    const types = await client.query(`
      select n.nspname, t.typname, t.typtype
      from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
      where n.nspname !~ '^pg_' and n.nspname not in ('information_schema', 'extensions', 'vault')
        and t.typtype in ('e', 'd')
        and not exists (select 1 from pg_depend d where d.objid = t.oid and d.deptype in ('e', 'i'))
      order by n.nspname, t.typname
    `);
    for (const row of types.rows) {
      const kind = row.typtype === "d" ? "DOMAIN" : "TYPE";
      await client.query(
        `ALTER ${kind} ${quoteIdent(row.nspname)}.${quoteIdent(row.typname)} OWNER TO ${owner}`
      );
    }
  } finally {
    await client.end().catch(() => undefined);
  }
}
