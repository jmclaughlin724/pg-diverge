import { describe, expect, it } from "vitest";
import { contractDrift, type SchemaContract, toContract } from "../../src/contract/schema.js";
import type { SchemaShapes, TableShape } from "../../src/typegen/model.js";

const usersTable: TableShape = {
  checkConstraints: [],
  columns: [{ name: "id", notNull: true, type: "number" }],
  name: "users",
  relationships: [],
  uniqueColumnSets: [],
};

function contract(tables: TableShape[]): SchemaContract {
  return { schemas: { public: { enums: [], tables } } };
}

describe("schema contracts (X51)", () => {
  it("flags a removed table as cross-repo drift", () => {
    const drift = contractDrift(contract([usersTable]), contract([]));
    expect(drift).toHaveLength(1);
    expect(drift[0]?.code).toBe("SUPA_TYPE_TABLE_REMOVED");
  });

  it("reports no drift for an identical contract", () => {
    const stored = contract([usersTable]);
    expect(contractDrift(stored, stored)).toHaveLength(0);
  });

  it("projects shapes into a JSON-serializable contract", () => {
    const collatedUsersTable: TableShape = {
      ...usersTable,
      columns: [
        { collation: "public.case_insensitive", name: "id", notNull: true, type: "number" },
      ],
    };
    const shapes: SchemaShapes = {
      compositesByBareName: new Map(),
      compositesByQualifiedName: new Map(),
      domains: new Map([["public.user_id", { baseType: "integer", checkConstraints: [] }]]),
      enumsByBareName: new Map(),
      enumsByQualifiedName: new Map(),
      schemas: new Map([
        [
          "public",
          { composites: [], enums: [], functions: [], tables: [collatedUsersTable], views: [] },
        ],
      ]),
    };
    const projected = toContract(shapes);
    expect(JSON.stringify(projected)).toContain("users");
    expect(projected.schemas.public?.tables).toHaveLength(1);
    expect(projected.schemas.public?.tables[0]?.columns).toEqual([
      { name: "id", notNull: true, type: "number" },
    ]);
  });
});
