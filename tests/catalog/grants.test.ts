import { describe, expect, it } from "vitest";
import { collectDefaultPrivileges, collectGrants } from "../../src/catalog/grants.js";
import type { CatalogQuery } from "../../src/catalog/query.js";
import { extractObjectsFromSql } from "../../src/sql/extract.js";

type GrantQueryName = "column" | "function" | "relation" | "revoked-functions" | "schema" | "type";

interface CatalogCall {
  name: GrantQueryName;
  sql: string;
}

function grantQueryName(sql: string): GrantQueryName {
  if (sql.includes("lateral aclexplode(c.relacl)")) {
    return "relation";
  }
  if (sql.includes("lateral aclexplode(a.attacl)")) {
    return "column";
  }
  if (sql.includes("lateral aclexplode(n.nspacl)")) {
    return "schema";
  }
  if (sql.includes("lateral aclexplode(p.proacl)")) {
    return "function";
  }
  if (sql.includes("from pg_proc p")) {
    return "revoked-functions";
  }
  if (sql.includes("lateral aclexplode(t.typacl)")) {
    return "type";
  }
  throw new Error(`Unexpected catalog query: ${sql}`);
}

function grantPool(
  fixtures: Partial<Record<GrantQueryName, Record<string, unknown>[]>>,
  calls: CatalogCall[] = []
): { calls: CatalogCall[]; pool: CatalogQuery } {
  return {
    calls,
    pool: {
      query(sql: string) {
        const name = grantQueryName(sql);
        calls.push({ name, sql });
        return Promise.resolve({ rows: fixtures[name] ?? [] });
      },
    },
  };
}

