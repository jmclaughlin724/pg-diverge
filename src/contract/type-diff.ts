import type { Diagnostic, ObjectKind } from "../core.js";
import type { SchemaEntry, SchemaShapes, TableShape } from "../typegen/model.js";

function breaking(
  code: string,
  kind: ObjectKind,
  schema: string,
  name: string,
  detail: string
): Diagnostic {
  return {
    code,
    hint: "Downstream TypeScript/Zod consumers break on this change",
    message: `Breaking type-contract change: ${detail}`,
    ref: { kind, name, schema },
    severity: "error",
  };
}

function diffColumns(schema: string, before: TableShape, after: TableShape): Diagnostic[] {
  const afterColumns = new Map(after.columns.map((column) => [column.name, column]));
  const diagnostics: Diagnostic[] = [];
  for (const column of before.columns) {
    const afterColumn = afterColumns.get(column.name);
    if (afterColumn === undefined) {
      diagnostics.push(
        breaking(
          "SUPA_TYPE_COLUMN_REMOVED",
          "table",
          schema,
          before.name,
          `column "${before.name}.${column.name}" was removed`
        )
      );
    } else if (afterColumn.type !== column.type) {
      diagnostics.push(
        breaking(
          "SUPA_TYPE_COLUMN_TYPE_CHANGED",
          "table",
          schema,
          before.name,
          `column "${before.name}.${column.name}" type changed: ${column.type} -> ${afterColumn.type}`
        )
      );
    } else if (afterColumn.notNull !== column.notNull) {
      diagnostics.push(
        breaking(
          "SUPA_TYPE_COLUMN_NULLABILITY_CHANGED",
          "table",
          schema,
          before.name,
          `column "${before.name}.${column.name}" nullability changed: ${column.notNull ? "NOT NULL" : "nullable"} -> ${afterColumn.notNull ? "NOT NULL" : "nullable"}`
        )
      );
    }
  }
  return diagnostics;
}

function diffTables(
  schema: string,
  before: SchemaEntry,
  after: SchemaEntry | undefined
): Diagnostic[] {
  const afterTables = new Map<string, TableShape>((after?.tables ?? []).map((t) => [t.name, t]));
  const diagnostics: Diagnostic[] = [];
  for (const table of before.tables) {
    const afterTable = afterTables.get(table.name);
    if (afterTable === undefined) {
      diagnostics.push(
        breaking(
          "SUPA_TYPE_TABLE_REMOVED",
          "table",
          schema,
          table.name,
          `table "${table.name}" was removed`
        )
      );
      continue;
    }
    diagnostics.push(...diffColumns(schema, table, afterTable));
  }
  return diagnostics;
}

function diffEnums(
  schema: string,
  before: SchemaEntry,
  after: SchemaEntry | undefined
): Diagnostic[] {
  const afterEnums = new Map((after?.enums ?? []).map((entry) => [entry.name, entry]));
  const diagnostics: Diagnostic[] = [];
  for (const enumEntry of before.enums) {
    const afterEnum = afterEnums.get(enumEntry.name);
    if (afterEnum === undefined) {
      diagnostics.push(
        breaking(
          "SUPA_TYPE_ENUM_REMOVED",
          "enum",
          schema,
          enumEntry.name,
          `enum "${enumEntry.name}" was removed`
        )
      );
      continue;
    }
    for (const value of enumEntry.values) {
      if (!afterEnum.values.includes(value)) {
        diagnostics.push(
          breaking(
            "SUPA_TYPE_ENUM_VALUE_REMOVED",
            "enum",
            schema,
            enumEntry.name,
            `enum value "${value}" was removed from "${enumEntry.name}"`
          )
        );
      }
    }
  }
  return diagnostics;
}

export function diffTypeContract(before: SchemaShapes, after: SchemaShapes): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const [schema, beforeEntry] of before.schemas) {
    const afterEntry = after.schemas.get(schema);
    diagnostics.push(...diffTables(schema, beforeEntry, afterEntry));
    diagnostics.push(...diffEnums(schema, beforeEntry, afterEntry));
  }
  return diagnostics;
}
