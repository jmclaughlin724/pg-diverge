import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveConfig } from "../../src/config/schema.js";
import { diffTypeContract } from "../../src/contract/type-diff.js";
import { evaluateTypeContract, runTypeSafetyGate } from "../../src/pipeline/type-safety.js";
import type {
  ColumnShape,
  SchemaEntry,
  SchemaShapes,
  TableShape,
} from "../../src/typegen/model.js";

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

async function sqlSource(sql: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "supa-type-contract-"));
  await writeFile(join(root, "001.sql"), sql);
  return `dir:${root}`;
}

async function migrationSource(sql: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "supa-type-contract-migrations-"));
  await writeFile(join(root, "20260101000000_schema.sql"), sql);
  return `migrations:${root}`;
}

describe("type-safety deploy gate", () => {
  it("evaluates migrations replay sources for drift", async () => {
    const config = resolveConfig();
    const fromSource = await migrationSource(
      "CREATE TABLE public.users (id bigint, email text);\n"
    );
    const toSource = await sqlSource("CREATE TABLE public.users (id bigint);\n");

    const result = await evaluateTypeContract({
      config,
      fromSource,
      toSource,
    });

    expect(result.sourceDiagnostics).toEqual([]);
    expect(result.diagnostics.map((item) => item.code)).toContain("SUPA_TYPE_COLUMN_REMOVED");
  });

  it("blocks deploy when configured as deploy_blocking", async () => {
    const fromSource = await sqlSource("CREATE TABLE public.users (id bigint, email text);\n");
    const toSource = await sqlSource("CREATE TABLE public.users (id bigint);\n");
    const config = resolveConfig({
      sources: { from: fromSource },
      workflow: { type_safety: "deploy_blocking" },
    });

    const result = await runTypeSafetyGate({ config, toSource });

    expect(result.blocked).toBe(true);
    expect(result.blockingDiagnostics.map((item) => item.code)).toContain(
      "SUPA_TYPE_COLUMN_REMOVED"
    );
    expect(
      result.diagnostics.find((item) => item.code === "SUPA_TYPE_COLUMN_REMOVED")?.severity
    ).toBe("error");
  });

  it("keeps diagnostics nonblocking when configured as report_only", async () => {
    const fromSource = await sqlSource("CREATE TABLE public.users (id bigint, email text);\n");
    const toSource = await sqlSource("CREATE TABLE public.users (id bigint);\n");
    const config = resolveConfig({
      sources: { from: fromSource },
      workflow: { type_safety: "report_only" },
    });

    const result = await runTypeSafetyGate({ config, toSource });

    expect(result.blocked).toBe(false);
    expect(result.blockingDiagnostics).toHaveLength(0);
    expect(
      result.diagnostics.find((item) => item.code === "SUPA_TYPE_COLUMN_REMOVED")?.severity
    ).toBe("warning");
  });
});
