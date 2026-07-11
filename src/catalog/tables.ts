import type { SchemaObject, TableColumn } from "../core.js";
import { formatQualifiedName, quoteIdent } from "../sql/identifiers.js";
import { makeObject } from "../sql/statements.js";
import { type CatalogQuery, managedSchemaFilter, notExtensionMember } from "./query.js";

export async function collectTables(pool: CatalogQuery): Promise<SchemaObject[]> {
  const tables = await pool.query<Record<string, unknown>>(`
    select
      c.oid::text as oid,
      n.nspname as schema,
      c.relname as name,
      c.relkind as relkind,
      c.relispartition as is_partition,
      pn.nspname as parent_schema,
      pc.relname as parent_name,
      pg_get_expr(c.relpartbound, c.oid, true) as partition_bound,
      pg_get_partkeydef(c.oid) as partition_key
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_inherits i on i.inhrelid = c.oid
    left join pg_class pc on pc.oid = i.inhparent
    left join pg_namespace pn on pn.oid = pc.relnamespace
    where c.relkind in ('r', 'p')
      and ${managedSchemaFilter}
      and ${notExtensionMember("c", "pg_class")}
    order by n.nspname, c.relname
  `);
  if (tables.rows.length === 0) {
    return [];
  }
  const oids = tables.rows.map((row) => stringValue(row.oid));
  const [columns, constraints] = await Promise.all([
    pool.query<Record<string, unknown>>(
      `
        select
          a.attrelid::text as oid,
          a.attname as name,
          format_type(a.atttypid, a.atttypmod) as type,
          a.attnotnull as not_null,
          a.attidentity as identity,
          a.attgenerated as generated,
          pg_get_expr(d.adbin, d.adrelid) as default_expression
        from pg_attribute a
        left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
        where a.attrelid = any($1::oid[])
          and a.attnum > 0
          and not a.attisdropped
        order by a.attrelid, a.attnum
      `,
      [oids]
    ),
    pool.query<Record<string, unknown>>(
      `
        select
          c.conrelid::text as oid,
          c.conname as name,
          c.contype,
          pg_get_constraintdef(c.oid, true) as definition,
          coalesce(array(
            select a.attname
            from unnest(c.conkey) with ordinality as key(attnum, position)
            join pg_attribute a on a.attrelid = c.conrelid and a.attnum = key.attnum
            order by key.position
          ), array[]::name[])::text[] as columns,
          coalesce(array(
            select distinct dependency_namespace.nspname || '.' || dependency_proc.proname
            from pg_depend dependency
            join pg_proc dependency_proc on dependency_proc.oid = dependency.refobjid
            join pg_namespace dependency_namespace on dependency_namespace.oid = dependency_proc.pronamespace
            where dependency.classid = 'pg_constraint'::regclass
              and dependency.objid = c.oid
              and dependency.refclassid = 'pg_proc'::regclass
            order by dependency_namespace.nspname || '.' || dependency_proc.proname
          ), array[]::text[]) as function_dependencies,
          referenced_namespace.nspname as referenced_schema,
          referenced_table.relname as referenced_table,
          coalesce(array(
            select a.attname
            from unnest(c.confkey) with ordinality as key(attnum, position)
            join pg_attribute a on a.attrelid = c.confrelid and a.attnum = key.attnum
            order by key.position
          ), array[]::name[])::text[] as referenced_columns
        from pg_constraint c
        left join pg_class referenced_table on referenced_table.oid = c.confrelid
        left join pg_namespace referenced_namespace on referenced_namespace.oid = referenced_table.relnamespace
        where c.conrelid = any($1::oid[])
          and c.contype in ('p', 'u', 'f', 'c', 'x')
        order by c.conrelid, c.conname
      `,
      [oids]
    ),
  ]);
  const columnsByOid = groupByOid(columns.rows);
  const constraintsByOid = groupByOid(constraints.rows);
  const objects: SchemaObject[] = [];
  for (const table of tables.rows) {
    const oid = stringValue(table.oid);
    const columnDefinitions = (columnsByOid.get(oid) ?? []).map(columnFromRow);
    const lines = columnDefinitions.map(
      (column) => `  ${quoteIdent(column.name)} ${column.definition}`
    );
    const schema = stringValue(table.schema);
    const name = stringValue(table.name);
    const createSql = `CREATE TABLE ${formatQualifiedName(schema, name)} (\n${lines.join(",\n")}\n)${partitionClause(table)}`;
    const attachSql = partitionAttachSql(table, schema, name);
    const sql = attachSql === undefined ? createSql : `${createSql};\n${attachSql}`;
    const tableObject = makeObject({ kind: "table", name, schema }, sql, 0, undefined, {
      columns: columnDefinitions,
      ...(attachSql === undefined ? {} : { partitionAttachSql: attachSql }),
    });
    if (typeof table.parent_schema === "string" && typeof table.parent_name === "string") {
      tableObject.dependencies.push(`${table.parent_schema}.${table.parent_name}`);
    }
    objects.push(tableObject);

    for (const constraint of constraintsByOid.get(oid) ?? []) {
      const constraintName = stringValue(constraint.name);
      const constraintObject = makeObject(
        { kind: "constraint", name: constraintName, schema, table: name },
        `ALTER TABLE ONLY ${formatQualifiedName(schema, name)} ADD CONSTRAINT ${quoteIdent(constraintName)} ${stringValue(constraint.definition)}`,
        0,
        undefined,
        constraintMetadata(constraint)
      );
      constraintObject.dependencies.push(`${schema}.${name}`);
      constraintObject.dependencies.push(...stringArray(constraint.function_dependencies));
      if (
        constraint.contype === "f" &&
        typeof constraint.referenced_schema === "string" &&
        typeof constraint.referenced_table === "string"
      ) {
        constraintObject.dependencies.push(
          `${constraint.referenced_schema}.${constraint.referenced_table}`
        );
      }
      objects.push(constraintObject);
    }
  }
  return objects;
}

