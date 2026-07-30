import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planSchemaDiff } from "../../src/planner/schema.js";
import { renderMigration } from "../../src/render/migration.js";
import { extractSourceModel, filterModelBySchemas } from "../../src/source/extract.js";
import { extractObjectsFromSql } from "../../src/sql/extract.js";

async function modelFromSql(sql: string) {
  const root = await mkdtemp(join(tmpdir(), "supa-normalize-"));
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "001.sql"), sql);
  return await extractSourceModel(`dir:${root}`);
}

function errors(model: Awaited<ReturnType<typeof modelFromSql>>) {
  return model.diagnostics.filter((item) => item.severity === "error");
}

describe("split privilege aggregation", () => {
  it("extracts empty: as a valid empty schema source", async () => {
    const model = await extractSourceModel("empty:");

    expect(errors(model)).toEqual([]);
    expect(model.objects).toEqual([]);
    expect(model.source).toBe("empty:");
  });

  it("keeps comments on pre-existing schemas", async () => {
    const model = await modelFromSql("COMMENT ON SCHEMA public IS 'workspace docs';\n");

    expect(errors(model)).toEqual([]);
    expect(
      model.objects.some(
        (object) => object.ref.kind === "comment" && object.metadata.descriptor === "schema public"
      )
    ).toBe(true);
  });

  it("treats the initdb default public schema comment as default state", async () => {
    const model = await modelFromSql("COMMENT ON SCHEMA public IS 'standard public schema';\n");

    expect(errors(model)).toEqual([]);
    expect(model.objects).toEqual([]);
  });

  it("skips _bootstrap inventory files when reading schema sources", async () => {
    const root = await mkdtemp(join(tmpdir(), "supa-bootstrap-skip-"));
    await mkdir(join(root, "_bootstrap"), { recursive: true });
    await writeFile(
      join(root, "_bootstrap", "00_roles.sql"),
      "DO $$ BEGIN CREATE ROLE app_runtime NOLOGIN; END $$;\n"
    );
    await writeFile(
      join(root, "app.sql"),
      "CREATE SCHEMA app;\nCREATE TABLE app.accounts (id bigint PRIMARY KEY);\n"
    );

    const model = await extractSourceModel(`dir:${root}`);

    expect(errors(model)).toEqual([]);
    expect(model.objects.map((object) => object.key)).toContain("table:app.accounts");
  });

  it("accepts a duplicate-guarded role-only DO block as declarative bootstrap intent", async () => {
    const model = await modelFromSql(`DO $$
BEGIN
  CREATE ROLE app_worker NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;`);

    expect(errors(model)).toEqual([]);
    expect(model.objects).toEqual([]);
  });

  it("rejects a DO block that mixes role bootstrap with data side effects", async () => {
    const model = await modelFromSql(`CREATE SCHEMA app;
CREATE TABLE app.events (id integer);
DO $$
BEGIN
  CREATE ROLE app_worker NOLOGIN;
  INSERT INTO app.events (id) VALUES (1);
EXCEPTION WHEN duplicate_object THEN NULL;
END
$$;`);

    expect(errors(model).map((item) => item.code)).toContain(
      "SUPA_EXTRACT_SIDE_EFFECT_UNSUPPORTED"
    );
  });

  it("filters managed-schema and side-effect diagnostics out of scoped schema diffs", async () => {
    const root = await mkdtemp(join(tmpdir(), "supa-filter-"));
    await writeFile(
      join(root, "bootstrap.sql"),
      [
        "CREATE SCHEMA auth;",
        "DO $$ BEGIN CREATE ROLE zapier NOLOGIN; END $$;",
        "CREATE SCHEMA app;",
        "CREATE TABLE app.accounts (id bigint PRIMARY KEY);",
      ].join("\n")
    );

    const model = await extractSourceModel(`dir:${root}`, {
      config: { managedSchemas: ["auth"] },
    });
    expect(errors(model).map((item) => item.code)).toEqual([
      "SUPA_SUPABASE_MANAGED_SCHEMA",
      "SUPA_EXTRACT_SIDE_EFFECT_UNSUPPORTED",
    ]);

    const scoped = filterModelBySchemas(
      {
        ...model,
        diagnostics: [
          ...model.diagnostics,
          {
            code: "SUPA_NORMALIZE_FIDELITY",
            message: "outside schema normalization warning",
            ref: {
              kind: "grant",
              name: "grant:table:other.accounts:service_role",
              schema: "other",
            },
            severity: "warning",
          },
        ],
      },
      new Set(["app"])
    );
    expect(errors(scoped)).toEqual([]);
    expect(scoped.diagnostics).toEqual([]);
    expect(scoped.objects.map((object) => object.key)).toContain("table:app.accounts");
  });

  it("suppresses no-op schema revokes (no default, nothing granted) without duplicates", async () => {
    const model = await modelFromSql(
      "CREATE SCHEMA app;\nREVOKE CREATE ON SCHEMA app FROM PUBLIC;\nREVOKE USAGE ON SCHEMA app FROM PUBLIC;\n"
    );

    expect(errors(model)).toEqual([]);

    expect(model.objects.filter((object) => object.ref.kind === "grant")).toHaveLength(0);
  });

  it("nets a grant fully undone by a later revoke to nothing", async () => {
    const model = await modelFromSql(
      "CREATE SCHEMA app;\nGRANT USAGE ON SCHEMA app TO PUBLIC;\nREVOKE USAGE ON SCHEMA app FROM PUBLIC;\n"
    );

    expect(model.objects.filter((object) => object.ref.kind === "grant")).toHaveLength(0);
  });

  it("drops a revoke superseded by a later grant and keeps the grant", async () => {
    const model = await modelFromSql(
      "CREATE SCHEMA app;\nREVOKE ALL ON SCHEMA app FROM PUBLIC;\nGRANT USAGE ON SCHEMA app TO PUBLIC;\n"
    );

    const grants = model.objects.filter((object) => object.ref.kind === "grant");
    expect(grants.map((object) => object.metadata.verb)).toEqual(["GRANT"]);
  });

  it("keeps revokes of built-in PUBLIC defaults and suppresses grants restating them", async () => {
    const model = await modelFromSql(
      "CREATE SCHEMA app;\nCREATE FUNCTION app.f() RETURNS int LANGUAGE sql AS 'SELECT 1';\nREVOKE ALL ON FUNCTION app.f() FROM PUBLIC;\nCREATE FUNCTION app.g() RETURNS int LANGUAGE sql AS 'SELECT 2';\nGRANT EXECUTE ON FUNCTION app.g() TO PUBLIC;\n"
    );

    const grants = model.objects.filter((object) => object.ref.kind === "grant");
    expect(grants).toHaveLength(1);
    expect(grants[0]?.metadata.verb).toBe("REVOKE");
  });

  it("hashes a split revoke pair identically to the single-statement form", async () => {
    const split = await modelFromSql(
      "CREATE SCHEMA app;\nREVOKE CREATE ON SCHEMA app FROM PUBLIC;\nREVOKE USAGE ON SCHEMA app FROM PUBLIC;\n"
    );
    const single = await modelFromSql(
      "CREATE SCHEMA app;\nREVOKE ALL ON SCHEMA app FROM PUBLIC;\n"
    );

    expect(split.fingerprint).toBe(single.fingerprint);
  });

  it("merges partial unions without collapsing below the full set", async () => {
    const model = await modelFromSql(
      "CREATE SCHEMA app;\nCREATE TABLE app.t (id bigint);\nGRANT SELECT ON TABLE app.t TO PUBLIC;\nGRANT INSERT, UPDATE ON TABLE app.t TO PUBLIC;\n"
    );

    expect(errors(model)).toEqual([]);
    const grants = model.objects.filter((object) => object.ref.kind === "grant");
    expect(grants).toHaveLength(1);
    expect(grants[0]?.metadata.privileges).toEqual(["INSERT", "SELECT", "UPDATE"]);
  });

  it("preserves column-scoped SELECT grants when merging table privileges", async () => {
    const model = await modelFromSql(
      "CREATE SCHEMA tenancy;\nCREATE TABLE tenancy.role_assignments (organization_id uuid, user_id uuid);\nGRANT SELECT (user_id, organization_id) ON TABLE tenancy.role_assignments TO authenticated;\nGRANT INSERT ON TABLE tenancy.role_assignments TO authenticated;\n"
    );

    expect(errors(model)).toEqual([]);
    const grants = model.objects.filter((object) => object.ref.kind === "grant");
    expect(grants).toHaveLength(1);
    expect(grants[0]?.metadata.privileges).toEqual(["INSERT", "SELECT"]);
    expect(grants[0]?.metadata.columnPrivileges).toEqual({
      SELECT: ["organization_id", "user_id"],
    });
    expect(grants[0]?.sql).toBe(
      'GRANT INSERT, SELECT ("organization_id", "user_id") ON TABLE "tenancy"."role_assignments" TO "authenticated"'
    );
  });

  it("lets an object-wide privilege dominate the same column-scoped privilege", async () => {
    const model = await modelFromSql(
      "CREATE SCHEMA tenancy;\nCREATE TABLE tenancy.role_assignments (organization_id uuid, user_id uuid);\nGRANT SELECT (organization_id) ON TABLE tenancy.role_assignments TO authenticated;\nGRANT SELECT ON TABLE tenancy.role_assignments TO authenticated;\n"
    );

    expect(errors(model)).toEqual([]);
    const grants = model.objects.filter((object) => object.ref.kind === "grant");
    expect(grants).toHaveLength(1);
    expect(grants[0]?.metadata.privileges).toEqual(["SELECT"]);
    expect(grants[0]?.metadata).not.toHaveProperty("columnPrivileges");
    expect(grants[0]?.sql).toBe(
      'GRANT SELECT ON TABLE "tenancy"."role_assignments" TO "authenticated"'
    );
  });

  it("does not collapse a complete table privilege set while one privilege is column-scoped", async () => {
    const model = await modelFromSql(
      "CREATE SCHEMA app;\nCREATE TABLE app.t (id bigint);\nGRANT SELECT (id) ON TABLE app.t TO authenticated;\nGRANT DELETE, INSERT, REFERENCES, TRIGGER, TRUNCATE, UPDATE ON TABLE app.t TO authenticated;\n"
    );

    expect(errors(model)).toEqual([]);
    const grants = model.objects.filter((object) => object.ref.kind === "grant");
    expect(grants).toHaveLength(1);
    expect(grants[0]?.metadata.privileges).toEqual([
      "DELETE",
      "INSERT",
      "REFERENCES",
      "SELECT",
      "TRIGGER",
      "TRUNCATE",
      "UPDATE",
    ]);
    expect(grants[0]?.metadata.columnPrivileges).toEqual({ SELECT: ["id"] });
    expect(grants[0]?.sql).toContain('SELECT ("id")');
    expect(grants[0]?.sql).not.toContain("GRANT ALL");
  });

  it("normalizes column-scoped ALL to PostgreSQL's column privilege set", async () => {
    const all = await modelFromSql(
      "CREATE SCHEMA app;\nCREATE TABLE app.t (id bigint);\nGRANT ALL (id) ON TABLE app.t TO authenticated;\n"
    );
    const explicit = await modelFromSql(
      "CREATE SCHEMA app;\nCREATE TABLE app.t (id bigint);\nGRANT INSERT (id), REFERENCES (id), SELECT (id), UPDATE (id) ON TABLE app.t TO authenticated;\n"
    );

    expect(errors(all)).toEqual([]);
    expect(errors(explicit)).toEqual([]);
    const grant = all.objects.find((object) => object.ref.kind === "grant");
    expect(grant?.metadata.privileges).toEqual(["INSERT", "REFERENCES", "SELECT", "UPDATE"]);
    expect(grant?.metadata.columnPrivileges).toEqual({
      INSERT: ["id"],
      REFERENCES: ["id"],
      SELECT: ["id"],
      UPDATE: ["id"],
    });
    expect(grant?.sql).not.toContain("GRANT ALL");
    expect(all.fingerprint).toBe(explicit.fingerprint);
  });

  it("preserves per-privilege grant options without duplicate diagnostics", async () => {
    const model = await modelFromSql(
      "CREATE SCHEMA app;\nCREATE TABLE app.t (id bigint);\nGRANT SELECT ON TABLE app.t TO PUBLIC;\nGRANT INSERT ON TABLE app.t TO PUBLIC WITH GRANT OPTION;\n"
    );

    expect(errors(model)).toEqual([]);
    const grant = model.objects.find((object) => object.ref.kind === "grant");
    expect(grant?.metadata).toMatchObject({
      grantOptionPrivileges: ["INSERT"],
      privileges: ["INSERT", "SELECT"],
    });
    expect(grant?.sql).toContain("GRANT INSERT, SELECT ON TABLE");
    expect(grant?.sql).toContain("GRANT INSERT ON TABLE");
    expect(grant?.sql).toContain("WITH GRANT OPTION");
  });

  it("merges split default-privilege statements with a real default to revoke", async () => {
    const model = await modelFromSql(
      "CREATE SCHEMA app;\nALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT ON TABLES TO PUBLIC;\nALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT INSERT ON TABLES TO PUBLIC;\n"
    );

    expect(errors(model)).toEqual([]);
    const defaults = model.objects.filter((object) => object.ref.kind === "default-privilege");
    expect(defaults).toHaveLength(1);
    expect(defaults[0]?.metadata.privileges).toEqual(["INSERT", "SELECT"]);
  });

  it("suppresses no-op default-privilege revokes for grantees with no built-in default", async () => {
    const model = await modelFromSql(
      "CREATE SCHEMA app;\nALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE SELECT ON TABLES FROM PUBLIC;\nALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;\n"
    );

    const defaults = model.objects.filter((object) => object.ref.kind === "default-privilege");

    expect(defaults).toHaveLength(1);
    expect(defaults[0]?.metadata.objectType).toBe("FUNCTIONS");
  });
});

