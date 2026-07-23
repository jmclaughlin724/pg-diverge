import { formatQualifiedName, quoteIdent } from "../sql/identifiers.js";
import { makeObject } from "../sql/statements.js";
import type { SchemaObject } from "../types.js";
import { type CatalogQuery, managedSchemaFilter, notExtensionMember, text } from "./query.js";

const sequenceTypeMax = new Map([
  ["bigint", "9223372036854775807"],
  ["integer", "2147483647"],
  ["smallint", "32767"],
]);

export async function collectSequences(pool: CatalogQuery): Promise<SchemaObject[]> {
  const objects: SchemaObject[] = [];
  const sequences = await pool.query(`
    select n.nspname as schema, c.relname as name,
      format_type(s.seqtypid, null) as data_type,
      s.seqstart::text as start_value,
      s.seqincrement::text as increment_by,
      s.seqmin::text as min_value,
      s.seqmax::text as max_value,
      s.seqcache::text as cache_size,
      s.seqcycle as cycle,
      dn.nspname as owned_schema, dc.relname as owned_table, a.attname as owned_column
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_sequence s on s.seqrelid = c.oid
    left join pg_depend d
      on d.objid = c.oid and d.classid = 'pg_class'::regclass and d.deptype = 'a'
    left join pg_class dc on dc.oid = d.refobjid
    left join pg_namespace dn on dn.oid = dc.relnamespace
    left join pg_attribute a on a.attrelid = d.refobjid and a.attnum = d.refobjsubid
    where c.relkind = 'S'
      and ${managedSchemaFilter}
      and ${notExtensionMember("c", "pg_class")}
      and ${notExtensionMember("dc", "pg_class")}
      and not exists (
        select 1 from pg_depend i
        where i.objid = c.oid and i.classid = 'pg_class'::regclass and i.deptype = 'i'
      )
    order by n.nspname, c.relname
  `);
  for (const row of sequences.rows) {
    const schema = text(row.schema);
    const name = text(row.name);
    const ownedBy =
      row.owned_table && row.owned_column
        ? `${text(row.owned_schema)}.${text(row.owned_table)}.${text(row.owned_column)}`
        : undefined;
    const clauses = [`CREATE SEQUENCE ${formatQualifiedName(schema, name)}`];
    const dataType = text(row.data_type);
    if (dataType !== "bigint") {
      clauses.push(`AS ${dataType}`);
    }
    const optionalClauses: [string, string, string][] = [
      ["INCREMENT BY", text(row.increment_by), "1"],
      ["MINVALUE", text(row.min_value), "1"],
      ["MAXVALUE", text(row.max_value), sequenceTypeMax.get(dataType) ?? ""],
      ["START WITH", text(row.start_value), "1"],
      ["CACHE", text(row.cache_size), "1"],
    ];
    for (const [keyword, value, fallback] of optionalClauses) {
      if (value !== fallback) {
        clauses.push(`${keyword} ${value}`);
      }
    }
    if (row.cycle === true) {
      clauses.push("CYCLE");
    }
    if (ownedBy) {
      clauses.push(
        `OWNED BY ${formatQualifiedName(text(row.owned_schema), text(row.owned_table))}.${quoteIdent(text(row.owned_column))}`
      );
    }
    objects.push(
      makeObject(
        { kind: "sequence", name, schema },
        clauses.join(" "),
        0,
        undefined,
        ownedBy ? { ownedBy } : {}
      )
    );
  }
  return objects;
}
