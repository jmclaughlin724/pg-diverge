import { formatQualifiedName } from "../sql/identifiers.js";
import { makeObject } from "../sql/statements.js";
import type { SchemaObject } from "../types.js";
import {
  type CatalogQuery,
  catalogSchemaFilter,
  notExtensionMember,
  notExtensionMemberOid,
  text,
  textArray,
} from "./query.js";

export async function collectTypes(pool: CatalogQuery): Promise<SchemaObject[]> {
  const objects: SchemaObject[] = [];
  const enums = await pool.query(`
    select n.nspname as schema, t.typname as name,
      array_agg(e.enumlabel order by e.enumsortorder) as values
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    join pg_enum e on e.enumtypid = t.oid
    where t.typtype = 'e'
      and ${catalogSchemaFilter(pool)}
      and ${notExtensionMember("t", "pg_type")}
    group by n.nspname, t.typname
    order by n.nspname, t.typname
  `);
  for (const row of enums.rows) {
    const schema = text(row.schema);
    const name = text(row.name);
    const values = textArray(row.values);
    const rendered = values.map((value) => `'${value.replaceAll("'", "''")}'`).join(", ");
    objects.push(
      makeObject(
        { kind: "enum", name, schema },
        `CREATE TYPE ${formatQualifiedName(schema, name)} AS ENUM (${rendered})`,
        0,
        undefined,
        { values }
      )
    );
  }
  const domains = await pool.query(`
    select n.nspname as schema, t.typname as name,
      format_type(t.typbasetype, t.typtypmod) as base,
      t.typnotnull as not_null,
      coalesce(
        (select string_agg(pg_get_constraintdef(c.oid, true), ' ' order by c.conname)
         from pg_constraint c where c.contypid = t.oid and c.contype = 'c'),
        ''
      ) as constraints
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typtype = 'd'
      and ${catalogSchemaFilter(pool)}
      and ${notExtensionMember("t", "pg_type")}
    order by n.nspname, t.typname
  `);
  for (const row of domains.rows) {
    const schema = text(row.schema);
    const name = text(row.name);
    const parts = [`CREATE DOMAIN ${formatQualifiedName(schema, name)} AS ${text(row.base)}`];
    if (row.not_null === true) {
      parts.push("NOT NULL");
    }
    const constraints = text(row.constraints);
    if (constraints.length > 0) {
      parts.push(constraints);
    }
    objects.push(makeObject({ kind: "domain", name, schema }, parts.join(" "), 0));
  }
  const composites = await pool.query(`
    select n.nspname as schema, c.relname as name,
      string_agg(
        quote_ident(a.attname) || ' ' || format_type(a.atttypid, a.atttypmod),
        ', ' order by a.attnum
      ) as columns,
      coalesce(
        array_remove(
          array_agg(distinct dep_n.nspname || '.' || dep_t.typname)
          filter (
            where dep_t.typtype in ('c', 'd', 'e')
              and dep_t.oid <> c.reltype
              and left(dep_n.nspname, 3) <> 'pg_'
              and dep_n.nspname <> 'information_schema'
              and ${notExtensionMember("dep_t", "pg_type")}
          ),
          null
        ),
        array[]::text[]
      ) as dependencies
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    join pg_type raw_t on raw_t.oid = a.atttypid
    join pg_type dep_t on dep_t.oid = coalesce(nullif(raw_t.typelem, 0), raw_t.oid)
    join pg_namespace dep_n on dep_n.oid = dep_t.typnamespace
    where c.relkind = 'c'
      and ${catalogSchemaFilter(pool)}
      and ${notExtensionMember("c", "pg_class")}
      and ${notExtensionMemberOid("pg_type", "c.reltype")}
    group by n.nspname, c.relname
    order by n.nspname, c.relname
  `);
  for (const row of composites.rows) {
    const schema = text(row.schema);
    const name = text(row.name);
    const object = makeObject(
      { kind: "type", name, schema },
      `CREATE TYPE ${formatQualifiedName(schema, name)} AS (${text(row.columns)})`,
      0
    );
    object.dependencies = textArray(row.dependencies).sort((left, right) =>
      left.localeCompare(right)
    );
    objects.push(object);
  }
  return objects;
}
