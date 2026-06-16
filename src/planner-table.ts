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

interface TableColumnDelta extends Record<string, unknown> {
  addColumns: TableColumn[];
  alterColumns: ColumnAlteration[];
  dropColumns: string[];
}

interface ColumnFacetChange {
  changed: boolean;
  explained: boolean;
}

type CanonicalColumnEntry = Record<string, unknown> & { name: string };

export function makeTableAlterOperation(
  before: SchemaObject,
  after: SchemaObject,
  config: SupaschemaConfig
): MigrationOperation | undefined {
  if (before.ref.kind !== "table" || after.ref.kind !== "table") {
    return;
  }
  const beforeShape = canonicalShape(before);
  const afterShape = canonicalShape(after);
  if (!(beforeShape && afterShape)) {
    return;
  }
  if (
    stableJson({ ...beforeShape, columns: undefined }) !==
    stableJson({ ...afterShape, columns: undefined })
  ) {
    return;
  }
  const beforeColumns = canonicalColumns(beforeShape);
  const afterColumns = canonicalColumns(afterShape);
  if (!(beforeColumns && afterColumns)) {
    return;
  }
  const delta = tableColumnDelta(beforeColumns, afterColumns, tableColumns(after));
  if (!delta) {
    return;
  }
  if (deltaIsEmpty(delta)) {
    return;
  }
  const diagnostics: Diagnostic[] = [];
  let blocked = false;
  for (const column of delta.addColumns) {
    const unsafeReason = unsafeAddColumnReason(column);
    if (!unsafeReason) {
      continue;
    }
    blocked = true;
    diagnostics.push(
      diagnostic("SUPA_PLAN_ADD_COLUMN_UNSAFE", "error", unsafeReason, {
        hint: "Use an explicit reviewed migration for column rewrites, backfills, constraints, or table scans.",
        ref: after.ref,
      })
    );
  }
  const destructive =
    delta.dropColumns.length > 0 ||
    delta.alterColumns.some((alteration) => alteration.type !== undefined);
  const hasTypeChange = delta.alterColumns.some((alteration) => alteration.type !== undefined);
  if (hasTypeChange) {
    diagnostics.push(
      diagnostic(
        "SUPA_PLAN_COLUMN_TYPE_USING_REVIEW",
        "warning",
        "column type change renders an identity USING cast; replace the USING expression for non-assignment-cast conversions",
        {
          hint: "PostgreSQL rejects ALTER COLUMN TYPE ... USING col::newtype when no assignment cast exists; edit the rendered USING expression after review.",
          ref: after.ref,
        }
      )
    );
  }
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
        }
      )
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
    metadata: delta,
    ref: after.ref,
  };
}

function tableColumnDelta(
  beforeColumns: CanonicalColumnEntry[],
  afterColumns: CanonicalColumnEntry[],
  renderedAfterColumns: TableColumn[]
): TableColumnDelta | undefined {
  const beforeByName = new Map(beforeColumns.map((column) => [column.name, column]));
  const afterByName = new Map(afterColumns.map((column) => [column.name, column]));
  const dropColumns = beforeColumns
    .filter((column) => !afterByName.has(column.name))
    .map((column) => column.name);
  const addColumns = renderedAfterColumns.filter((column) => !beforeByName.has(column.name));
  const alterColumns = changedColumnAlterations(beforeByName, afterColumns, renderedAfterColumns);
  return alterColumns ? { addColumns, alterColumns, dropColumns } : undefined;
}

function changedColumnAlterations(
  beforeByName: Map<string, CanonicalColumnEntry>,
  afterColumns: CanonicalColumnEntry[],
  renderedAfterColumns: TableColumn[]
): ColumnAlteration[] | undefined {
  const alterations: ColumnAlteration[] = [];
  for (const column of afterColumns) {
    const previous = beforeByName.get(column.name);
    if (!previous || stableJson(previous) === stableJson(column)) {
      continue;
    }
    const alteration = columnAlteration(previous, column, renderedAfterColumns);
    if (!alteration) {
      return;
    }
    alterations.push(alteration);
  }
  return alterations;
}

