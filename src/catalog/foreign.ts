import type { SchemaObject } from "../core.js";
import { formatQualifiedName, quoteIdent } from "../sql/identifiers.js";
import { makeObject } from "../sql/statements.js";
import { type CatalogQuery, text } from "./query.js";

export async function collectForeignObjects(pool: CatalogQuery): Promise<SchemaObject[]> {
  const objects: SchemaObject[] = [];
  const wrappers = await pool.query<Record<string, unknown>>(`
    select w.fdwname as name,
           w.fdwhandler::regproc::text as handler,
           w.fdwvalidator::regproc::text as validator,
           w.fdwoptions as options
    from pg_foreign_data_wrapper w
    where not exists (
      select 1 from pg_depend d where d.objid = w.oid and d.deptype = 'e'
    )
    order by w.fdwname
  `);
  for (const row of wrappers.rows) {
    objects.push(foreignDataWrapperObject(row));
  }
  const servers = await pool.query<Record<string, unknown>>(`
    select s.srvname as name, w.fdwname as wrapper, s.srvtype as server_type,
           s.srvversion as server_version, s.srvoptions as options
    from pg_foreign_server s
    join pg_foreign_data_wrapper w on w.oid = s.srvfdw
    order by s.srvname
  `);
  for (const row of servers.rows) {
    objects.push(foreignServerObject(row));
  }
  const tables = await pool.query<Record<string, unknown>>(`
    select n.nspname as schema, c.relname as name, s.srvname as server, ft.ftoptions as options,
           array(
             select format('%I %s', a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod))
             from pg_attribute a
             where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
             order by a.attnum
           ) as columns
    from pg_foreign_table ft
    join pg_class c on c.oid = ft.ftrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_foreign_server s on s.oid = ft.ftserver
    where n.nspname !~ '^pg_' and n.nspname <> 'information_schema'
    order by n.nspname, c.relname
  `);
  for (const row of tables.rows) {
    objects.push(foreignTableObject(row));
  }
  return objects;
}

function foreignDataWrapperObject(row: Record<string, unknown>): SchemaObject {
  const name = text(row.name);
  const clauses = [`CREATE FOREIGN DATA WRAPPER ${quoteIdent(name)}`];
  if (row.handler && text(row.handler) !== "-") {
    clauses.push(`HANDLER ${text(row.handler)}`);
  }
  if (row.validator && text(row.validator) !== "-") {
    clauses.push(`VALIDATOR ${text(row.validator)}`);
  }
  pushOptionsClause(clauses, row.options);
  return makeObject({ kind: "foreign-data-wrapper", name }, clauses.join(" "), 0);
}

function foreignServerObject(row: Record<string, unknown>): SchemaObject {
  const name = text(row.name);
  const clauses = [`CREATE SERVER ${quoteIdent(name)}`];
  if (row.server_type) {
    clauses.push(`TYPE '${escapeLiteral(text(row.server_type))}'`);
  }
  if (row.server_version) {
    clauses.push(`VERSION '${escapeLiteral(text(row.server_version))}'`);
  }
  clauses.push(`FOREIGN DATA WRAPPER ${quoteIdent(text(row.wrapper))}`);
  pushOptionsClause(clauses, row.options);
  return makeObject({ kind: "foreign-server", name }, clauses.join(" "), 0);
}

function foreignTableObject(row: Record<string, unknown>): SchemaObject {
  const schema = text(row.schema);
  const name = text(row.name);
  const columns = Array.isArray(row.columns) ? row.columns.map((item) => `  ${text(item)}`) : [];
  const clauses = [
    `CREATE FOREIGN TABLE ${formatQualifiedName(schema, name)} (\n${columns.join(",\n")}\n)`,
    `SERVER ${quoteIdent(text(row.server))}`,
  ];
  pushOptionsClause(clauses, row.options);
  return makeObject({ kind: "foreign-table", name, schema }, clauses.join(" "), 0, undefined, {
    server: text(row.server),
  });
}

function pushOptionsClause(clauses: string[], value: unknown): void {
  const options = optionsClause(value);
  if (options) {
    clauses.push(options);
  }
}

function optionsClause(value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return;
  }
  const rendered: string[] = [];
  for (const item of value) {
    const raw = text(item);
    const separator = raw.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const key = raw.slice(0, separator);
    const optionValue = raw.slice(separator + 1);
    rendered.push(`${quoteIdent(key)} '${escapeLiteral(optionValue)}'`);
  }
  return rendered.length > 0 ? `OPTIONS (${rendered.join(", ")})` : undefined;
}

function escapeLiteral(value: string): string {
  return value.replaceAll("'", "''");
}
