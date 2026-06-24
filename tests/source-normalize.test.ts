import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planSchemaDiff } from "../src/planner/schema.js";
import { extractSourceModel, filterModelBySchemas } from "../src/source/extract.js";

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

  it("keeps duplicate diagnostics when grant options conflict", async () => {
    const model = await modelFromSql(
      "CREATE SCHEMA app;\nCREATE TABLE app.t (id bigint);\nGRANT SELECT ON TABLE app.t TO PUBLIC;\nGRANT INSERT ON TABLE app.t TO PUBLIC WITH GRANT OPTION;\n"
    );

    expect(errors(model).map((item) => item.code)).toContain("SUPA_EXTRACT_DUPLICATE_OBJECT");
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
