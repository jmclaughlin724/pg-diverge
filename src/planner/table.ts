import type {
  Diagnostic,
  MigrationCorpus,
  MigrationOperation,
  SchemaObject,
  SupaschemaConfig,
  TableColumn,
} from "../core.js";
import { diagnostic } from "../diagnostics.js";
import { stableJson } from "../hash.js";
import { destructiveAllowedDisposition } from "./replace.js";

interface ColumnAlteration {
  addIdentity?: string;
  addIdentitySql?: string;
  dropDefault?: boolean;
  dropGenerated?: boolean;
  dropIdentity?: boolean;
  dropNotNull?: boolean;
  name: string;
  setDefault?: string;
  setIdentity?: string;
  setIdentitySql?: string;
  setNotNull?: boolean;
  type?: string;
}

interface TableColumnDelta extends Record<string, unknown> {
  addColumns: TableColumn[];
  alterColumns: ColumnAlteration[];
  attachPartitionSql?: string;
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
  config: SupaschemaConfig,
  migrationCorpus?: MigrationCorpus
): MigrationOperation | undefined {
  if (before.ref.kind !== "table" || after.ref.kind !== "table") {
    return;
  }
  const beforeShape = canonicalShape(before);
  const afterShape = canonicalShape(after);
  if (!(beforeShape && afterShape)) {
    return;
  }
  const attachPartitionSql = partitionAttachSql(beforeShape, afterShape, after);
  if (!restChangeCanUseTableAlterLane(beforeShape, afterShape, attachPartitionSql)) {
    return;
  }
  const beforeColumns = canonicalColumns(beforeShape);
  const afterColumns = canonicalColumns(afterShape);
  if (!(beforeColumns && afterColumns)) {
    return;
  }
  const delta = tableColumnDelta(beforeColumns, afterColumns, tableColumns(after), {
    ...(attachPartitionSql ? { attachPartitionSql } : {}),
    identitySqlByColumn: identitySqlByColumn(after),
  });
  if (!delta) {
    return;
  }
  if (deltaIsEmpty(delta)) {
    return;
  }
  const diagnostics: Diagnostic[] = [];
  const unsafeAddColumnDiagnostics = addColumnUnsafeDiagnostics(delta.addColumns, after);
  let blocked = unsafeAddColumnDiagnostics.length > 0;
  diagnostics.push(...unsafeAddColumnDiagnostics);
  const destructive =
    delta.dropColumns.length > 0 ||
    delta.alterColumns.some((alteration) => alteration.type !== undefined);
  const destructiveDisposition = destructive
    ? tableDestructiveDisposition(after.key, delta, config, migrationCorpus)
    : undefined;
  const hasTypeChange = delta.alterColumns.some((alteration) => alteration.type !== undefined);
  const hasIdentityChange = delta.alterColumns.some(
    (alteration) =>
      alteration.addIdentity !== undefined ||
      alteration.dropIdentity === true ||
      alteration.setIdentity !== undefined
  );
  const hasGeneratedChange = delta.alterColumns.some(
    (alteration) => alteration.dropGenerated === true
  );
  diagnostics.push(
    ...columnAlterReviewDiagnostics(after, { hasGeneratedChange, hasIdentityChange, hasTypeChange })
  );
  const dataTransitionDiagnostics = missingDataTransitionDiagnostics(delta, after, migrationCorpus);
  if (dataTransitionDiagnostics.length > 0) {
    blocked = true;
    diagnostics.push(...dataTransitionDiagnostics);
  }
  if (destructive && !destructiveDisposition) {
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
    metadata: tableAlterMetadata(delta, destructive, blocked, destructiveDisposition),
    ref: after.ref,
  };
}

function addColumnUnsafeDiagnostics(
  columns: readonly TableColumn[],
  table: SchemaObject
): Diagnostic[] {
  return columns.flatMap((column) => {
    const unsafeReason = unsafeAddColumnReason(column);
    return unsafeReason
      ? [
          diagnostic("SUPA_PLAN_ADD_COLUMN_UNSAFE", "error", unsafeReason, {
            hint: "Use an explicit reviewed migration for column rewrites, backfills, constraints, or table scans.",
            ref: table.ref,
          }),
        ]
      : [];
  });
}