describe("standalone column default amendments", () => {
  it("hashes ALTER COLUMN SET DEFAULT identically to the inline declaration", async () => {
    const altered = await modelFromSql(
      "CREATE SCHEMA app;\nCREATE TABLE app.t (id bigint);\nALTER TABLE app.t ALTER COLUMN id SET DEFAULT 5;\n"
    );
    const inline = await modelFromSql(
      "CREATE SCHEMA app;\nCREATE TABLE app.t (id bigint DEFAULT 5);\n"
    );

    expect(errors(altered)).toEqual([]);
    const alteredTable = altered.objects.find((object) => object.ref.kind === "table");
    const inlineTable = inline.objects.find((object) => object.ref.kind === "table");
    expect(alteredTable?.hash).toBe(inlineTable?.hash);
    expect(alteredTable?.sql).toContain("SET DEFAULT 5");
  });

  it("DROP DEFAULT cancels an inline default", async () => {
    const dropped = await modelFromSql(
      "CREATE SCHEMA app;\nCREATE TABLE app.t (id bigint DEFAULT 5);\nALTER TABLE app.t ALTER COLUMN id DROP DEFAULT;\n"
    );
    const bare = await modelFromSql("CREATE SCHEMA app;\nCREATE TABLE app.t (id bigint);\n");

    const droppedTable = dropped.objects.find((object) => object.ref.kind === "table");
    const bareTable = bare.objects.find((object) => object.ref.kind === "table");
    expect(droppedTable?.hash).toBe(bareTable?.hash);
  });

  it("preserves non-default column definition facets when applying a default amendment", async () => {
    const model = await modelFromSql(
      "CREATE SCHEMA app;\nCREATE TABLE app.t (name text COLLATE \"C\");\nALTER TABLE app.t ALTER COLUMN name SET DEFAULT 'x';\n"
    );

    expect(errors(model)).toEqual([]);
    const table = model.objects.find((object) => object.ref.kind === "table");
    const columns = Array.isArray(table?.metadata.columns) ? table.metadata.columns : [];
    const column = columns.find(
      (item): item is { definition: string; name: string } =>
        typeof item === "object" &&
        item !== null &&
        "name" in item &&
        item.name === "name" &&
        "definition" in item &&
        typeof item.definition === "string"
    );
    expect(column?.definition).toContain('text COLLATE "C"');
    expect(column?.definition).toContain("DEFAULT 'x'");
  });

  it("fails closed when the amended table is missing", async () => {
    const model = await modelFromSql("ALTER TABLE app.missing ALTER COLUMN id SET DEFAULT 5;\n");

    expect(errors(model).map((item) => item.code)).toContain("SUPA_EXTRACT_UNSUPPORTED");
  });
});

