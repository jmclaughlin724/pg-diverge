import { describe, expect, it } from "vitest";
import type { CatalogQuery } from "../src/catalog/query.js";
import { collectTypes } from "../src/catalog/types.js";

describe("catalog type extraction", () => {
  it("records composite field dependencies from catalog OIDs", async () => {
    let calls = 0;
    const pool: CatalogQuery = {
      query(sql) {
        calls += 1;
        if (sql.includes("from pg_type t") && sql.includes("join pg_enum")) {
          return Promise.resolve({ rows: [] });
        }
        if (sql.includes("where t.typtype = 'd'")) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({
          rows: [
            {
              columns: "value text",
              dependencies: [],
              name: "summary",
              schema: "app",
            },
            {
              columns: "summary app.summary",
              dependencies: ["app.summary"],
              name: "review",
              schema: "app",
            },
          ],
        });
      },
    };

    const objects = await collectTypes(pool);

    expect(calls).toBe(3);
    expect(objects.find((object) => object.key === "type:app.summary")?.dependencies).toEqual([]);
    expect(objects.find((object) => object.key === "type:app.review")?.dependencies).toEqual([
      "app.summary",
    ]);
  });
});
