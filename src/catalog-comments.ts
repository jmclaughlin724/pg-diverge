import type { SchemaObject } from "./core.js";
import { sha256 } from "./hash.js";
import { formatQualifiedName, quoteIdent } from "./sql/identifiers.js";
import { makeObject } from "./sql/statements.js";

type CatalogQuery = {
  query: <Row extends Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: Row[] }>;
};

const managedSchemaFilter = `
  n.nspname !~ '^pg_'
  and n.nspname <> 'information_schema'
`;

const relationCommentWords = new Map([
  ["S", "sequence"],
  ["i", "index"],
  ["m", "materialized view"],
  ["p", "table"],
  ["r", "table"],
  ["v", "view"],
]);

export async function collectComments(pool: CatalogQuery): Promise<SchemaObject[]> {
  const sections = await Promise.all([
    collectRelationComments(pool),
    collectFunctionComments(pool),
    collectSchemaComments(pool),
    collectTypeComments(pool),
    collectPolicyComments(pool),
    collectTriggerComments(pool),
    collectConstraintComments(pool),
    collectExtensionComments(pool),
  ]);
  return sections.flat();
}

async function collectRelationComments(pool: CatalogQuery): Promise<SchemaObject[]> {
  const objects: SchemaObject[] = [];
  const rows = await pool.query(`
    select n.nspname as schema, c.relname as name, c.relkind as relkind,
      d.objsubid as column_number, a.attname as column_name, d.description as description
    from pg_description d
    join pg_class c on c.oid = d.objoid
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_attribute a on a.attrelid = c.oid and a.attnum = d.objsubid and d.objsubid > 0
    where d.classoid = 'pg_class'::regclass and ${managedSchemaFilter}
    order by n.nspname, c.relname, d.objsubid
  `);
  for (const row of rows.rows) {
    const schema = text(row.schema);
    const name = text(row.name);
    const word = relationCommentWords.get(text(row.relkind));
    if (!word) {
      continue;
    }
    const isColumn = typeof row.column_number === "number" && row.column_number > 0;
    if (isColumn && !row.column_name) {
      continue;
    }
    const descriptor = isColumn
      ? `column ${schema}.${name}.${text(row.column_name)}`
      : `${word} ${schema}.${name}`;
    const targetSql = isColumn
      ? `COLUMN ${formatQualifiedName(schema, name)}.${quoteIdent(text(row.column_name))}`
      : `${word.toUpperCase()} ${formatQualifiedName(schema, name)}`;
    objects.push(commentObject(descriptor, targetSql, schema, text(row.description)));
  }
  return objects;
}

async function collectFunctionComments(pool: CatalogQuery): Promise<SchemaObject[]> {
  const rows = await pool.query(`
    select n.nspname as schema, p.proname as name,
      oidvectortypes(p.proargtypes) as args, d.description as description
    from pg_description d
    join pg_proc p on p.oid = d.objoid
    join pg_namespace n on n.oid = p.pronamespace
    where d.classoid = 'pg_proc'::regclass and ${managedSchemaFilter}
    order by n.nspname, p.proname
  `);
  return rows.rows.map((row) => {
    const schema = text(row.schema);
    const name = text(row.name);
    const args = text(row.args);
    return commentObject(
      `function ${schema}.${name}(${args})`,
      `FUNCTION ${formatQualifiedName(schema, name)}(${args})`,
      schema,
      text(row.description),
    );
  });
}

async function collectSchemaComments(pool: CatalogQuery): Promise<SchemaObject[]> {
  const rows = await pool.query(`
    select n.nspname as name, d.description as description
    from pg_description d
    join pg_namespace n on n.oid = d.objoid
    where d.classoid = 'pg_namespace'::regclass
      and ${managedSchemaFilter}
      and n.nspname <> 'public'
    order by n.nspname
  `);
  return rows.rows.map((row) => {
    const name = text(row.name);
    return commentObject(`schema ${name}`, `SCHEMA ${name}`, undefined, text(row.description));
  });
}