describe("standalone column identity amendments", () => {
  it("hashes ALTER COLUMN ADD IDENTITY identically to the inline declaration", async () => {
    const altered = await modelFromSql(
      "CREATE SCHEMA app;\nCREATE TABLE app.t (id bigint NOT NULL);\nALTER TABLE app.t ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY;\n"
    );
    const inline = await modelFromSql(
      "CREATE SCHEMA app;\nCREATE TABLE app.t (id bigint GENERATED ALWAYS AS IDENTITY NOT NULL);\n"
    );

    expect(errors(altered)).toEqual([]);
    const alteredTable = altered.objects.find((object) => object.ref.kind === "table");
    const inlineTable = inline.objects.find((object) => object.ref.kind === "table");
    expect(alteredTable?.hash).toBe(inlineTable?.hash);
    expect(alteredTable?.sql).toContain("ADD GENERATED ALWAYS AS IDENTITY");
  });

  it("DROP IDENTITY cancels an inline identity", async () => {
    const dropped = await modelFromSql(
      "CREATE SCHEMA app;\nCREATE TABLE app.t (id bigint GENERATED ALWAYS AS IDENTITY NOT NULL);\nALTER TABLE app.t ALTER COLUMN id DROP IDENTITY IF EXISTS;\n"
    );
    const bare = await modelFromSql(
      "CREATE SCHEMA app;\nCREATE TABLE app.t (id bigint NOT NULL);\n"
    );

    const droppedTable = dropped.objects.find((object) => object.ref.kind === "table");
    const bareTable = bare.objects.find((object) => object.ref.kind === "table");
    expect(droppedTable?.hash).toBe(bareTable?.hash);
  });

  it("preserves identity mode for sequence-option-only identity amendments", async () => {
    const altered = await modelFromSql(
      "CREATE SCHEMA app;\nCREATE TABLE app.t (id bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL);\nALTER TABLE app.t ALTER COLUMN id SET INCREMENT BY 5;\n"
    );

    expect(errors(altered)).toEqual([]);
    const table = altered.objects.find((object) => object.ref.kind === "table");
    expect(table?.metadata.canonicalShape).toMatchObject({
      columns: [expect.objectContaining({ identity: "d" })],
    });
    expect(table?.metadata.columns).toEqual([
      expect.objectContaining({
        definition: expect.stringContaining("GENERATED BY DEFAULT AS IDENTITY"),
        name: "id",
      }),
    ]);
  });

  it("plans sequence-option-only identity amendments", async () => {
    const from = await modelFromSql(
      "CREATE SCHEMA app;\nCREATE TABLE app.t (id bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL);\n"
    );
    const to = await modelFromSql(
      "CREATE SCHEMA app;\nCREATE TABLE app.t (id bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL);\nALTER TABLE app.t ALTER COLUMN id SET INCREMENT BY 5;\n"
    );

    expect(errors(to)).toEqual([]);
    const plan = planSchemaDiff(from, to);
    const sql = renderMigration(plan, { includeHeader: false });

    expect(plan.operations.find((operation) => operation.key === "table:app.t")?.kind).toBe(
      "alter"
    );
    expect(sql).toContain("SET INCREMENT BY 5;");
  });
});

