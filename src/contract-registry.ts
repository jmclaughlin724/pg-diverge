import type { Diagnostic } from "./core.js";
import { validateIntake } from "./intake.js";
import { diffTypeContract } from "./type-contract.js";
import type { SchemaEntry, SchemaShapes, TableShape } from "./typegen-model.js";

export interface SchemaContract {
  schemas: Record<string, { enums: { name: string; values: string[] }[]; tables: TableShape[] }>;
}

export function toContract(shapes: SchemaShapes): SchemaContract {
  const schemas: SchemaContract["schemas"] = {};
  for (const [name, entry] of shapes.schemas) {
    schemas[name] = { enums: entry.enums, tables: entry.tables };
  }
  return { schemas };
}

function emptyShapes(schemas: Map<string, SchemaEntry>): SchemaShapes {
  return {
    compositesByBareName: new Map(),
    compositesByQualifiedName: new Map(),
    domains: new Map(),
    enumsByBareName: new Map(),
    enumsByQualifiedName: new Map(),
    schemas,
  };
}

function fromContract(contract: SchemaContract): SchemaShapes {
  const schemas = new Map<string, SchemaEntry>();
  for (const [name, entry] of Object.entries(contract.schemas)) {
    schemas.set(name, {
      composites: [],
      enums: entry.enums,
      functions: [],
      tables: entry.tables,
      views: [],
    });
  }
  return emptyShapes(schemas);
}

export function contractDrift(previous: SchemaContract, next: SchemaContract): Diagnostic[] {
  const intake = [
    ...validateIntake(previous, { label: "previous contract", requiredKeys: ["schemas"] }),
    ...validateIntake(next, { label: "candidate contract", requiredKeys: ["schemas"] }),
  ];
  if (intake.length > 0) {
    return intake;
  }
  return diffTypeContract(fromContract(previous), fromContract(next));
}
