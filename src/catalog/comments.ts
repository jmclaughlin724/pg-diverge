import { formatQualifiedName, quoteIdent } from "../sql/identifiers.js";
import { buildCommentObject, isInitdbDefaultComment } from "../sql/privileges.js";
import type { CommentTarget, SchemaObject } from "../types.js";
import { type CatalogQuery, catalogSchemaFilter, notExtensionMember, text } from "./query.js";

const relationCommentKinds = new Map<string, CommentTarget["kind"]>([
  ["S", "sequence"],
  ["f", "foreign-table"],
  ["i", "index"],
  ["m", "materialized-view"],
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
    where d.classoid = 'pg_class'::regclass
      and ${catalogSchemaFilter(pool)}
      and ${notExtensionMember("c", "pg_class")}
    order by n.nspname, c.relname, d.objsubid
  `);
  for (const row of rows.rows) {
    const schema = text(row.schema);
    const name = text(row.name);
    const kind = relationCommentKinds.get(text(row.relkind));
    if (!kind) {
      continue;
    }
    const isColumn = typeof row.column_number === "number" && row.column_number > 0;
    if (isColumn && !row.column_name) {
      continue;
    }
    const target: CommentTarget = isColumn
      ? {
          kind: "column",
          name: text(row.column_name),
          schema,
          table: name,
        }
      : { kind, name, schema };
    const label = kind.replaceAll("-", " ");
    const targetSql = isColumn
      ? `COLUMN ${formatQualifiedName(schema, name)}.${quoteIdent(text(row.column_name))}`
      : `${label.toUpperCase()} ${formatQualifiedName(schema, name)}`;
    objects.push(commentObject(target, targetSql, text(row.description)));
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
    where d.classoid = 'pg_proc'::regclass
      and ${catalogSchemaFilter(pool)}
      and ${notExtensionMember("p", "pg_proc")}
    order by n.nspname, p.proname
  `);
  return rows.rows.map((row) => {
    const schema = text(row.schema);
    const name = text(row.name);
    const args = text(row.args);
    return commentObject(
      { kind: "function", name, schema, signature: args },
      `FUNCTION ${formatQualifiedName(schema, name)}(${args})`,
      text(row.description)
    );
  });
}

async function collectSchemaComments(pool: CatalogQuery): Promise<SchemaObject[]> {
  const rows = await pool.query(`
    select n.nspname as name, d.description as description
    from pg_description d
    join pg_namespace n on n.oid = d.objoid
    where d.classoid = 'pg_namespace'::regclass
      and ${catalogSchemaFilter(pool)}
    order by n.nspname
  `);
  const objects: SchemaObject[] = [];
  for (const row of rows.rows) {
    const name = text(row.name);
    const description = text(row.description);
    if (isInitdbDefaultComment(`schema ${name}`, description)) {
      continue;
    }
    objects.push(commentObject({ kind: "schema", name }, `SCHEMA ${name}`, description));
  }
  return objects;
}

async function collectTypeComments(pool: CatalogQuery): Promise<SchemaObject[]> {
  const rows = await pool.query(`
    select n.nspname as schema, t.typname as name, t.typtype as typtype,
      d.description as description
    from pg_description d
    join pg_type t on t.oid = d.objoid
    join pg_namespace n on n.oid = t.typnamespace
    where d.classoid = 'pg_type'::regclass
      and ${catalogSchemaFilter(pool)}
      and ${notExtensionMember("t", "pg_type")}
    order by n.nspname, t.typname
  `);
  return rows.rows.map((row) => {
    const schema = text(row.schema);
    const name = text(row.name);
    const kind = text(row.typtype) === "d" ? "domain" : "type";
    return commentObject(
      { kind, name, schema },
      `${kind.toUpperCase()} ${formatQualifiedName(schema, name)}`,
      text(row.description)
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
    where d.classoid = 'pg_policy'::regclass
      and ${catalogSchemaFilter(pool)}
      and ${notExtensionMember("c", "pg_class")}
    order by n.nspname, c.relname, p.polname
  `);
  return rows.rows.map((row) => {
    const schema = text(row.schema);
    const table = text(row.table_name);
    const name = text(row.name);
    return commentObject(
      { kind: "policy", name, schema, table },
      `POLICY ${quoteIdent(name)} ON ${formatQualifiedName(schema, table)}`,
      text(row.description)
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
      and ${catalogSchemaFilter(pool)}
      and ${notExtensionMember("c", "pg_class")}
    order by n.nspname, c.relname, t.tgname
  `);
  return rows.rows.map((row) => {
    const schema = text(row.schema);
    const table = text(row.table_name);
    const name = text(row.name);
    return commentObject(
      { kind: "trigger", name, schema, table },
      `TRIGGER ${quoteIdent(name)} ON ${formatQualifiedName(schema, table)}`,
      text(row.description)
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
    where d.classoid = 'pg_constraint'::regclass
      and ${catalogSchemaFilter(pool)}
      and ${notExtensionMember("r", "pg_class")}
    order by n.nspname, r.relname, c.conname
  `);
  return rows.rows.map((row) => {
    const schema = text(row.schema);
    const table = text(row.table_name);
    const name = text(row.name);
    return commentObject(
      { kind: "constraint", name, schema, table },
      `CONSTRAINT ${quoteIdent(name)} ON ${formatQualifiedName(schema, table)}`,
      text(row.description)
    );
  });
}

async function collectExtensionComments(pool: CatalogQuery): Promise<SchemaObject[]> {
  const rows = await pool.query(`
    select e.extname as name, n.nspname as schema, d.description as description
    from pg_description d
    join pg_extension e on e.oid = d.objoid
    join pg_namespace n on n.oid = e.extnamespace
    where d.classoid = 'pg_extension'::regclass
      and e.extname <> 'plpgsql'
      and ${catalogSchemaFilter(pool)}
    order by e.extname
  `);
  return rows.rows.map((row) => {
    const name = text(row.name);
    const object = commentObject(
      { kind: "extension", name },
      `EXTENSION ${quoteIdent(name)}`,
      text(row.description)
    );
    object.metadata.schema = text(row.schema);
    return object;
  });
}

function commentObject(
  target: CommentTarget,
  targetSql: string,
  description: string
): SchemaObject {
  const sql = `COMMENT ON ${targetSql} IS '${description.replaceAll("'", "''")}'`;
  return buildCommentObject({ description, ordinal: 0, sql, target });
}
