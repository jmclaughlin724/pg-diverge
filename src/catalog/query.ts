import { stripOuterDoubleQuotes } from "../sql/identifiers.js";

export interface CatalogQuery {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
}

const supabasePlatformOwnerRoles = [
  "supabase_admin",
  "supabase_auth_admin",
  "supabase_storage_admin",
];
const supabasePlatformOwnerRoleSql = supabasePlatformOwnerRoles
  .map((role) => `'${role}'`)
  .join(", ");

export function notExtensionMember(alias: string, catalog: string): string {
  return notExtensionMemberOid(catalog, `${alias}.oid`);
}

export function notExtensionMemberOid(catalog: string, oidExpression: string): string {
  return `
  not exists (
    select 1
    from pg_depend ext_member
    where ext_member.classid = '${catalog}'::regclass
      and ext_member.objid = ${oidExpression}
      and ext_member.deptype = 'e'
  )`;
}

export const managedSchemaFilter = `
  left(n.nspname, 3) <> 'pg_'
  and n.nspname <> 'information_schema'
  and ${notExtensionMember("n", "pg_namespace")}
  and not (
    left(n.nspname, 1) = '_'
    and exists (
      select 1
      from pg_class supabase_internal_class
      join pg_roles supabase_internal_owner on supabase_internal_owner.oid = supabase_internal_class.relowner
      where supabase_internal_class.relnamespace = n.oid
        and supabase_internal_class.relkind in ('r', 'p', 'v', 'm', 'S', 'f', 'c')
        and supabase_internal_owner.rolname in (${supabasePlatformOwnerRoleSql})
    )
    and not exists (
      select 1
      from pg_class user_owned_internal_class
      join pg_roles user_owned_internal_owner on user_owned_internal_owner.oid = user_owned_internal_class.relowner
      where user_owned_internal_class.relnamespace = n.oid
        and user_owned_internal_class.relkind in ('r', 'p', 'v', 'm', 'S', 'f', 'c')
        and user_owned_internal_owner.rolname not in (${supabasePlatformOwnerRoleSql})
    )
  )
`;

export function text(value: unknown): string {
  return typeof value === "string" ? value : String(value);
}

export function textArray(value: unknown): string[] {
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
