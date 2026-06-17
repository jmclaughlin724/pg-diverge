import { Pool } from "pg";
import { collectComments } from "./catalog-comments.js";
import {
  collectDefaultPrivileges,
  collectGrants,
  collectSequences,
  collectTypes,
} from "./catalog-extras.js";
import { collectForeignObjects } from "./catalog-foreign.js";
import { collectTables } from "./catalog-tables.js";
import type { SchemaModel, SchemaObject } from "./core.js";
import { diagnostic } from "./diagnostics.js";
import { fingerprintObjects, MODEL_FORMAT_VERSION } from "./hash.js";
import { suppressDefaultAclImpliedGrants } from "./source-normalize.js";
import { finalizeObjects } from "./sql/facts.js";
import { formatQualifiedName, quoteIdent, stripOuterDoubleQuotes } from "./sql/identifiers.js";
import { makeObject } from "./sql/statements.js";

export interface ExtractCatalogOptions {
  databaseUrl: string;
  normalize?: boolean;
  source?: string;
}

type CatalogPool = Pick<Pool, "query">;

export async function extractCatalogModel(options: ExtractCatalogOptions): Promise<SchemaModel> {
  // Empty search_path (pg_dump's convention) so pg_get_expr renders every
  // reference schema-qualified; otherwise the session's search_path decides
  // whether `auth.uid()` reconstructs as `uid()` and the cross-lane hash
  // silently diverges from the declarative spelling.
  const pool = new Pool({
    connectionString: options.databaseUrl,
    max: 4,
    options: "-c search_path=",
  });
  pool.on("error", () => {
    // The main extraction path reports query failures through diagnostics.
  });
  try {
    const sections = await Promise.all([
      collectSection((objects) => appendSchemas(pool, objects, 0)),
      collectSection((objects) => appendExtensions(pool, objects, 0)),
      collectTypes(pool),
      collectSequences(pool),
      collectTables(pool),
      collectForeignObjects(pool),
      collectSection((objects) => appendFunctions(pool, objects, 0)),
      collectSection((objects) => appendViews(pool, objects, 0)),
      collectSection((objects) => appendIndexes(pool, objects, 0)),
      collectSection((objects) => appendTriggers(pool, objects, 0)),
      collectSection((objects) => appendPoliciesAndRls(pool, objects, 0)),
      collectGrants(pool),
      collectDefaultPrivileges(pool),
      collectComments(pool),
    ]);
    const objects: SchemaObject[] = suppressDefaultAclImpliedGrants(sections.flat());
    objects.forEach((object, index) => {
      object.ordinal = index;
    });
    const diagnostics = await finalizeObjects(objects, {
      normalize: options.normalize === true,
    });
    return {
      diagnostics,
      fingerprint: fingerprintObjects(objects),
      formatVersion: MODEL_FORMAT_VERSION,
      objects,
      source: options.source ?? "database",
    };
  } catch (error) {
    return {
      diagnostics: [
        diagnostic("SUPA_CATALOG_EXTRACT_FAILED", "error", errorMessage(error), {
          hint: "Confirm the database URL is reachable and the role can read pg_catalog.",
        }),
      ],
      fingerprint: fingerprintObjects([]),
      objects: [],
      source: options.source ?? "database",
    };
  } finally {
    await pool.end();
  }
}

async function collectSection(
  section: (objects: SchemaObject[]) => Promise<number>
): Promise<SchemaObject[]> {
  const objects: SchemaObject[] = [];
  await section(objects);
  return objects;
}

async function appendSchemas(
  pool: CatalogPool,
  objects: SchemaObject[],
  ordinal: number
): Promise<number> {
  let nextOrdinal = ordinal;
  // `public` is created by initdb in every database; modeling it as a
  // droppable object would let a tree that never declares it render
  // DROP SCHEMA public.
  const result = await pool.query<Record<string, unknown>>(`
    select nspname as name
    from pg_namespace
    where nspname !~ '^pg_'
      and nspname not in ('information_schema', 'public')
    order by nspname
  `);
  for (const row of result.rows) {
    const name = stringValue(row.name);
    objects.push(
      makeObject({ kind: "schema", name }, `CREATE SCHEMA ${quoteIdent(name)}`, nextOrdinal)
    );
    nextOrdinal += 1;
  }
  return nextOrdinal;
}

async function appendExtensions(
  pool: CatalogPool,
  objects: SchemaObject[],
  ordinal: number
): Promise<number> {
  let nextOrdinal = ordinal;
  // plpgsql is installed by initdb in every database (same class as the
  // public schema); modeling it would render DROP EXTENSION plpgsql for any
  // tree that never declares it.
  const result = await pool.query<Record<string, unknown>>(`
    select e.extname as name, n.nspname as schema
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
    where e.extname <> 'plpgsql'
    order by e.extname
  `);
  for (const row of result.rows) {
    const name = stringValue(row.name);
    const schema = stringValue(row.schema);
    objects.push(
      makeObject(
        { kind: "extension", name },
        `CREATE EXTENSION ${quoteIdent(name)} WITH SCHEMA ${quoteIdent(schema)}`,
        nextOrdinal,
        undefined,
        { schema }
      )
    );
    nextOrdinal += 1;
  }
  return nextOrdinal;
}