async function collectTypeComments(pool: CatalogQuery): Promise<SchemaObject[]> {
  const rows = await pool.query(`
    select n.nspname as schema, t.typname as name, t.typtype as typtype,
      d.description as description
    from pg_description d
    join pg_type t on t.oid = d.objoid
    join pg_namespace n on n.oid = t.typnamespace
    where d.classoid = 'pg_type'::regclass and ${managedSchemaFilter}
    order by n.nspname, t.typname
  `);
  return rows.rows.map((row) => {
    const schema = text(row.schema);
    const name = text(row.name);
    const word = text(row.typtype) === "d" ? "domain" : "type";
    return commentObject(
      `${word} ${schema}.${name}`,
      `${word.toUpperCase()} ${formatQualifiedName(schema, name)}`,
      schema,
      text(row.description),
    );
  });
}

async function collectPolicyComments(pool: CatalogQuery): Promise<SchemaObject[]> {
  const rows = await pool.query(`
    select n.nspname as schema, c.relname as table_name, p.polname as name,
      d.description as description
    from pg_description d
    join pg_policy p on p.oid = d.objoid
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where d.classoid = 'pg_policy'::regclass and ${managedSchemaFilter}
    order by n.nspname, c.relname, p.polname
  `);
  return rows.rows.map((row) => {
    const schema = text(row.schema);
    const table = text(row.table_name);
    const name = text(row.name);
    return commentObject(
      `policy ${schema}.${table}.${name}`,
      `POLICY ${quoteIdent(name)} ON ${formatQualifiedName(schema, table)}`,
      schema,
      text(row.description),
    );
  });
}

async function collectTriggerComments(pool: CatalogQuery): Promise<SchemaObject[]> {
  const rows = await pool.query(`
    select n.nspname as schema, c.relname as table_name, t.tgname as name,
      d.description as description
    from pg_description d
    join pg_trigger t on t.oid = d.objoid
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where d.classoid = 'pg_trigger'::regclass
      and not t.tgisinternal
      and ${managedSchemaFilter}
    order by n.nspname, c.relname, t.tgname
  `);
  return rows.rows.map((row) => {
    const schema = text(row.schema);
    const table = text(row.table_name);
    const name = text(row.name);
    return commentObject(
      `trigger ${schema}.${table}.${name}`,
      `TRIGGER ${quoteIdent(name)} ON ${formatQualifiedName(schema, table)}`,
      schema,
      text(row.description),
    );
  });
}

async function collectConstraintComments(pool: CatalogQuery): Promise<SchemaObject[]> {
  const rows = await pool.query(`
    select n.nspname as schema, r.relname as table_name, c.conname as name,
      d.description as description
    from pg_description d
    join pg_constraint c on c.oid = d.objoid
    join pg_class r on r.oid = c.conrelid
    join pg_namespace n on n.oid = r.relnamespace
    where d.classoid = 'pg_constraint'::regclass and ${managedSchemaFilter}
    order by n.nspname, r.relname, c.conname
  `);
  return rows.rows.map((row) => {
    const schema = text(row.schema);
    const table = text(row.table_name);
    const name = text(row.name);
    return commentObject(
      `constraint ${schema}.${table}.${name}`,
      `CONSTRAINT ${quoteIdent(name)} ON ${formatQualifiedName(schema, table)}`,
      schema,
      text(row.description),
    );
  });
}

async function collectExtensionComments(pool: CatalogQuery): Promise<SchemaObject[]> {
  const rows = await pool.query(`
    select e.extname as name, d.description as description
    from pg_description d
    join pg_extension e on e.oid = d.objoid
    where d.classoid = 'pg_extension'::regclass
      and e.extname <> 'plpgsql'
    order by e.extname
  `);
  return rows.rows.map((row) => {
    const name = text(row.name);
    return commentObject(
      `extension ${name}`,
      `EXTENSION ${quoteIdent(name)}`,
      undefined,
      text(row.description),
    );
  });
}

function commentObject(
  descriptor: string,
  targetSql: string,
  schema: string | undefined,
  description: string,
): SchemaObject {
  const sql = `COMMENT ON ${targetSql} IS '${description.replaceAll("'", "''")}'`;
  const ref: { kind: "comment"; name: string; schema?: string } = {
    kind: "comment",
    name: sha256(descriptor).slice(0, 16),
  };
  if (schema) {
    ref.schema = schema;
  }
  return makeObject(ref, sql, 0, undefined, { descriptor });
}

function text(value: unknown): string {
  return typeof value === "string" ? value : String(value);
}
