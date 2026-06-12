import type {
  Diagnostic,
  MigrationOperation,
  SchemaObject,
  SupaschemaConfig,
  TableColumn,
} from "./core.js";
import { diagnostic } from "./diagnostics.js";
import { stableJson } from "./hash.js";
import { isDestructiveAllowed } from "./planner-replace.js";

interface ColumnAlteration {
  dropDefault?: boolean;
  dropNotNull?: boolean;
  name: string;
  setDefault?: string;
  setNotNull?: boolean;
  type?: string;
}

type CanonicalColumnEntry = Record<string, unknown> & { name: string };

export function makeTableAlterOperation(
  before: SchemaObject,
  after: SchemaObject,
  config: SupaschemaConfig,
): MigrationOperation | undefined {
  if (before.ref.kind !== "table" || after.ref.kind !== "table") {
    return undefined;
  }
  const beforeShape = canonicalShape(before);
  const afterShape = canonicalShape(after);
  if (!beforeShape || !afterShape) {
    return undefined;
  }
  if (
    stableJson({ ...beforeShape, columns: undefined }) !==
    stableJson({ ...afterShape, columns: undefined })
  ) {
    return undefined;
  }
  const beforeColumns = canonicalColumns(beforeShape);
  const afterColumns = canonicalColumns(afterShape);
  if (!beforeColumns || !afterColumns) {
    return undefined;
  }
  const beforeByName = new Map(beforeColumns.map((column) => [column.name, column]));
  const afterByName = new Map(afterColumns.map((column) => [column.name, column]));
  const dropColumns = beforeColumns
    .filter((column) => !afterByName.has(column.name))
    .map((column) => column.name);
  const addColumns = tableColumns(after).filter((column) => !beforeByName.has(column.name));
  const alterColumns: ColumnAlteration[] = [];
  for (const column of afterColumns) {
    const previous = beforeByName.get(column.name);
    if (!previous || stableJson(previous) === stableJson(column)) {
      continue;
    }
    const alteration = columnAlteration(previous, column, tableColumns(after));
    if (!alteration) {
      return undefined;
    }
    alterColumns.push(alteration);
  }
  if (dropColumns.length === 0 && addColumns.length === 0 && alterColumns.length === 0) {
    return undefined;
  }
  const diagnostics: Diagnostic[] = [];
  let blocked = false;
  for (const column of addColumns) {
    const unsafeReason = unsafeAddColumnReason(column);
    if (!unsafeReason) {
      continue;
    }
    blocked = true;
    diagnostics.push(
      diagnostic("SUPA_PLAN_ADD_COLUMN_UNSAFE", "error", unsafeReason, {
        hint: "Use an explicit reviewed migration for column rewrites, backfills, constraints, or table scans.",
        ref: after.ref,
      }),
    );
  }
  const destructive =
    dropColumns.length > 0 || alterColumns.some((alteration) => alteration.type !== undefined);
  if (destructive && !isDestructiveAllowed(after.key, config)) {
    blocked = true;
    diagnostics.push(
      diagnostic(
        "SUPA_PLAN_COLUMN_ALTER_HINT_REQUIRED",
        "error",
        "column drops and type changes require an explicit destructive-change hint",
        {
          hint: `Add "${after.key}" to hints.destructive after reviewing the rendered column ALTERs.`,
          ref: after.ref,
        },
      ),
    );
  }
  return {
    after,
    before,
    blocked,
    destructive,
    diagnostics,
    key: after.key,
    kind: "alter",
    metadata: { addColumns, alterColumns, dropColumns },
    ref: after.ref,
  };
}

function columnAlteration(
  before: CanonicalColumnEntry,
  after: CanonicalColumnEntry,
  afterColumns: TableColumn[],
): ColumnAlteration | undefined {
  if (
    stableJson(before.identity ?? null) !== stableJson(after.identity ?? null) ||
    stableJson(before.generated ?? null) !== stableJson(after.generated ?? null)
  ) {
    return undefined;
  }
  const alteration: ColumnAlteration = { name: after.name };
  let facetsExplained = 0;
  let facetsChanged = 0;
  if (before.type !== after.type) {
    facetsChanged += 1;
    if (typeof after.type === "string") {
      alteration.type = after.type;
      facetsExplained += 1;
    }
  }
  if (before.notNull !== after.notNull) {
    facetsChanged += 1;
    facetsExplained += 1;
    if (after.notNull === true) {
      alteration.setNotNull = true;
    } else {
      alteration.dropNotNull = true;
    }
  }
  if (stableJson(before.default ?? null) !== stableJson(after.default ?? null)) {
    facetsChanged += 1;
    if (after.default === undefined) {
      alteration.dropDefault = true;
      facetsExplained += 1;
    } else {
      const expression = afterColumns.find(
        (column) => column.name === after.name,
      )?.defaultExpression;
      if (expression !== undefined) {
        alteration.setDefault = expression;
        facetsExplained += 1;
      }
    }
  }

  const residual = (entry: CanonicalColumnEntry) => {
    const { default: _default, notNull: _notNull, type: _type, ...rest } = entry;
    return stableJson(rest);
  };
  if (residual(before) !== residual(after)) {
    return undefined;
  }
  if (facetsChanged === 0 || facetsExplained !== facetsChanged) {
    return undefined;
  }
  return alteration;
}

function canonicalShape(object: SchemaObject): Record<string, unknown> | undefined {
  const shape = object.metadata.canonicalShape;
  return shape && typeof shape === "object" ? (shape as Record<string, unknown>) : undefined;
}

function canonicalColumns(shape: Record<string, unknown>): CanonicalColumnEntry[] | undefined {
  const columns = shape.columns;
  if (!Array.isArray(columns)) {
    return undefined;
  }
  const entries: CanonicalColumnEntry[] = [];
  for (const column of columns) {
    if (
      !column ||
      typeof column !== "object" ||
      typeof (column as { name?: unknown }).name !== "string"
    ) {
      return undefined;
    }
    entries.push(column as CanonicalColumnEntry);
  }
  return entries;
}

function tableColumns(object: SchemaObject): TableColumn[] {
  const columns = object.metadata.columns;
  if (!Array.isArray(columns)) {
    return [];
  }
  return columns.filter(
    (column): column is TableColumn =>
      Boolean(column) &&
      typeof column === "object" &&
      typeof (column as { name?: unknown }).name === "string" &&
      typeof (column as { definition?: unknown }).definition === "string",
  );
}

function unsafeAddColumnReason(column: TableColumn): string | undefined {
  if (column.identity || column.generated || column.hasInlineConstraint) {
    return `column "${column.name}" adds inline constraints or generated behavior that requires explicit review`;
  }
  if (column.notNull === true && column.hasDefault !== true) {
    return `column "${column.name}" is NOT NULL without a default and can fail on populated tables`;
  }
  return undefined;
}
