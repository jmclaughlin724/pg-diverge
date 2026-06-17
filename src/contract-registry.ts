import type { Diagnostic } from "./core.js";
import { diffTypeContract } from "./type-contract.js";
import type { SchemaEntry, SchemaShapes, TableShape } from "./typegen-model.js";

/**
 * Cross-repo schema-contract registry core (plan `50-expansion.md`, task X51). A
 * published "contract" is the JSON-serializable subset of `SchemaShapes` the
 * type-contract diff consumes (schemas → tables + enums). `contractDrift` runs the
 * same `diffTypeContract` breaking-change check across two stored contracts, so a
 * downstream repo can gate against an upstream's published schema. This is the
 * storable/diffable core; the hosted store + HTTP transport are the deploy-gated
 * wrapper and are not built here (no hosting in this repo).
 */

export interface SchemaContract {
  schemas: Record<string, { enums: { name: string; values: string[] }[]; tables: TableShape[] }>;
}

/** Project the diff-relevant subset of `SchemaShapes` into a JSON-serializable contract. */
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

/** Breaking changes from a previously published contract to a candidate one. */
export function contractDrift(previous: SchemaContract, next: SchemaContract): Diagnostic[] {
  return diffTypeContract(fromContract(previous), fromContract(next));
}
