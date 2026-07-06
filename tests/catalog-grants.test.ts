import { describe, expect, it } from "vitest";
import { collectDefaultPrivileges } from "../src/catalog/grants.js";
import type { CatalogQuery } from "../src/catalog/query.js";

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
});