async function appendFunctions(
  pool: CatalogPool,
  objects: SchemaObject[],
  ordinal: number
): Promise<number> {
  let nextOrdinal = ordinal;
  const result = await pool.query<Record<string, unknown>>(`
    select
      n.nspname as schema,
      p.proname as name,
      p.prokind as kind,
      oidvectortypes(p.proargtypes) as args,
      p.provariadic <> 0 as variadic,
      pg_get_functiondef(p.oid) as definition
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname !~ '^pg_'
      and n.nspname <> 'information_schema'
      and p.prokind in ('f', 'p')
    order by n.nspname, p.proname, oidvectortypes(p.proargtypes)
  `);
  for (const row of result.rows) {
    const kind = stringValue(row.kind) === "p" ? "procedure" : "function";
    objects.push(
      makeObject(
        {
          kind,
          name: stringValue(row.name),
          schema: stringValue(row.schema),
          // Routine identity is input argument TYPES only (names are not part
          // of PostgreSQL overload identity), matching the source lane.
          signature: functionSignature(stringValue(row.args), row.variadic === true),
        },
        stringValue(row.definition),
        nextOrdinal
      )
    );
    nextOrdinal += 1;
  }
  return nextOrdinal;
}

// oidvectortypes joins input argument types with ", "; type names contain no
// commas, so marking the trailing VARIADIC argument by splitting is safe.
function functionSignature(args: string, variadic: boolean): string {
  if (!variadic || args.length === 0) {
    return args;
  }
  const types = args.split(", ");
  types[types.length - 1] = `VARIADIC ${types.at(-1)}`;
  return types.join(", ");
}

async function appendViews(
  pool: CatalogPool,
  objects: SchemaObject[],
  ordinal: number
): Promise<number> {
  let nextOrdinal = ordinal;
  const result = await pool.query<Record<string, unknown>>(`
    select
      n.nspname as schema,
      c.relname as name,
      c.relkind as relkind,
      c.reloptions as reloptions,
      pg_get_viewdef(c.oid, true) as definition
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('v', 'm')
      and n.nspname !~ '^pg_'
      and n.nspname <> 'information_schema'
    order by n.nspname, c.relname
  `);
  for (const row of result.rows) {
    const kind = stringValue(row.relkind) === "m" ? "materialized-view" : "view";
    const prefix = kind === "materialized-view" ? "CREATE MATERIALIZED VIEW" : "CREATE VIEW";
    const schema = stringValue(row.schema);
    const name = stringValue(row.name);
    const withClause =
      kind === "view" && reloptionEnabled(row.reloptions, "security_invoker")
        ? " WITH (security_invoker = true)"
        : "";
    objects.push(
      makeObject(
        { kind, name, schema },
        `${prefix} ${formatQualifiedName(schema, name)}${withClause} AS\n${stringValue(row.definition)}`,
        nextOrdinal
      )
    );
    nextOrdinal += 1;
  }
  return nextOrdinal;
}

function reloptionEnabled(reloptions: unknown, option: string): boolean {
  if (!Array.isArray(reloptions)) {
    return false;
  }
  for (const entry of reloptions) {
    const text = String(entry);
    const separator = text.indexOf("=");
    const name = separator === -1 ? text : text.slice(0, separator);
    if (name.trim().toLowerCase() !== option) {
      continue;
    }
    const value =
      separator === -1
        ? "true"
        : text
            .slice(separator + 1)
            .trim()
            .toLowerCase();
    return value === "true" || value === "on" || value === "1" || value === "yes";
  }
  return false;
}

async function appendIndexes(
  pool: CatalogPool,
  objects: SchemaObject[],
  ordinal: number
): Promise<number> {
  let nextOrdinal = ordinal;
  // Constraint-backed indexes (PK/UNIQUE/EXCLUDE) are owned by their
  // constraint object; emitting them as index objects would double-own them
  // and plan false index drops against trees that declare the constraint.
  const result = await pool.query<Record<string, unknown>>(`
    select i.schemaname, i.tablename, i.indexname, i.indexdef
    from pg_indexes i
    where i.schemaname !~ '^pg_'
      and i.schemaname <> 'information_schema'
      and not exists (
        select 1
        from pg_constraint con
        join pg_class ic on ic.oid = con.conindid
        join pg_namespace icn on icn.oid = ic.relnamespace
        where icn.nspname = i.schemaname and ic.relname = i.indexname
      )
    order by i.schemaname, i.indexname
  `);
  for (const row of result.rows) {
    objects.push(
      makeObject(
        {
          kind: "index",
          name: stringValue(row.indexname),
          schema: stringValue(row.schemaname),
          table: stringValue(row.tablename),
        },
        stringValue(row.indexdef),
        nextOrdinal
      )
    );
    nextOrdinal += 1;
  }
  return nextOrdinal;
}