function columnAlterReviewDiagnostics(
  table: SchemaObject,
  changes: { hasGeneratedChange: boolean; hasIdentityChange: boolean; hasTypeChange: boolean }
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (changes.hasTypeChange) {
    diagnostics.push(
      diagnostic(
        "SUPA_PLAN_COLUMN_TYPE_USING_REVIEW",
        "warning",
        "column type change renders an identity USING cast; replace the USING expression for non-assignment-cast conversions",
        {
          hint: "PostgreSQL rejects ALTER COLUMN TYPE ... USING col::newtype when no assignment cast exists; edit the rendered USING expression after review.",
          ref: table.ref,
        }
      )
    );
  }
  if (changes.hasIdentityChange) {
    diagnostics.push(
      diagnostic(
        "SUPA_PLAN_COLUMN_IDENTITY_REVIEW",
        "warning",
        "column identity generation changed; review the rendered ALTER COLUMN identity statement",
        {
          hint: "PostgreSQL identity actions affect future generated values and do not recurse to descendants; verify the target column and sequence options.",
          ref: table.ref,
        }
      )
    );
  }
  if (changes.hasGeneratedChange) {
    diagnostics.push(
      diagnostic(
        "SUPA_PLAN_COLUMN_GENERATED_REVIEW",
        "warning",
        "generated column expression changed; review lock and rewrite impact before deploy",
        {
          hint: "PostgreSQL rewrites stored generated column values when SET EXPRESSION changes; run ANALYZE after deploy when needed.",
          ref: table.ref,
        }
      )
    );
  }
  return diagnostics;
}

function missingDataTransitionDiagnostics(
  delta: TableColumnDelta,
  table: SchemaObject,
  migrationCorpus: MigrationCorpus | undefined
): Diagnostic[] {
  if (!(delta.dropColumns.length > 0 && delta.addColumns.length > 0)) {
    return [];
  }
  const hasDataIntent = migrationCorpus?.operations.some(
    (operation) => operation.kind === "data-statement" || operation.kind === "do-block"
  );
  if (hasDataIntent) {
    return [];
  }
  return [
    diagnostic(
      "SUPA_PLAN_DATA_TRANSITION_REQUIRED",
      "error",
      "column drop plus column add looks like a storage transition without reviewed data intent",
      {
        hint: "Add reviewed backfill/transition DML or a DO block to the migration corpus, or use an explicit reviewed migration.",
        ref: table.ref,
      }
    ),
  ];
}

function tableAlterMetadata(
  delta: TableColumnDelta,
  destructive: boolean,
  blocked: boolean,
  destructiveDisposition: string | undefined
): Record<string, unknown> {
  if (!destructive) {
    return delta;
  }
  return { ...delta, destructiveDisposition: blocked ? "blocked" : destructiveDisposition };
}

function tableDestructiveDisposition(
  tableKey: string,
  delta: TableColumnDelta,
  config: SupaschemaConfig,
  migrationCorpus: MigrationCorpus | undefined
): "destructive-config" | "destructive-hint" | "migration-intent" | undefined {
  const configDisposition = destructiveAllowedDisposition(tableKey, config);
  if (configDisposition) {
    return configDisposition;
  }
  if (delta.alterColumns.some((alteration) => alteration.type !== undefined)) {
    return;
  }
  if (delta.dropColumns.length === 0) {
    return;
  }
  const intendedDrops = new Set(migrationCorpus?.tableColumnDrops ?? []);
  return delta.dropColumns.every((column) =>
    intendedDrops.has(tableColumnDropKey(tableKey, column))
  )
    ? "migration-intent"
    : undefined;
}

function tableColumnDropKey(tableKey: string, column: string): string {
  return `${tableKey}.${column}`;
}

