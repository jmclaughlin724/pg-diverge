import type { SchemaObject } from "../core.js";
import { formatQualifiedName } from "../sql/identifiers.js";
import {
  buildDefaultPrivilegeObject,
  buildGrantObject,
  isBuiltinDefaultGrant,
} from "../sql/privileges.js";
import { type CatalogQuery, managedSchemaFilter, text, textArray } from "./query.js";

const defaultPrivilegeObjectTypes = new Map([
  ["S", "SEQUENCES"],
  ["T", "TYPES"],
  ["f", "FUNCTIONS"],
  ["n", "SCHEMAS"],
  ["r", "TABLES"],
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
      })
    );
  }

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
      })
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
      })
    );
  }

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
      })
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
      })
    );
  }
  return objects;
}

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
      })
    );
  }

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
      })
    );
  }
  return objects;
}