async function appendTriggers(
  pool: CatalogPool,
  objects: SchemaObject[],
  ordinal: number
): Promise<number> {
  let nextOrdinal = ordinal;
  const result = await pool.query<Record<string, unknown>>(`
    select
      n.nspname as schema,
      c.relname as table_name,
      t.tgname as name,
      pg_get_triggerdef(t.oid, true) as definition
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where not t.tgisinternal
      and n.nspname !~ '^pg_'
      and n.nspname <> 'information_schema'
    order by n.nspname, c.relname, t.tgname
  `);
  for (const row of result.rows) {
    objects.push(
      makeObject(
        {
          kind: "trigger",
          name: stringValue(row.name),
          schema: stringValue(row.schema),
          table: stringValue(row.table_name),
        },
        stringValue(row.definition),
        nextOrdinal
      )
    );
    nextOrdinal += 1;
  }
  return nextOrdinal;
}

async function appendPoliciesAndRls(
  pool: CatalogPool,
  objects: SchemaObject[],
  ordinal: number
): Promise<number> {
  let nextOrdinal = ordinal;
  const rls = await pool.query<Record<string, unknown>>(`
    select n.nspname as schema, c.relname as name, c.relrowsecurity as rls, c.relforcerowsecurity as force
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p')
      and (c.relrowsecurity or c.relforcerowsecurity)
      and n.nspname !~ '^pg_'
      and n.nspname <> 'information_schema'
    order by n.nspname, c.relname
  `);
  for (const row of rls.rows) {
    const schema = stringValue(row.schema);
    const name = stringValue(row.name);
    // ENABLE and FORCE are independent facets of one table's RLS state and
    // share one rls identity; emit both statements so forced tables render
    // correctly and hash-match a source tree that declares both.
    const statements: string[] = [];
    if (row.rls) {
      statements.push(`ALTER TABLE ${formatQualifiedName(schema, name)} ENABLE ROW LEVEL SECURITY`);
    }
    if (row.force) {
      statements.push(`ALTER TABLE ${formatQualifiedName(schema, name)} FORCE ROW LEVEL SECURITY`);
    }
    objects.push(
      makeObject(
        { kind: "rls", name, schema, table: name },
        statements.join(";\n"),
        nextOrdinal,
        undefined,
        {
          rlsEnabled: row.rls === true,
          rlsForced: row.force === true,
          rlsSubtype: row.rls === true ? "AT_EnableRowSecurity" : "AT_ForceRowSecurity",
        }
      )
    );
    nextOrdinal += 1;
  }
  const policies = await pool.query<Record<string, unknown>>(`
    select
      schemaname as schema,
      tablename as table_name,
      policyname as name,
      permissive,
      roles,
      cmd,
      qual,
      with_check
    from pg_policies
    order by schemaname, tablename, policyname
  `);
  for (const row of policies.rows) {
    const schema = stringValue(row.schema);
    const table = stringValue(row.table_name);
    const name = stringValue(row.name);
    const clauses = [
      `CREATE POLICY ${quoteIdent(name)} ON ${formatQualifiedName(schema, table)}`,
      `AS ${stringValue(row.permissive)}`,
      `FOR ${stringValue(row.cmd)}`,
      // pg_policies reports PUBLIC as the role name "public"; quoting it
      // would parse as a named role instead of the ROLESPEC_PUBLIC keyword
      // and break cross-lane hash parity with `TO PUBLIC` trees.
      `TO ${normalizePolicyRoles(row.roles)
        .map((role) => (role === "public" ? "PUBLIC" : quoteIdent(role)))
        .join(", ")}`,
    ];
    if (row.qual) {
      clauses.push(`USING (${stringValue(row.qual)})`);
    }
    if (row.with_check) {
      clauses.push(`WITH CHECK (${stringValue(row.with_check)})`);
    }
    objects.push(
      makeObject({ kind: "policy", name, schema, table }, clauses.join(" "), nextOrdinal)
    );
    nextOrdinal += 1;
  }
  return nextOrdinal;
}

function normalizePolicyRoles(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      return trimmed
        .slice(1, -1)
        .split(",")
        .map((role) => stripOuterDoubleQuotes(role.trim()))
        .filter(Boolean);
    }
    return trimmed
      .split(",")
      .map((role) => role.trim())
      .filter(Boolean);
  }
  return [String(value)];
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : String(value);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
