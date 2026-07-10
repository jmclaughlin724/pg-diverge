import type { SchemaShapes } from "./model.js";

export type GeneratedIdentifiers = ReadonlyMap<string, string>;

export function buildGeneratedIdentifiers(shapes: SchemaShapes): GeneratedIdentifiers {
  const identifiers = new Map<string, string>();
  const used = new Set<string>();
  const schemas = [...shapes.schemas.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  );
  for (const [schema, entry] of schemas) {
    for (const table of [...entry.tables].sort((left, right) =>
      left.name.localeCompare(right.name)
    )) {
      register(identifiers, used, schema, "table", table.name, "Row");
      register(identifiers, used, schema, "table", table.name, "Insert");
      register(identifiers, used, schema, "table", table.name, "Update");
    }
    for (const view of [...entry.views].sort((left, right) =>
      left.name.localeCompare(right.name)
    )) {
      register(identifiers, used, schema, "view", view.name, "Row");
    }
    for (const item of [...entry.enums].sort((left, right) =>
      left.name.localeCompare(right.name)
    )) {
      register(identifiers, used, schema, "enum", item.name);
    }
    for (const composite of [...entry.composites].sort((left, right) =>
      left.name.localeCompare(right.name)
    )) {
      register(identifiers, used, schema, "composite", composite.name);
    }
    const functionNames = [...new Set(entry.functions.map((fn) => fn.name))].sort((left, right) =>
      left.localeCompare(right)
    );
    for (const name of functionNames) {
      register(identifiers, used, schema, "function", name, "Args");
      register(identifiers, used, schema, "function", name, "Returns");
    }
  }
  return identifiers;
}

export function generatedIdentifier(
  identifiers: GeneratedIdentifiers,
  schema: string,
  kind: "composite" | "enum" | "function" | "table" | "view",
  name: string,
  shape?: "Args" | "Insert" | "Returns" | "Row" | "Update"
): string {
  const identifier = identifiers.get(identifierKey(schema, kind, name, shape));
  if (identifier === undefined) {
    throw new Error(`Missing generated identifier for ${schema}.${name}${shape ?? ""}`);
  }
  return identifier;
}

function register(
  identifiers: Map<string, string>,
  used: Set<string>,
  schema: string,
  kind: "composite" | "enum" | "function" | "table" | "view",
  name: string,
  shape?: "Args" | "Insert" | "Returns" | "Row" | "Update"
): void {
  const base = `${pascalCase(schema)}${pascalCase(name)}${shape ?? ""}`;
  let identifier = base;
  let suffix = 2;
  while (used.has(identifier)) {
    identifier = `${base}${suffix}`;
    suffix += 1;
  }
  used.add(identifier);
  identifiers.set(identifierKey(schema, kind, name, shape), identifier);
}

function identifierKey(
  schema: string,
  kind: string,
  name: string,
  shape: string | undefined
): string {
  return `${schema}\u0000${kind}\u0000${name}\u0000${shape ?? ""}`;
}

function pascalCase(value: string): string {
  let result = "";
  let capitalize = true;
  for (const character of value) {
    const letter = (character >= "a" && character <= "z") || (character >= "A" && character <= "Z");
    const digit = character >= "0" && character <= "9";
    if (!(letter || digit)) {
      capitalize = true;
      continue;
    }
    result += capitalize ? character.toUpperCase() : character;
    capitalize = false;
  }
  if (result.length === 0) {
    return "Unnamed";
  }
  return result[0] !== undefined && result[0] >= "0" && result[0] <= "9" ? `N${result}` : result;
}