function partitionAttachSql(
  table: Record<string, unknown>,
  schema: string,
  name: string
): string | undefined {
  if (
    table.is_partition !== true ||
    typeof table.parent_schema !== "string" ||
    typeof table.parent_name !== "string" ||
    typeof table.partition_bound !== "string" ||
    table.partition_bound.length === 0
  ) {
    return;
  }
  return `ALTER TABLE ONLY ${formatQualifiedName(table.parent_schema, table.parent_name)} ATTACH PARTITION ${formatQualifiedName(schema, name)} ${table.partition_bound}`;
}

function partitionClause(table: Record<string, unknown>): string {
  if (table.relkind !== "p" || typeof table.partition_key !== "string") {
    return "";
  }
  const partitionKey = table.partition_key.trim();
  return partitionKey.length === 0 ? "" : ` PARTITION BY ${partitionKey}`;
}

function columnFromRow(column: Record<string, unknown>): TableColumn {
  const identity = stringValue(column.identity);
  const generated = stringValue(column.generated);
  const generatedKind = generatedColumnKind(generated);
  const identityKind = identityMode(identity);
  const parts = [stringValue(column.type)];
  if (generatedKind !== undefined && column.default_expression) {
    parts.push(
      `GENERATED ALWAYS AS (${stringValue(column.default_expression)}) ${generatedKind.toUpperCase()}`
    );
  } else if (identity === "a") {
    parts.push("GENERATED ALWAYS AS IDENTITY");
  } else if (identity === "d") {
    parts.push("GENERATED BY DEFAULT AS IDENTITY");
  } else if (column.default_expression) {
    parts.push(`DEFAULT ${stringValue(column.default_expression)}`);
  }
  if (column.not_null) {
    parts.push("NOT NULL");
  }
  const facts: TableColumn = {
    definition: parts.join(" "),
    hasDefault: Boolean(column.default_expression) && generatedKind === undefined,
    hasInlineConstraint: false,
    name: stringValue(column.name),
    notNull: column.not_null === true,
    type: stringValue(column.type),
  };
  if (generatedKind !== undefined) {
    facts.generated = generatedKind;
  }
  if (identityKind !== undefined) {
    facts.identity = identityKind;
  }
  if (facts.hasDefault && !facts.identity) {
    facts.defaultExpression = stringValue(column.default_expression);
  }
  return facts;
}

function generatedColumnKind(value: string | undefined): "stored" | "virtual" | undefined {
  if (value === "s") {
    return "stored";
  }
  if (value === "v") {
    return "virtual";
  }
}

function identityMode(value: string | undefined): "always" | "by-default" | undefined {
  if (value === "a") {
    return "always";
  }
  if (value === "d") {
    return "by-default";
  }
}

function constraintMetadata(constraint: Record<string, unknown>): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    constraintColumns: stringArray(constraint.columns),
    constraintType: catalogConstraintType(constraint.contype),
  };
  if (
    constraint.contype === "f" &&
    typeof constraint.referenced_schema === "string" &&
    typeof constraint.referenced_table === "string"
  ) {
    metadata.foreignKeyTarget = {
      columns: stringArray(constraint.referenced_columns),
      schema: constraint.referenced_schema,
      table: constraint.referenced_table,
    };
  }
  return metadata;
}

function catalogConstraintType(value: unknown): string | undefined {
  switch (value) {
    case "c":
      return "CONSTR_CHECK";
    case "f":
      return "CONSTR_FOREIGN";
    case "p":
      return "CONSTR_PRIMARY";
    case "u":
      return "CONSTR_UNIQUE";
    case "x":
      return "CONSTR_EXCLUSION";
    default:
      return;
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function groupByOid(rows: Record<string, unknown>[]): Map<string, Record<string, unknown>[]> {
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const oid = stringValue(row.oid);
    const group = groups.get(oid) ?? [];
    group.push(row);
    groups.set(oid, group);
  }
  return groups;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : String(value);
}