describe("catalog grant extraction", () => {
  it("collects relation then column ACLs and merges scoped privileges", async () => {
    const { calls, pool } = grantPool({
      column: [
        {
          columns: ["name", "id"],
          grantee: "app_user",
          is_grantable: false,
          name: "items",
          privilege: "SELECT",
          relkind: "r",
          schema: "app",
        },
      ],
      relation: [
        {
          grantee: "app_user",
          is_grantable: false,
          name: "items",
          privileges: ["INSERT"],
          relkind: "r",
          schema: "app",
        },
      ],
    });

    const objects = await collectGrants(pool);

    expect(calls.map((call) => call.name)).toEqual([
      "relation",
      "column",
      "schema",
      "function",
      "revoked-functions",
      "type",
    ]);
    const relationSql = calls.find((call) => call.name === "relation")?.sql ?? "";
    expect(relationSql).toContain("c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')");
    expect(relationSql).toContain("i.objsubid = 0");
    expect(relationSql).toContain("ia.grantor = acl.grantor");
    expect(relationSql).toContain("ia.grantee = acl.grantee");
    expect(relationSql).toContain("ia.privilege_type = acl.privilege_type");
    expect(relationSql).toContain("ia.is_grantable = acl.is_grantable");

    const columnSql = calls.find((call) => call.name === "column")?.sql ?? "";
    expect(columnSql).toContain("a.attnum > 0");
    expect(columnSql).toContain("not a.attisdropped");
    expect(columnSql).toContain("i.objsubid = a.attnum");
    expect(columnSql).toContain("ia.grantor = acl.grantor");
    expect(columnSql).toContain("ia.grantee = acl.grantee");
    expect(columnSql).toContain("ia.privilege_type = acl.privilege_type");
    expect(columnSql).toContain("ia.is_grantable = acl.is_grantable");

    expect(objects).toHaveLength(1);
    expect(objects[0]?.metadata).toMatchObject({
      columnPrivileges: { SELECT: ["id", "name"] },
      grantee: "app_user",
      privileges: ["INSERT", "SELECT"],
      withGrantOption: false,
    });
    expect(objects[0]?.sql).toBe(
      'GRANT INSERT, SELECT ("id", "name") ON TABLE "app"."items" TO "app_user"'
    );
  });

  it("lets an object-wide privilege dominate its column-scoped form", async () => {
    const { pool } = grantPool({
      column: [
        {
          columns: ["id"],
          grantee: "app_user",
          is_grantable: false,
          name: "items",
          privilege: "SELECT",
          relkind: "r",
          schema: "app",
        },
      ],
      relation: [
        {
          grantee: "app_user",
          is_grantable: false,
          name: "items",
          privileges: ["SELECT"],
          relkind: "r",
          schema: "app",
        },
      ],
    });

    const [grant] = await collectGrants(pool);

    expect(grant?.metadata.privileges).toEqual(["SELECT"]);
    expect(grant?.metadata).not.toHaveProperty("columnPrivileges");
    expect(grant?.sql).toBe('GRANT SELECT ON TABLE "app"."items" TO "app_user"');
  });

  it("canonicalizes expanded catalog column ACLs like a declared GRANT ALL", async () => {
    const columns = ["name", "id"];
    const { pool } = grantPool({
      column: ["INSERT", "REFERENCES", "SELECT", "UPDATE"].map((privilege) => ({
        columns,
        grantee: "app_user",
        is_grantable: false,
        name: "items",
        privilege,
        relkind: "r",
        schema: "app",
      })),
    });

    const [catalogGrant] = await collectGrants(pool);
    const declared = await extractObjectsFromSql(
      "GRANT ALL (id, name) ON TABLE app.items TO app_user;"
    );
    const [declaredGrant] = declared.objects;

    expect(declared.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(catalogGrant?.metadata).toMatchObject({
      columnPrivileges: declaredGrant?.metadata.columnPrivileges,
      privileges: declaredGrant?.metadata.privileges,
    });
    expect(catalogGrant?.sql).toBe(declaredGrant?.sql);
  });

  it("preserves uniform grant options for every positive ACL kind", async () => {
    const { pool } = grantPool({
      function: [
        {
          args: "integer",
          grantee: "app_user",
          is_grantable: true,
          name: "run_task",
          privileges: ["EXECUTE"],
          schema: "app",
        },
      ],
      relation: [
        {
          grantee: "app_user",
          is_grantable: true,
          name: "remote_items",
          privileges: ["SELECT"],
          relkind: "f",
          schema: "app",
        },
      ],
      schema: [
        {
          grantee: "app_user",
          is_grantable: true,
          name: "app",
          privileges: ["USAGE"],
        },
      ],
      type: [
        {
          grantee: "app_user",
          is_grantable: true,
          name: "status",
          privileges: ["USAGE"],
          schema: "app",
          typtype: "e",
        },
      ],
    });

    const objects = await collectGrants(pool);

    expect(objects).toHaveLength(4);
    expect(objects.every((object) => object.metadata.withGrantOption === true)).toBe(true);
    expect(objects.every((object) => object.sql.endsWith(" WITH GRANT OPTION"))).toBe(true);
    expect(
      objects.find((object) => object.metadata.targetIdentity === "app.remote_items")?.sql
    ).toBe('GRANT SELECT ON TABLE "app"."remote_items" TO "app_user" WITH GRANT OPTION');
  });

  it("rejects mixed grant-option states for one semantic grant", async () => {
    const { pool } = grantPool({
      relation: [
        {
          grantee: "app_user",
          is_grantable: false,
          name: "items",
          privileges: ["INSERT"],
          relkind: "r",
          schema: "app",
        },
        {
          grantee: "app_user",
          is_grantable: true,
          name: "items",
          privileges: ["SELECT"],
          relkind: "r",
          schema: "app",
        },
      ],
    });

    await expect(collectGrants(pool)).rejects.toThrow("mixed grant-option states");
  });
});

describe("catalog default privilege extraction", () => {
  it("filters extension-owned default ACL rows through pg_depend", async () => {
    const calls: string[] = [];
    const pool: CatalogQuery = {
      query(sql) {
        calls.push(sql);
        return Promise.resolve({ rows: [] });
      },
    };

    await collectDefaultPrivileges(pool);

    expect(calls).toHaveLength(2);
    expect(
      calls.every((sql) => sql.includes("ext_member.classid = 'pg_default_acl'::regclass"))
    ).toBe(true);
    expect(calls.every((sql) => sql.includes("ext.extnamespace = d.defaclnamespace"))).toBe(true);
  });

  it("rejects default ACL grant options that the model cannot preserve", async () => {
    const pool: CatalogQuery = {
      query(sql: string) {
        if (!sql.includes("lateral aclexplode(d.defaclacl)")) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({
          rows: [
            {
              for_role: "app_owner",
              grantee: "app_user",
              is_grantable: true,
              objtype: "r",
              privileges: ["SELECT"],
              schema: "app",
            },
          ],
        });
      },
    };

    await expect(collectDefaultPrivileges(pool)).rejects.toThrow(
      "uses a grant option that cannot be represented safely"
    );
  });
});
