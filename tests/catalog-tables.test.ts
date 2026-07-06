import { describe, expect, it } from "vitest";
import type { CatalogQuery } from "../src/catalog/query.js";
import { collectTables } from "../src/catalog/tables.js";
import { finalizeObjects } from "../src/sql/facts.js";

describe("catalog table extraction", () => {
  it("models partition children with attach metadata instead of orphaning child indexes", async () => {
    const pool: CatalogQuery = {
      query(sql) {
        if (sql.includes("from pg_class c") && sql.includes("left join pg_inherits")) {
          return Promise.resolve({
            rows: [
              {
                is_partition: false,
                name: "events",
                oid: "1",
                parent_name: null,
                parent_schema: null,
                partition_bound: null,
                partition_key: "RANGE (created_at)",
                relkind: "p",
                schema: "app",
              },
              {
                is_partition: true,
                name: "events_2026_01",
                oid: "2",
                parent_name: "events",
                parent_schema: "app",
                partition_bound: "FOR VALUES FROM ('2026-01-01') TO ('2026-02-01')",
                partition_key: null,
                relkind: "r",
                schema: "app",
              },
            ],
          });
        }
        if (sql.includes("from pg_attribute a")) {
          return Promise.resolve({
            rows: [
              {
                default_expression: null,
                generated: "",
                identity: "",
                name: "id",
                not_null: true,
                oid: "1",
                type: "bigint",
              },
              {
                default_expression: null,
                generated: "",
                identity: "",
                name: "created_at",
                not_null: true,
                oid: "1",
                type: "date",
              },
              {
                default_expression: null,
                generated: "",
                identity: "",
                name: "id",
                not_null: true,
                oid: "2",
                type: "bigint",
              },
              {
                default_expression: null,
                generated: "",
                identity: "",
                name: "created_at",
                not_null: true,
                oid: "2",
                type: "date",
              },
            ],
          });
        }
        return Promise.resolve({ rows: [] });
      },
    };

    const objects = await collectTables(pool);
    const parent = objects.find((object) => object.key === "table:app.events");
    expect(parent?.sql).toContain("PARTITION BY RANGE (created_at)");

    const child = objects.find((object) => object.key === "table:app.events_2026_01");
    expect(child?.sql).toContain('ATTACH PARTITION "app"."events_2026_01"');
    expect(child?.dependencies).toContain("app.events");

    const diagnostics = await finalizeObjects(objects);
    expect(diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(parent?.metadata.canonicalShape).toMatchObject({
      partspec: {
        strategy: "PARTITION_STRATEGY_RANGE",
      },
    });
    expect(child?.metadata.partitionAttachSql).toContain("ATTACH PARTITION");
    expect(child?.metadata.canonicalShape).toMatchObject({
      inhRelations: [{ RangeVar: { relname: "events", schemaname: "app" } }],
    });
  });
});
