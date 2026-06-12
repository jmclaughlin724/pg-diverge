import type { SchemaObject } from "./core.js";
import { formatQualifiedName, quoteIdent, stripOuterDoubleQuotes } from "./sql/identifiers.js";
import {
  buildDefaultPrivilegeObject,
  buildGrantObject,
  isBuiltinDefaultGrant,
} from "./sql/privileges.js";
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

export async function collectTypes(pool: CatalogQuery): Promise<SchemaObject[]> {
  const objects: SchemaObject[] = [];
  const enums = await pool.query(`
    select n.nspname as schema, t.typname as name,
      array_agg(e.enumlabel order by e.enumsortorder) as values
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    join pg_enum e on e.enumtypid = t.oid
    where t.typtype = 'e' and ${managedSchemaFilter}
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
        { values },
      ),
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
    where t.typtype = 'd' and ${managedSchemaFilter}
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
      ) as columns
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    where c.relkind = 'c' and ${managedSchemaFilter}
    group by n.nspname, c.relname
    order by n.nspname, c.relname
  `);
  for (const row of composites.rows) {
    const schema = text(row.schema);
    const name = text(row.name);
    objects.push(
      makeObject(
        { kind: "type", name, schema },
        `CREATE TYPE ${formatQualifiedName(schema, name)} AS (${text(row.columns)})`,
        0,
      ),
    );
  }
  return objects;
}

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
    for (const [keyword, value, fallback] of [
      ["INCREMENT BY", text(row.increment_by), "1"],
      ["MINVALUE", text(row.min_value), "1"],
      ["MAXVALUE", text(row.max_value), sequenceTypeMax.get(dataType) ?? ""],
      ["START WITH", text(row.start_value), "1"],
      ["CACHE", text(row.cache_size), "1"],
    ] as const) {
      if (value !== fallback) {
        clauses.push(`${keyword} ${value}`);
      }
    }
    if (row.cycle === true) {
      clauses.push("CYCLE");
    }
    if (ownedBy) {
      clauses.push(
        `OWNED BY ${formatQualifiedName(text(row.owned_schema), text(row.owned_table))}.${quoteIdent(text(row.owned_column))}`,
      );
    }
    objects.push(
      makeObject(
        { kind: "sequence", name, schema },
        clauses.join(" "),
        0,
        undefined,
        ownedBy ? { ownedBy } : {},
      ),
    );
  }
  return objects;
}

const sequenceTypeMax = new Map([
  ["bigint", "9223372036854775807"],
  ["integer", "2147483647"],
  ["smallint", "32767"],
]);

