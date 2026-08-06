import { describe, expect, it } from "vitest";
import { catalogSchemaFilter, managedSchemaFilterFor } from "../../src/catalog/query.js";
import { resolveConfig } from "../../src/config/schema.js";

describe("catalog schema filtering", () => {
  it("applies configured include and exclude boundaries inside catalog SQL", () => {
    const filter = managedSchemaFilterFor(
      resolveConfig({
        schemas: {
          exclude: ["auth", "quoted'schema"],
          include: ["app", "rates"],
        },
      })
    );

    expect(filter).toContain("n.nspname in ('app', 'rates')");
    expect(filter).toContain("n.nspname not in ('auth', 'quoted''schema')");
    expect(filter).toContain("information_schema");
  });

  it("uses the query-owned filter before falling back to the platform filter", () => {
    expect(
      catalogSchemaFilter({
        schemaFilter: "n.nspname = 'app'",
      })
    ).toBe("n.nspname = 'app'");
    expect(catalogSchemaFilter({})).toContain("information_schema");
  });
});
