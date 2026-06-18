import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planSchemaDiff } from "../src/planner.js";
import { extractSourceModel } from "../src/source.js";

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