export async function collectGrants(pool: CatalogQuery): Promise<SchemaObject[]> {
  const objects: SchemaObject[] = [];
  const relationGrants = await pool.query(`
    select n.nspname as schema, c.relname as name, c.relkind as relkind,
      case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end as grantee,
      array_agg(distinct acl.privilege_type order by acl.privilege_type) as privileges
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace,
    lateral aclexplode(c.relacl) as acl
    where c.relacl is not null
      and c.relkind in ('r', 'p', 'v', 'm', 'S')
      and ${managedSchemaFilter}
      and acl.grantee <> c.relowner
      and not exists (
        select 1 from pg_init_privs i, lateral aclexplode(i.initprivs) ia
        where i.objoid = c.oid and i.classoid = 'pg_class'::regclass
          and ia.grantee = acl.grantee and ia.privilege_type = acl.privilege_type
      )
    group by n.nspname, c.relname, c.relkind, acl.grantee
    order by n.nspname, c.relname, grantee
  `);
  for (const row of relationGrants.rows) {
    const schema = text(row.schema);
    const name = text(row.name);
    const kindPhrase = text(row.relkind) === "S" ? "SEQUENCE" : "TABLE";
    objects.push(
      buildGrantObject({
        grantee: text(row.grantee),
        kindPhrase,
        ordinal: 0,
        privileges: textArray(row.privileges),
        schema,
        targetIdentity: `${schema}.${name}`,
        targetRendered: formatQualifiedName(schema, name),
        verb: "GRANT",
      }),
    );
  }
  // pg_init_privs records initdb/extension-time ACLs; like pg_dump, only the
  // delta against them is declared state (initdb grants USAGE on schema
  // public to PUBLIC in every database).
  const schemaGrants = await pool.query(`
    select n.nspname as name,
      case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end as grantee,
      array_agg(distinct acl.privilege_type order by acl.privilege_type) as privileges
    from pg_namespace n,
    lateral aclexplode(n.nspacl) as acl
    where n.nspacl is not null
      and ${managedSchemaFilter}
      and acl.grantee <> n.nspowner
      and not exists (
        select 1 from pg_init_privs i, lateral aclexplode(i.initprivs) ia
        where i.objoid = n.oid and i.classoid = 'pg_namespace'::regclass
          and ia.grantee = acl.grantee and ia.privilege_type = acl.privilege_type
      )
    group by n.nspname, acl.grantee
    order by n.nspname, grantee
  `);
  for (const row of schemaGrants.rows) {
    const name = text(row.name);
    objects.push(
      buildGrantObject({
        grantee: text(row.grantee),
        kindPhrase: "SCHEMA",
        ordinal: 0,
        privileges: textArray(row.privileges),
        schema: name,
        targetIdentity: name,
        targetRendered: `"${name}"`,
        verb: "GRANT",
      }),
    );
  }
  const functionGrants = await pool.query(`
    select n.nspname as schema, p.proname as name,
      oidvectortypes(p.proargtypes) as args,
      case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end as grantee,
      array_agg(distinct acl.privilege_type order by acl.privilege_type) as privileges
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace,
    lateral aclexplode(p.proacl) as acl
    where p.proacl is not null
      and ${managedSchemaFilter}
      and acl.grantee <> p.proowner
      and not exists (
        select 1 from pg_init_privs i, lateral aclexplode(i.initprivs) ia
        where i.objoid = p.oid and i.classoid = 'pg_proc'::regclass
          and ia.grantee = acl.grantee and ia.privilege_type = acl.privilege_type
      )
    group by n.nspname, p.proname, args, acl.grantee
    order by n.nspname, p.proname, grantee
  `);
  for (const row of functionGrants.rows) {
    const schema = text(row.schema);
    const name = text(row.name);
    const args = text(row.args);
    const grantee = text(row.grantee);
    const privileges = textArray(row.privileges);
    if (isBuiltinDefaultGrant("FUNCTION", grantee, privileges)) {
      continue;
    }
    objects.push(
      buildGrantObject({
        grantee,
        kindPhrase: "FUNCTION",
        ordinal: 0,
        privileges,
        schema,
        targetIdentity: `${schema}.${name}(${args})`,
        targetRendered: `${formatQualifiedName(schema, name)}(${args})`,
        verb: "GRANT",
      }),
    );
  }
  // A non-null routine ACL lacking PUBLIC's built-in EXECUTE means it was
  // explicitly revoked; emit that revoke so trees declaring it hash-match.
  const revokedFunctionDefaults = await pool.query(`
    select n.nspname as schema, p.proname as name, oidvectortypes(p.proargtypes) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.proacl is not null
      and ${managedSchemaFilter}
      and not exists (
        select 1 from aclexplode(p.proacl) acl
        where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
      )
    order by n.nspname, p.proname
  `);
  for (const row of revokedFunctionDefaults.rows) {
    const schema = text(row.schema);
    const name = text(row.name);
    const args = text(row.args);
    objects.push(
      buildGrantObject({
        grantee: "PUBLIC",
        kindPhrase: "FUNCTION",
        ordinal: 0,
        privileges: ["ALL"],
        schema,
        targetIdentity: `${schema}.${name}(${args})`,
        targetRendered: `${formatQualifiedName(schema, name)}(${args})`,
        verb: "REVOKE",
      }),
    );
  }
  const typeGrants = await pool.query(`
    select n.nspname as schema, t.typname as name, t.typtype as typtype,
      case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end as grantee,
      array_agg(distinct acl.privilege_type order by acl.privilege_type) as privileges
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace,
    lateral aclexplode(t.typacl) as acl
    where t.typacl is not null
      and t.typtype in ('e', 'd', 'c', 'r')
      and ${managedSchemaFilter}
      and acl.grantee <> t.typowner
      and not exists (
        select 1 from pg_init_privs i, lateral aclexplode(i.initprivs) ia
        where i.objoid = t.oid and i.classoid = 'pg_type'::regclass
          and ia.grantee = acl.grantee and ia.privilege_type = acl.privilege_type
      )
    group by n.nspname, t.typname, t.typtype, acl.grantee
    order by n.nspname, t.typname, grantee
  `);
  for (const row of typeGrants.rows) {
    const schema = text(row.schema);
    const name = text(row.name);
    const grantee = text(row.grantee);
    const privileges = textArray(row.privileges);
    const kindPhrase = text(row.typtype) === "d" ? "DOMAIN" : "TYPE";
    if (isBuiltinDefaultGrant(kindPhrase, grantee, privileges)) {
      continue;
    }
    objects.push(
      buildGrantObject({
        grantee,
        kindPhrase,
        ordinal: 0,
        privileges,
        schema,
        targetIdentity: `${schema}.${name}`,
        targetRendered: formatQualifiedName(schema, name),
        verb: "GRANT",
      }),
    );
  }
  return objects;
}