function deltaIsEmpty(delta: TableColumnDelta): boolean {
  return (
    delta.dropColumns.length === 0 &&
    delta.addColumns.length === 0 &&
    delta.alterColumns.length === 0
  );
}

function columnAlteration(
  before: CanonicalColumnEntry,
  after: CanonicalColumnEntry,
  afterColumns: TableColumn[]
): ColumnAlteration | undefined {
  if (
    stableJson(before.identity ?? null) !== stableJson(after.identity ?? null) ||
    stableJson(before.generated ?? null) !== stableJson(after.generated ?? null)
  ) {
    return;
  }
  const alteration: ColumnAlteration = { name: after.name };
  const facets = [
    explainTypeFacet(before, after, alteration),
    explainNotNullFacet(before, after, alteration),
    explainDefaultFacet(before, after, afterColumns, alteration),
  ];

  if (residual(before) !== residual(after)) {
    return;
  }
  if (!facetsFullyExplained(facets)) {
    return;
  }
  return alteration;
}

function explainTypeFacet(
  before: CanonicalColumnEntry,
  after: CanonicalColumnEntry,
  alteration: ColumnAlteration
): ColumnFacetChange {
  if (before.type === after.type) {
    return { changed: false, explained: false };
  }
  if (typeof after.type !== "string") {
    return { changed: true, explained: false };
  }
  alteration.type = after.type;
  return { changed: true, explained: true };
}

function explainNotNullFacet(
  before: CanonicalColumnEntry,
  after: CanonicalColumnEntry,
  alteration: ColumnAlteration
): ColumnFacetChange {
  if (before.notNull === after.notNull) {
    return { changed: false, explained: false };
  }
  if (after.notNull === true) {
    alteration.setNotNull = true;
  } else {
    alteration.dropNotNull = true;
  }
  return { changed: true, explained: true };
}

function explainDefaultFacet(
  before: CanonicalColumnEntry,
  after: CanonicalColumnEntry,
  afterColumns: TableColumn[],
  alteration: ColumnAlteration
): ColumnFacetChange {
  if (stableJson(before.default ?? null) === stableJson(after.default ?? null)) {
    return { changed: false, explained: false };
  }
  if (after.default === undefined) {
    alteration.dropDefault = true;
    return { changed: true, explained: true };
  }
  const expression = afterColumns.find((column) => column.name === after.name)?.defaultExpression;
  if (expression === undefined) {
    return { changed: true, explained: false };
  }
  alteration.setDefault = expression;
  return { changed: true, explained: true };
}

function facetsFullyExplained(facets: ColumnFacetChange[]): boolean {
  const changed = facets.filter((facet) => facet.changed);
  return changed.length > 0 && changed.every((facet) => facet.explained);
}

function residual(entry: CanonicalColumnEntry): string {
  const { default: _default, notNull: _notNull, type: _type, ...rest } = entry;
  return stableJson(rest);
}

function canonicalShape(object: SchemaObject): Record<string, unknown> | undefined {
  const shape = object.metadata.canonicalShape;
  return shape && typeof shape === "object" ? (shape as Record<string, unknown>) : undefined;
}

function canonicalColumns(shape: Record<string, unknown>): CanonicalColumnEntry[] | undefined {
  const columns = shape.columns;
  if (!Array.isArray(columns)) {
    return;
  }
  const entries: CanonicalColumnEntry[] = [];
  for (const column of columns) {
    if (
      !column ||
      typeof column !== "object" ||
      typeof (column as { name?: unknown }).name !== "string"
    ) {
      return;
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
      typeof (column as { definition?: unknown }).definition === "string"
  );
}

function unsafeAddColumnReason(column: TableColumn): string | undefined {
  if (column.identity || column.generated || column.hasInlineConstraint) {
    return `column "${column.name}" adds inline constraints or generated behavior that requires explicit review`;
  }
  if (column.notNull === true && column.hasDefault !== true) {
    return `column "${column.name}" is NOT NULL without a default and can fail on populated tables`;
  }
  return;
}