function tableColumnDelta(
  beforeColumns: CanonicalColumnEntry[],
  afterColumns: CanonicalColumnEntry[],
  renderedAfterColumns: TableColumn[],
  options: {
    attachPartitionSql?: string;
    identitySqlByColumn: Map<string, string>;
  }
): TableColumnDelta | undefined {
  const beforeByName = new Map(beforeColumns.map((column) => [column.name, column]));
  const afterByName = new Map(afterColumns.map((column) => [column.name, column]));
  const dropColumns = beforeColumns
    .filter((column) => !afterByName.has(column.name))
    .map((column) => column.name);
  const addColumns = renderedAfterColumns.filter((column) => !beforeByName.has(column.name));
  const alterColumns = changedColumnAlterations(
    beforeByName,
    afterColumns,
    renderedAfterColumns,
    options.identitySqlByColumn
  );
  const delta = alterColumns ? { addColumns, alterColumns, dropColumns } : undefined;
  return delta && options.attachPartitionSql
    ? { ...delta, attachPartitionSql: options.attachPartitionSql }
    : delta;
}

function changedColumnAlterations(
  beforeByName: Map<string, CanonicalColumnEntry>,
  afterColumns: CanonicalColumnEntry[],
  renderedAfterColumns: TableColumn[],
  identitySqlByColumn: Map<string, string>
): ColumnAlteration[] | undefined {
  const alterations: ColumnAlteration[] = [];
  for (const column of afterColumns) {
    const previous = beforeByName.get(column.name);
    if (!previous || stableJson(previous) === stableJson(column)) {
      continue;
    }
    const alteration = columnAlteration(
      previous,
      column,
      renderedAfterColumns,
      identitySqlByColumn
    );
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
    delta.alterColumns.length === 0 &&
    delta.attachPartitionSql === undefined
  );
}