const defaultPrivilegeObjectTypes = new Map([
  ["S", "SEQUENCES"],
  ["T", "TYPES"],
  ["f", "FUNCTIONS"],
  ["n", "SCHEMAS"],
  ["r", "TABLES"],
]);

export async function collectDefaultPrivileges(pool: CatalogQuery): Promise<SchemaObject[]> {
  const objects: SchemaObject[] = [];
  const rows = await pool.query(`
    select pg_get_userbyid(d.defaclrole) as for_role,
      case when d.defaclnamespace = 0 then null else n.nspname end as schema,
      d.defaclobjtype as objtype,
      case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end as grantee,
      array_agg(distinct acl.privilege_type order by acl.privilege_type) as privileges
    from pg_default_acl d
    left join pg_namespace n on n.oid = d.defaclnamespace,
    lateral aclexplode(d.defaclacl) as acl
    group by d.defaclrole, schema, d.defaclobjtype, acl.grantee
    order by for_role, schema, d.defaclobjtype, grantee
  `);
  for (const row of rows.rows) {
    const objectType = defaultPrivilegeObjectTypes.get(text(row.objtype));
    if (!objectType) {
      continue;
    }
    const forRole = text(row.for_role);
    const grantee = text(row.grantee);
    const privileges = textArray(row.privileges);
    // The owner's self-entry and PUBLIC's built-in routine/type defaults are
    // acldefault noise, not declared state.
    if (grantee === forRole || isBuiltinDefaultGrant(objectType, grantee, privileges)) {
      continue;
    }
    objects.push(
      buildDefaultPrivilegeObject({
        forRole,
        grantee,
        objectType,
        ordinal: 0,
        privileges,
        schema: row.schema === null ? undefined : text(row.schema),
        verb: "GRANT",
      }),
    );
  }
  // A default-ACL row for routines whose entries lack PUBLIC EXECUTE records
  // an ALTER DEFAULT PRIVILEGES ... REVOKE ... FROM PUBLIC.
  const revokedDefaults = await pool.query(`
    select pg_get_userbyid(d.defaclrole) as for_role,
      case when d.defaclnamespace = 0 then null else n.nspname end as schema,
      d.defaclobjtype as objtype
    from pg_default_acl d
    left join pg_namespace n on n.oid = d.defaclnamespace
    where d.defaclobjtype in ('f', 'T')
      and not exists (
        select 1 from aclexplode(d.defaclacl) acl where acl.grantee = 0
      )
    order by for_role, schema, objtype
  `);
  for (const row of revokedDefaults.rows) {
    const objectType = defaultPrivilegeObjectTypes.get(text(row.objtype));
    if (!objectType) {
      continue;
    }
    objects.push(
      buildDefaultPrivilegeObject({
        forRole: text(row.for_role),
        grantee: "PUBLIC",
        objectType,
        ordinal: 0,
        privileges: ["ALL"],
        schema: row.schema === null ? undefined : text(row.schema),
        verb: "REVOKE",
      }),
    );
  }
  return objects;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : String(value);
}

function textArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(text);
  }
  const raw = text(value).trim();
  if (raw.startsWith("{") && raw.endsWith("}")) {
    return raw
      .slice(1, -1)
      .split(",")
      .map((item) => stripOuterDoubleQuotes(item.trim()))
      .filter(Boolean);
  }
  return raw.length > 0 ? [raw] : [];
}
