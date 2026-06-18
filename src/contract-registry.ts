import type { Diagnostic } from "./core.js";
import { diagnostic } from "./diagnostics.js";
import { validateIntake } from "./intake.js";
import { isSchemaContract, type SchemaContract } from "./schema-contract.js";
import { diffTypeContract } from "./type-contract.js";
import type { SchemaEntry, SchemaShapes } from "./typegen-model.js";

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

export function contractDrift(previous: unknown, next: unknown): Diagnostic[] {
  const intake = [
    ...validateIntake(previous, { label: "previous contract", requiredKeys: ["schemas"] }),
    ...validateIntake(next, { label: "candidate contract", requiredKeys: ["schemas"] }),
  ];
  if (intake.length > 0) {
    return intake;
  }
  if (!isSchemaContract(previous)) {
    return [
      diagnostic(
        "SUPA_INTAKE_MALFORMED",
        "error",
        "previous contract payload must match the schema contract shape"
      ),
    ];
  }
  if (!isSchemaContract(next)) {
    return [
      diagnostic(
        "SUPA_INTAKE_MALFORMED",
        "error",
        "candidate contract payload must match the schema contract shape"
      ),
    ];
  }
  return diffTypeContract(fromContract(previous), fromContract(next));
}