describe("standalone generated column expression amendments", () => {
  it("hashes ALTER COLUMN SET EXPRESSION identically to the inline generated expression", async () => {
    const altered = await modelFromSql(
      "CREATE SCHEMA app;\nCREATE TABLE app.t (name text, slug text GENERATED ALWAYS AS (lower(name)) STORED);\nALTER TABLE app.t ALTER COLUMN slug SET EXPRESSION AS (upper(name));\n"
    );
    const inline = await modelFromSql(
      "CREATE SCHEMA app;\nCREATE TABLE app.t (name text, slug text GENERATED ALWAYS AS (upper(name)) STORED);\n"
    );

    expect(errors(altered)).toEqual([]);
    const alteredTable = altered.objects.find((object) => object.ref.kind === "table");
    const inlineTable = inline.objects.find((object) => object.ref.kind === "table");
    expect(alteredTable?.hash).toBe(inlineTable?.hash);
    expect(alteredTable?.sql).toContain("SET EXPRESSION AS (upper(name))");
    expect(alteredTable?.metadata.columns).toEqual([
      expect.objectContaining({ name: "name" }),
      expect.objectContaining({
        definition: expect.stringContaining("GENERATED ALWAYS AS (upper(name)) STORED"),
        generatedExpression: "upper(name)",
        name: "slug",
      }),
    ]);
  });

  it("hashes ALTER COLUMN DROP EXPRESSION identically to the base column", async () => {
    const dropped = await modelFromSql(
      "CREATE SCHEMA app;\nCREATE TABLE app.t (name text, slug text GENERATED ALWAYS AS (lower(name)) STORED);\nALTER TABLE app.t ALTER COLUMN slug DROP EXPRESSION IF EXISTS;\n"
    );
    const bare = await modelFromSql(
      "CREATE SCHEMA app;\nCREATE TABLE app.t (name text, slug text);\n"
    );

    const droppedTable = dropped.objects.find((object) => object.ref.kind === "table");
    const bareTable = bare.objects.find((object) => object.ref.kind === "table");
    expect(droppedTable?.hash).toBe(bareTable?.hash);
  });
});

