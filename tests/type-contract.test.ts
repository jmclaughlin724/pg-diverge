import { describe, expect, it } from "vitest";
import { diffTypeContract } from "../src/type-contract.js";
import type { ColumnShape, SchemaEntry, SchemaShapes, TableShape } from "../src/typegen-model.js";

function column(name: string, type: string, notNull = false): ColumnShape {
  return { name, notNull, type };
}

function table(name: string, columns: ColumnShape[]): TableShape {
  return { columns, name, relationships: [], uniqueColumnSets: [] };
}

function entry(parts: {
  enums?: { name: string; values: string[] }[];
  tables?: TableShape[];
}): SchemaEntry {
  return {
    composites: [],
    enums: parts.enums ?? [],
    functions: [],
    tables: parts.tables ?? [],
    views: [],
  };
}

function shapes(schemas: Record<string, SchemaEntry>): SchemaShapes {
  return {
    compositesByBareName: new Map(),
    compositesByQualifiedName: new Map(),
    domains: new Map(),
    enumsByBareName: new Map(),
    enumsByQualifiedName: new Map(),
    schemas: new Map(Object.entries(schemas)),
  };
}

const usersWith = (columns: ColumnShape[]): SchemaShapes =>
  shapes({ public: entry({ tables: [table("users", columns)] }) });

describe("type-contract diff (P10)", () => {
  it("flags a removed table as breaking (error)", () => {
    const before = usersWith([column("id", "number")]);
    const after = shapes({ public: entry({ tables: [] }) });
    const diagnostics = diffTypeContract(before, after);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("SUPA_TYPE_TABLE_REMOVED");
    expect(diagnostics[0]?.severity).toBe("error");
  });

  it("flags a removed column", () => {
    const before = usersWith([column("id", "number"), column("email", "string")]);
    const after = usersWith([column("id", "number")]);
    const diagnostics = diffTypeContract(before, after);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("SUPA_TYPE_COLUMN_REMOVED");
  });

  it("flags a changed column type", () => {
    const before = usersWith([column("id", "number")]);
    const after = usersWith([column("id", "string")]);
    const diagnostics = diffTypeContract(before, after);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("SUPA_TYPE_COLUMN_TYPE_CHANGED");
  });

  it("flags a changed column nullability", () => {
    const before = usersWith([column("name", "string", true)]);
    const after = usersWith([column("name", "string", false)]);
    const diagnostics = diffTypeContract(before, after);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("SUPA_TYPE_COLUMN_NULLABILITY_CHANGED");
  });

  it("treats an added column as non-breaking (silent)", () => {
    const before = usersWith([column("id", "number")]);
    const after = usersWith([column("id", "number"), column("email", "string")]);
    expect(diffTypeContract(before, after)).toHaveLength(0);
  });

  it("flags a removed enum value", () => {
    const before = shapes({ public: entry({ enums: [{ name: "status", values: ["a", "b"] }] }) });
    const after = shapes({ public: entry({ enums: [{ name: "status", values: ["a"] }] }) });
    const diagnostics = diffTypeContract(before, after);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("SUPA_TYPE_ENUM_VALUE_REMOVED");
  });

  it("flags a fully removed enum as breaking", () => {
    const before = shapes({ public: entry({ enums: [{ name: "status", values: ["a", "b"] }] }) });
    const after = shapes({ public: entry({ enums: [] }) });
    const diagnostics = diffTypeContract(before, after);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("SUPA_TYPE_ENUM_REMOVED");
  });
});