function columnAlteration(
  before: CanonicalColumnEntry,
  after: CanonicalColumnEntry,
  afterColumns: TableColumn[],
  identitySqlByColumn: Map<string, string>
): ColumnAlteration | undefined {
  const alteration: ColumnAlteration = { name: after.name };
  const facets = [
    explainIdentityFacet(before, after, identitySqlByColumn, alteration),
    explainGeneratedFacet(before, after, alteration),
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

function explainGeneratedFacet(
  before: CanonicalColumnEntry,
  after: CanonicalColumnEntry,
  alteration: ColumnAlteration
): ColumnFacetChange {
  if (stableJson(before.generated ?? null) === stableJson(after.generated ?? null)) {
    return { changed: false, explained: false };
  }
  if (after.generated === undefined) {
    alteration.dropGenerated = true;
    return { changed: true, explained: true };
  }
  if (before.generated === undefined) {
    return { changed: true, explained: false };
  }
  return { changed: true, explained: false };
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

function explainIdentityFacet(
  before: CanonicalColumnEntry,
  after: CanonicalColumnEntry,
  identitySqlByColumn: Map<string, string>,
  alteration: ColumnAlteration
): ColumnFacetChange {
  const sql = identitySqlByColumn.get(after.name);
  if (stableJson(before.identity ?? null) === stableJson(after.identity ?? null)) {
    if (sql && stableJson(before.identitySql ?? null) !== stableJson(after.identitySql ?? null)) {
      alteration.setIdentitySql = sql;
      return { changed: true, explained: true };
    }
    return { changed: false, explained: false };
  }
  if (after.identity === undefined) {
    alteration.dropIdentity = true;
    return { changed: true, explained: true };
  }
  if (typeof after.identity !== "string") {
    return { changed: true, explained: false };
  }
  if (before.identity === undefined) {
    alteration.addIdentity = after.identity;
    if (sql) {
      alteration.addIdentitySql = sql;
    }
  } else {
    alteration.setIdentity = after.identity;
    if (sql) {
      alteration.setIdentitySql = sql;
    }
  }
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
  const {
    default: _default,
    generated: _generated,
    identity: _identity,
    identitySql: _identitySql,
    notNull: _notNull,
    type: _type,
    ...rest
  } = entry;
  return stableJson(rest);
}

function partitionAttachSql(
  beforeShape: Record<string, unknown>,
  afterShape: Record<string, unknown>,
  after: SchemaObject
): string | undefined {
  if (
    beforeShape.partbound !== undefined ||
    beforeShape.inhRelations !== undefined ||
    afterShape.partbound === undefined ||
    afterShape.inhRelations === undefined
  ) {
    return;
  }
  const sql = after.metadata.partitionAttachSql;
  return typeof sql === "string" && sql.length > 0 ? sql : undefined;
}

function restChangeCanUseTableAlterLane(
  beforeShape: Record<string, unknown>,
  afterShape: Record<string, unknown>,
  attachPartitionSql: string | undefined
): boolean {
  const restChanged =
    stableJson({ ...beforeShape, columns: undefined }) !==
    stableJson({ ...afterShape, columns: undefined });
  return (
    !restChanged ||
    (attachPartitionSql !== undefined && onlyPartitionAttachRestChanged(beforeShape, afterShape))
  );
}

function onlyPartitionAttachRestChanged(
  beforeShape: Record<string, unknown>,
  afterShape: Record<string, unknown>
): boolean {
  return (
    stableJson(restWithoutColumnsOrPartitionAttach(beforeShape)) ===
    stableJson(restWithoutColumnsOrPartitionAttach(afterShape))
  );
}

function restWithoutColumnsOrPartitionAttach(
  shape: Record<string, unknown>
): Record<string, unknown> {
  const { columns: _columns, inhRelations: _inhRelations, partbound: _partbound, ...rest } = shape;
  return rest;
}

function canonicalShape(object: SchemaObject): Record<string, unknown> | undefined {
  return recordFromObject(object.metadata.canonicalShape);
}

function canonicalColumns(shape: Record<string, unknown>): CanonicalColumnEntry[] | undefined {
  const columns = shape.columns;
  if (!Array.isArray(columns)) {
    return;
  }
  const entries: CanonicalColumnEntry[] = [];
  for (const column of columns) {
    const record = recordFromObject(column);
    if (!record || typeof record.name !== "string") {
      return;
    }
    entries.push({ ...record, name: record.name });
  }
  return entries;
}

function tableColumns(object: SchemaObject): TableColumn[] {
  const columns = object.metadata.columns;
  if (!Array.isArray(columns)) {
    return [];
  }
  const result: TableColumn[] = [];
  for (const column of columns) {
    const entry = tableColumnFromMetadata(column);
    if (entry) {
      result.push(entry);
    }
  }
  return result;
}

function tableColumnFromMetadata(column: unknown): TableColumn | undefined {
  const record = recordFromObject(column);
  if (!record || typeof record.name !== "string" || typeof record.definition !== "string") {
    return;
  }
  const entry: TableColumn = { definition: record.definition, name: record.name };
  if (typeof record.defaultExpression === "string") {
    entry.defaultExpression = record.defaultExpression;
  }
  if (record.generated === "stored" || record.generated === "virtual") {
    entry.generated = record.generated;
  }
  if (typeof record.generatedExpression === "string") {
    entry.generatedExpression = record.generatedExpression;
  }
  if (record.hasDefault === true) {
    entry.hasDefault = true;
  }
  if (record.hasInlineConstraint === true) {
    entry.hasInlineConstraint = true;
  }
  if (record.identity === "always" || record.identity === "by-default") {
    entry.identity = record.identity;
  }
  if (record.notNull === true) {
    entry.notNull = true;
  }
  if (typeof record.type === "string") {
    entry.type = record.type;
  }
  return entry;
}

function identitySqlByColumn(object: SchemaObject): Map<string, string> {
  const raw = recordFromObject(object.metadata.columnIdentitySqlByColumn);
  const map = new Map<string, string>();
  if (!raw) {
    return map;
  }
  for (const [column, sql] of Object.entries(raw)) {
    if (typeof sql === "string") {
      map.set(column, sql);
    }
  }
  return map;
}

function recordFromObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return;
  }
  return Object.fromEntries(Object.entries(value));
}

function unsafeAddColumnReason(column: TableColumn): string | undefined {
  if (column.notNull === true && column.hasDefault !== true) {
    return `column "${column.name}" is NOT NULL without a default and can fail on populated tables`;
  }
  if (column.hasInlineConstraint === true) {
    return `column "${column.name}" has an inline validating constraint and can fail on populated tables`;
  }
  return;
}