describe("standalone partition amendments", () => {
  it("merges ATTACH PARTITION into the child table shape", async () => {
    const model = await modelFromSql(`
      CREATE SCHEMA app;
      CREATE TABLE app.events (id bigint NOT NULL, created_at date NOT NULL) PARTITION BY RANGE (created_at);
      CREATE TABLE app.events_2026_01 (id bigint NOT NULL, created_at date NOT NULL);
      ALTER TABLE ONLY app.events ATTACH PARTITION app.events_2026_01 FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
    `);

    expect(errors(model)).toEqual([]);
    const child = model.objects.find((object) => object.key === "table:app.events_2026_01");
    const shape = child?.metadata.canonicalShape;
    expect(child?.dependencies).toContain("app.events");
    expect(child?.sql).toContain("ATTACH PARTITION");
    expect(shape).toMatchObject({
      inhRelations: [
        {
          RangeVar: {
            inh: true,
            relname: "events",
            relpersistence: "p",
            schemaname: "app",
          },
        },
      ],
    });
    expect(shape).toHaveProperty("partbound");
  });

  it("orders attached partitions after their parent table even when source order is reversed", async () => {
    const from = {
      diagnostics: [],
      fingerprint: "",
      objects: [],
      source: "empty",
    };
    const to = await modelFromSql(`
      CREATE SCHEMA app;
      CREATE TABLE app.events_2026_01 (id bigint NOT NULL, created_at date NOT NULL);
      CREATE TABLE app.events (id bigint NOT NULL, created_at date NOT NULL) PARTITION BY RANGE (created_at);
      ALTER TABLE ONLY app.events ATTACH PARTITION app.events_2026_01 FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
    `);
    const sql = renderMigration(planSchemaDiff(from, to), { includeHeader: false });
    const parent = "CREATE TABLE IF NOT EXISTS app.events (";
    const child = "CREATE TABLE IF NOT EXISTS app.events_2026_01 (";
    const attach =
      "ALTER TABLE ONLY app.events ATTACH PARTITION app.events_2026_01 FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');";

    expect(sql.indexOf(parent)).toBeGreaterThanOrEqual(0);
    expect(sql.indexOf(parent)).toBeLessThan(sql.indexOf(child));
    expect(sql.indexOf(child)).toBeLessThan(sql.indexOf(attach));
  });

  it("orders attached partition constraints and indexes after the child table", async () => {
    const from = {
      diagnostics: [],
      fingerprint: "",
      objects: [],
      source: "empty",
    };
    const to = await modelFromSql(`
      CREATE SCHEMA app;
      CREATE TABLE app.events (id bigint NOT NULL, created_at date NOT NULL) PARTITION BY RANGE (created_at);
      CREATE TABLE app.events_2026_01 (id bigint NOT NULL, created_at date NOT NULL);
      ALTER TABLE ONLY app.events ATTACH PARTITION app.events_2026_01 FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
      ALTER TABLE ONLY app.events_2026_01 ADD CONSTRAINT events_2026_01_id_positive CHECK (id > 0);
      CREATE INDEX events_2026_01_created_at_idx ON app.events_2026_01 (created_at);
      ALTER TABLE app.events_2026_01 ENABLE ROW LEVEL SECURITY;
    `);
    const order = planSchemaDiff(from, to).operations.map((operation) => operation.key);
    const child = order.indexOf("table:app.events_2026_01");
    const constraint = order.indexOf("constraint:app.events_2026_01_id_positive:events_2026_01");
    const index = order.indexOf("index:app.events_2026_01_created_at_idx:events_2026_01");
    const rls = order.indexOf("rls:app.events_2026_01:events_2026_01");

    expect(child).toBeGreaterThanOrEqual(0);
    expect(constraint).toBeGreaterThanOrEqual(0);
    expect(index).toBeGreaterThanOrEqual(0);
    expect(rls).toBeGreaterThanOrEqual(0);
    expect(child).toBeLessThan(constraint);
    expect(child).toBeLessThan(index);
    expect(child).toBeLessThan(rls);
  });
});

describe("rls facet merge", () => {
  it("merges ENABLE and FORCE into one identity without duplicates", async () => {
    const model = await modelFromSql(
      "CREATE SCHEMA app;\nCREATE TABLE app.t (id bigint);\nALTER TABLE app.t ENABLE ROW LEVEL SECURITY;\nALTER TABLE ONLY app.t FORCE ROW LEVEL SECURITY;\n"
    );

    expect(errors(model)).toEqual([]);
    const rls = model.objects.filter((object) => object.ref.kind === "rls");
    expect(rls).toHaveLength(1);
    expect(rls[0]?.sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(rls[0]?.sql).toContain("FORCE ROW LEVEL SECURITY");
  });

  it.each([
    [
      "ENABLE then DISABLE",
      "ALTER TABLE app.t ENABLE ROW LEVEL SECURITY;\nALTER TABLE app.t DISABLE ROW LEVEL SECURITY;",
    ],
    [
      "FORCE then NO FORCE",
      "ALTER TABLE app.t FORCE ROW LEVEL SECURITY;\nALTER TABLE app.t NO FORCE ROW LEVEL SECURITY;",
    ],
  ])("removes the default RLS state after %s", async (_label, transitions) => {
    const model = await modelFromSql(
      `CREATE SCHEMA app;\nCREATE TABLE app.t (id bigint);\n${transitions}\n`
    );

    expect(errors(model)).toEqual([]);
    expect(model.objects.filter((object) => object.ref.kind === "rls")).toEqual([]);
  });

  it("applies RLS transitions in source order", async () => {
    const model = await modelFromSql(
      "CREATE SCHEMA app;\nCREATE TABLE app.t (id bigint);\nALTER TABLE app.t DISABLE ROW LEVEL SECURITY;\nALTER TABLE app.t FORCE ROW LEVEL SECURITY;\nALTER TABLE app.t ENABLE ROW LEVEL SECURITY;\n"
    );
    const rls = model.objects.find((object) => object.ref.kind === "rls");

    expect(errors(model)).toEqual([]);
    expect(rls?.metadata).toMatchObject({ rlsEnabled: true, rlsForced: true });
  });

  it("renders only the RLS state bit that changed", async () => {
    const before = await modelFromSql(
      "CREATE SCHEMA app;\nCREATE TABLE app.t (id bigint);\nALTER TABLE app.t ENABLE ROW LEVEL SECURITY;\nALTER TABLE app.t FORCE ROW LEVEL SECURITY;\n"
    );
    const after = await modelFromSql(
      "CREATE SCHEMA app;\nCREATE TABLE app.t (id bigint);\nALTER TABLE app.t ENABLE ROW LEVEL SECURITY;\n"
    );
    const sql = renderMigration(
      planSchemaDiff(before, after, { config: { destructiveChanges: "allow" } })
    );

    expect(sql).toContain('ALTER TABLE "app"."t" NO FORCE ROW LEVEL SECURITY;');
    expect(sql).not.toContain("DISABLE ROW LEVEL SECURITY");
  });

  it("plans no rls replace when a raw extract transition matches the catalog state", async () => {
    const sql =
      "CREATE SCHEMA app;\nCREATE TABLE app.t (id bigint);\nALTER TABLE app.t ENABLE ROW LEVEL SECURITY;\n";
    const catalogShaped = await modelFromSql(sql);
    const extracted = await extractObjectsFromSql(sql, { config: { managedSchemas: [] } });
    const extractOnly = {
      diagnostics: [],
      fingerprint: "fuzz:extract-only",
      objects: extracted.objects,
      source: "fuzz:extract-only",
    };
    const plan = planSchemaDiff(catalogShaped, extractOnly);

    expect(plan.operations.filter((operation) => operation.ref.kind === "rls")).toEqual([]);
  });

  it("still plans an rls replace when the effective state differs", async () => {
    const before = await modelFromSql(
      "CREATE SCHEMA app;\nCREATE TABLE app.t (id bigint);\nALTER TABLE app.t ENABLE ROW LEVEL SECURITY;\n"
    );
    const extracted = await extractObjectsFromSql(
      "CREATE SCHEMA app;\nCREATE TABLE app.t (id bigint);\nALTER TABLE app.t DISABLE ROW LEVEL SECURITY;\n",
      { config: { managedSchemas: [] } }
    );
    const after = {
      diagnostics: [],
      fingerprint: "fuzz:extract-only",
      objects: extracted.objects,
      source: "fuzz:extract-only",
    };
    const plan = planSchemaDiff(before, after, { config: { destructiveChanges: "allow" } });

    expect(
      plan.operations.some(
        (operation) => operation.kind === "replace" && operation.ref.kind === "rls"
      )
    ).toBe(true);
    const sql = renderMigration(plan, { includeHeader: false });
    expect(sql).toContain("DISABLE ROW LEVEL SECURITY");
  });

  it("extracts policy command and predicate metadata", async () => {
    const model = await modelFromSql(
      "CREATE SCHEMA app;\nCREATE TABLE app.accounts (id bigint, tenant_id bigint);\nALTER TABLE app.accounts ENABLE ROW LEVEL SECURITY;\nCREATE POLICY accounts_select ON app.accounts FOR SELECT TO public USING (tenant_id > 0);\nCREATE POLICY accounts_insert ON app.accounts FOR INSERT TO public;\n"
    );

    expect(errors(model)).toEqual([]);
    const policies = model.objects.filter((object) => object.ref.kind === "policy");
    expect(
      policies.map((object) => ({
        checkColumns: object.metadata.checkColumns,
        command: object.metadata.command,
        hasCheckPredicate: object.metadata.hasCheckPredicate,
        hasUsingPredicate: object.metadata.hasUsingPredicate,
        name: object.ref.name,
        usingColumns: object.metadata.usingColumns,
      }))
    ).toEqual([
      {
        checkColumns: undefined,
        command: "select",
        hasCheckPredicate: false,
        hasUsingPredicate: true,
        name: "accounts_select",
        usingColumns: ["tenant_id"],
      },
      {
        checkColumns: undefined,
        command: "insert",
        hasCheckPredicate: false,
        hasUsingPredicate: false,
        name: "accounts_insert",
        usingColumns: undefined,
      },
    ]);
  });
});

describe("comment state transitions", () => {
  it("removes a prior comment with IS NULL", async () => {
    const model = await modelFromSql(
      "CREATE SCHEMA app;\nCOMMENT ON SCHEMA app IS 'docs';\nCOMMENT ON SCHEMA app IS NULL;\n"
    );

    expect(errors(model)).toEqual([]);
    expect(model.objects.filter((object) => object.ref.kind === "comment")).toEqual([]);
  });

  it("keeps an empty-string comment as a distinct comment", async () => {
    const model = await modelFromSql(
      "CREATE SCHEMA app;\nCOMMENT ON SCHEMA app IS 'docs';\nCOMMENT ON SCHEMA app IS '';\n"
    );

    expect(errors(model)).toEqual([]);
    const comments = model.objects.filter((object) => object.ref.kind === "comment");
    expect(comments).toHaveLength(1);
    expect(comments[0]?.metadata.description).toBe("");
  });
});

describe("sequence OWNED BY amendments", () => {
  it("hashes a standalone ALTER SEQUENCE OWNED BY identically to the inline form", async () => {
    const altered = await modelFromSql(
      "CREATE SCHEMA app;\nCREATE TABLE app.t (id bigint);\nCREATE SEQUENCE app.s;\nALTER SEQUENCE app.s OWNED BY app.t.id;\n"
    );
    const inline = await modelFromSql(
      "CREATE SCHEMA app;\nCREATE TABLE app.t (id bigint);\nCREATE SEQUENCE app.s OWNED BY app.t.id;\n"
    );

    expect(errors(altered)).toEqual([]);
    const alteredSeq = altered.objects.find((object) => object.ref.kind === "sequence");
    const inlineSeq = inline.objects.find((object) => object.ref.kind === "sequence");
    expect(alteredSeq?.hash).toBe(inlineSeq?.hash);
  });

  it("renders sequence ownership after the owned table while keeping sequence defaults valid", async () => {
    const from = {
      diagnostics: [],
      fingerprint: "",
      objects: [],
      source: "empty",
    };
    const to = await modelFromSql(
      [
        "CREATE SCHEMA app;",
        "CREATE SEQUENCE app.s;",
        "CREATE TABLE app.t (id bigint);",
        "ALTER TABLE ONLY app.t ALTER COLUMN id SET DEFAULT nextval('app.s'::regclass);",
        "ALTER SEQUENCE app.s OWNED BY app.t.id;",
      ].join("\n")
    );
    const sql = renderMigration(planSchemaDiff(from, to), { includeHeader: false });
    const createSequence = 'CREATE SEQUENCE IF NOT EXISTS "app"."s"';
    const createTable = "CREATE TABLE IF NOT EXISTS app.t";
    const ownedBy = 'ALTER SEQUENCE "app"."s" OWNED BY "app"."t"."id";';

    expect(sql.indexOf(createSequence)).toBeGreaterThanOrEqual(0);
    expect(sql.indexOf(createSequence)).toBeLessThan(sql.indexOf(createTable));
    expect(sql.indexOf(createTable)).toBeLessThan(sql.indexOf(ownedBy));
  });
});

describe("schema-scoped diagnostic suppression", () => {
  const sql =
    "CREATE SCHEMA app;\nCREATE TABLE app.t (id bigint);\nDO $$ BEGIN RAISE NOTICE 'x'; END $$;\nALTER TABLE ONLY other.parent ATTACH PARTITION other.child FOR VALUES FROM (1) TO (2);\n";

  it("keeps out-of-contract findings without a schema filter", async () => {
    const model = await modelFromSql(sql);

    expect(errors(model).length).toBeGreaterThan(0);
  });

  it("suppresses findings outside an include scope", async () => {
    const root = await mkdtemp(join(tmpdir(), "supa-suppress-"));
    await writeFile(join(root, "001.sql"), sql);
    const model = await extractSourceModel(`dir:${root}`, {
      config: { schemas: { exclude: [], include: ["app"] } },
    });

    expect(errors(model)).toEqual([]);
    expect(model.objects.some((object) => object.ref.kind === "table")).toBe(true);
  });
});

describe("empty plan drift invariant", () => {
  it("flags a zero-operation plan whose fingerprints differ", async () => {
    const model = await modelFromSql("CREATE SCHEMA app;\n");
    const drifted = { ...model, fingerprint: `${model.fingerprint.slice(0, -1)}0` };

    const plan = planSchemaDiff(model, drifted);

    expect(plan.operations).toHaveLength(0);
    expect(plan.diagnostics.map((item) => item.code)).toContain("SUPA_PLAN_EMPTY_WITH_DRIFT");
  });

  it("stays silent for genuinely identical models", async () => {
    const model = await modelFromSql("CREATE SCHEMA app;\n");

    const plan = planSchemaDiff(model, model);

    expect(plan.operations).toHaveLength(0);
    expect(plan.diagnostics.map((item) => item.code)).not.toContain("SUPA_PLAN_EMPTY_WITH_DRIFT");
  });
});

describe("rls facet identity", () => {
  it("treats ALTER TABLE ONLY spelling as inert for rls state", async () => {
    const base =
      "CREATE SCHEMA app;\nCREATE TABLE app.t (id bigint);\nALTER TABLE app.t ENABLE ROW LEVEL SECURITY;\n";
    const withOnly = await modelFromSql(
      `${base}ALTER TABLE ONLY app.t FORCE ROW LEVEL SECURITY;\n`
    );
    const withoutOnly = await modelFromSql(`${base}ALTER TABLE app.t FORCE ROW LEVEL SECURITY;\n`);

    const plan = planSchemaDiff(withOnly, withoutOnly);

    expect(plan.operations).toHaveLength(0);
  });
});

describe("extension namespace filtering", () => {
  it("excludes extensions installed into excluded schemas", async () => {
    const root = await mkdtemp(join(tmpdir(), "supa-ext-exclude-"));
    await writeFile(
      join(root, "001.sql"),
      "CREATE EXTENSION IF NOT EXISTS pg_graphql WITH SCHEMA graphql;\nCREATE EXTENSION IF NOT EXISTS pgmq;\nCREATE SCHEMA app;\n"
    );
    const model = await extractSourceModel(`dir:${root}`, {
      config: { schemas: { exclude: ["graphql"], include: [] } },
    });

    const extensions = model.objects
      .filter((object) => object.ref.kind === "extension")
      .map((object) => object.ref.name);
    expect(extensions).toContain("pgmq");
    expect(extensions).not.toContain("pg_graphql");
  });

  it("keeps schema-less extensions in scope under exclusion", async () => {
    const root = await mkdtemp(join(tmpdir(), "supa-ext-keep-"));
    await writeFile(
      join(root, "001.sql"),
      "CREATE EXTENSION IF NOT EXISTS pgmq;\nCREATE SCHEMA app;\n"
    );
    const model = await extractSourceModel(`dir:${root}`, {
      config: { schemas: { exclude: ["graphql", "extensions"], include: [] } },
    });

    expect(
      model.objects.some((object) => object.ref.kind === "extension" && object.ref.name === "pgmq")
    ).toBe(true);
  });
});
