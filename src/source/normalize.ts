import type { Diagnostic, SchemaObject } from "../core.js";
import { stringArray } from "../core.js";
import { diagnostic } from "../diagnostics.js";
import { suppressDefaultAclImpliedGrants } from "../grants/default-acl.js";
import { asRecord } from "../sql/ast.js";
import { finalizeObject } from "../sql/facts.js";
import { shapeHash, stripLocations } from "../sql/object-hash.js";
import {
  buildDefaultPrivilegeObject,
  buildGrantObject,
  builtinPublicDefault,
  isBuiltinDefaultGrant,
} from "../sql/privileges.js";
import { expressionSql, makeObject } from "../sql/statements.js";
import { canonicalizeRegclassLiterals } from "../sql/table-shape.js";

export interface SourceNormalizeOptions {
  normalize?: boolean;
}

export async function normalizeSourceObjects(
  objects: SchemaObject[],
  diagnostics: Diagnostic[],
  options: SourceNormalizeOptions = {}
): Promise<SchemaObject[]> {
  const afterDefaults = applyColumnDefaultAmendments(objects, diagnostics);
  const afterIdentity = applyColumnIdentityAmendments(afterDefaults, diagnostics);
  const afterGenerated = applyColumnGeneratedAmendments(afterIdentity, diagnostics);
  const afterPartitions = applyTablePartitionAmendments(afterGenerated, diagnostics);
  const afterOwnedBy = applySequenceOwnedByAmendments(afterPartitions, diagnostics);
  const afterRls = await mergeRlsFacets(afterOwnedBy, options);
  const merged = await mergeSplitPrivileges(afterRls, options);
  return suppressDefaultAclImpliedGrants(suppressDefaultEqualPrivileges(merged));
}

function suppressDefaultEqualPrivileges(objects: SchemaObject[]): SchemaObject[] {
  const grantsByTarget = collectGrantsByTarget(objects);
  const nettedAway = defaultEqualPrivilegesToSuppress(objects, grantsByTarget);
  return objects.filter((object) => keepDefaultEqualPrivilege(object, nettedAway));
}

function collectGrantsByTarget(objects: SchemaObject[]): Map<string, SchemaObject[]> {
  const grantsByTarget = new Map<string, SchemaObject[]>();
  for (const object of objects) {
    if (isPrivilegeObject(object) && object.metadata.verb === "GRANT") {
      const key = privilegeTargetKey(object);
      const group = grantsByTarget.get(key) ?? [];
      group.push(object);
      grantsByTarget.set(key, group);
    }
  }
  return grantsByTarget;
}

function defaultEqualPrivilegesToSuppress(
  objects: SchemaObject[],
  grantsByTarget: Map<string, SchemaObject[]>
): Set<SchemaObject> {
  const nettedAway = new Set<SchemaObject>();
  for (const object of objects) {
    markDefaultEqualPrivilege(object, grantsByTarget, nettedAway);
  }
  return nettedAway;
}

function markDefaultEqualPrivilege(
  object: SchemaObject,
  grantsByTarget: Map<string, SchemaObject[]>,
  nettedAway: Set<SchemaObject>
): void {
  if (!isRevokedPrivilegeObject(object) || isBuiltinPublicRevoke(object)) {
    return;
  }
  const counterparts = grantsByTarget.get(privilegeTargetKey(object)) ?? [];
  if (counterparts.length === 0 || object.ordinal < latestOrdinal(counterparts)) {
    nettedAway.add(object);
    return;
  }
  const privileges = metadataPrivileges(object.metadata);
  if (privileges.includes("ALL") || coversAllGrants(privileges, counterparts)) {
    nettedAway.add(object);
    for (const counterpart of counterparts) {
      nettedAway.add(counterpart);
    }
  }
}

function keepDefaultEqualPrivilege(object: SchemaObject, nettedAway: Set<SchemaObject>): boolean {
  if (nettedAway.has(object)) {
    return false;
  }
  if (!isPrivilegeObject(object) || object.metadata.verb !== "GRANT") {
    return true;
  }
  const meta = object.metadata;
  const grantee = typeof meta.grantee === "string" ? meta.grantee : "";
  return !isBuiltinDefaultGrant(metadataKindPhrase(meta), grantee, metadataPrivileges(meta));
}

function isPrivilegeObject(object: SchemaObject): boolean {
  return object.ref.kind === "grant" || object.ref.kind === "default-privilege";
}

function isRevokedPrivilegeObject(object: SchemaObject): boolean {
  return isPrivilegeObject(object) && object.metadata.verb === "REVOKE";
}

function isBuiltinPublicRevoke(object: SchemaObject): boolean {
  const grantee = typeof object.metadata.grantee === "string" ? object.metadata.grantee : "";
  return (
    builtinPublicDefault(metadataKindPhrase(object.metadata)) !== undefined && grantee === "PUBLIC"
  );
}

function metadataPrivileges(meta: Record<string, unknown>): string[] {
  return stringArray(meta.privileges) ?? [];
}

function latestOrdinal(objects: SchemaObject[]): number {
  return Math.max(...objects.map((item) => item.ordinal));
}

function metadataKindPhrase(meta: Record<string, unknown>): string {
  if (typeof meta.kindPhrase === "string") {
    return meta.kindPhrase;
  }
  if (typeof meta.objectType === "string") {
    return meta.objectType;
  }
  return "";
}

function coversAllGrants(revoked: string[], grants: SchemaObject[]): boolean {
  const revokedSet = new Set(revoked);
  return grants.every((grant) => {
    const granted = stringArray(grant.metadata.privileges) ?? [];
    return granted.every((privilege) => revokedSet.has(privilege) || privilege === "ALL");
  });
}

function privilegeTargetKey(object: SchemaObject): string {
  const meta = object.metadata;
  return [
    object.ref.kind,
    typeof meta.kindPhrase === "string" ? meta.kindPhrase : String(meta.objectType ?? ""),
    typeof meta.targetIdentity === "string" ? meta.targetIdentity : String(meta.schema ?? ""),
    typeof meta.forRole === "string" ? meta.forRole : "",
    typeof meta.grantee === "string" ? meta.grantee : "",
  ].join("|");
}

interface ColumnDefaultAmendment {
  column: string;
  expression: unknown;
}

interface ColumnDefaultShapeColumn extends Record<string, unknown> {
  name: string;
}

interface ColumnIdentityAmendment {
  action: "add" | "drop" | "set";
  column: string;
  identity?: string;
}

interface ColumnGeneratedAmendment {
  action: "drop" | "set";
  column: string;
  expression: unknown;
}

interface TablePartitionAmendment {
  bound: unknown;
  parent: {
    name: string;
    schema?: string;
  };
}

function columnDefaultAmendment(object: SchemaObject): ColumnDefaultAmendment | undefined {
  const raw = asRecord(object.metadata.columnDefaultAmendment);
  if (!raw) {
    return;
  }
  const column = raw.column;
  if (typeof column !== "string" || column.length === 0) {
    return;
  }
  return { column, expression: raw.expression ?? null };
}

function columnDefaultColumns(value: unknown): ColumnDefaultShapeColumn[] | undefined {
  if (!Array.isArray(value)) {
    return;
  }
  const columns: ColumnDefaultShapeColumn[] = [];
  for (const item of value) {
    const record = asRecord(item);
    if (!record || typeof record.name !== "string") {
      return;
    }
    columns.push({ ...record, name: record.name });
  }
  return columns;
}

function updateTableColumnMetadata(
  table: SchemaObject,
  columnName: string,
  canonicalColumn: ColumnDefaultShapeColumn,
  overrides: { defaultExpression?: string; generatedExpression?: string } = {}
): Record<string, unknown> {
  const columns = metadataColumns(table.metadata.columns);
  const columnIndex = columns?.findIndex((item) => item.name === columnName) ?? -1;
  if (!(columns && columnIndex >= 0)) {
    return table.metadata;
  }
  const nextColumns = [...columns];
  const current = nextColumns[columnIndex];
  if (!current) {
    return table.metadata;
  }
  nextColumns[columnIndex] = renderColumnMetadata(current, canonicalColumn, overrides);
  return { ...table.metadata, columns: nextColumns };
}

function metadataColumns(value: unknown): ColumnDefaultShapeColumn[] | undefined {
  return columnDefaultColumns(value);
}

function renderColumnMetadata(
  current: ColumnDefaultShapeColumn,
  canonicalColumn: ColumnDefaultShapeColumn,
  overrides: { defaultExpression?: string; generatedExpression?: string }
): ColumnDefaultShapeColumn {
  let next: ColumnDefaultShapeColumn = {
    ...current,
    notNull: canonicalColumn.notNull === true,
  };
  if (typeof canonicalColumn.type === "string") {
    next.type = canonicalColumn.type;
  }
  if (canonicalColumn.default === undefined) {
    const {
      defaultExpression: _defaultExpression,
      hasDefault: _hasDefault,
      ...withoutDefault
    } = next;
    next = withoutDefault;
  } else {
    next.hasDefault = true;
    if (overrides.defaultExpression !== undefined) {
      next.defaultExpression = overrides.defaultExpression;
    }
  }
  if (canonicalColumn.identity === undefined) {
    const { identity: _identity, ...withoutIdentity } = next;
    next = withoutIdentity;
  } else {
    next.identity = true;
  }
  if (canonicalColumn.generated === undefined) {
    const {
      generated: _generated,
      generatedExpression: _generatedExpression,
      ...withoutGenerated
    } = next;
    next = withoutGenerated;
  } else {
    next.generated = true;
    if (overrides.generatedExpression !== undefined) {
      next.generatedExpression = overrides.generatedExpression;
    }
  }
  const definition = columnDefinitionFromMetadata(next, canonicalColumn);
  if (definition !== undefined) {
    next.definition = definition;
  }
  return next;
}

function columnDefinitionFromMetadata(
  column: ColumnDefaultShapeColumn,
  canonicalColumn: ColumnDefaultShapeColumn
): string | undefined {
  const type = typeof column.type === "string" ? column.type : undefined;
  if (!type) {
    return typeof column.definition === "string" ? column.definition : undefined;
  }
  let definition = type;
  if (canonicalColumn.generated !== undefined && typeof column.generatedExpression === "string") {
    definition += ` GENERATED ALWAYS AS (${column.generatedExpression}) STORED`;
  } else if (typeof canonicalColumn.identity === "string") {
    definition += ` GENERATED ${identityGenerationSql(canonicalColumn.identity)} AS IDENTITY`;
  } else if (
    canonicalColumn.default !== undefined &&
    typeof column.defaultExpression === "string"
  ) {
    definition += ` DEFAULT ${column.defaultExpression}`;
  }
  if (canonicalColumn.notNull === true) {
    definition += " NOT NULL";
  }
  return definition;
}

function identityGenerationSql(value: string): string {
  return value === "d" ? "BY DEFAULT" : "ALWAYS";
}

function columnIdentityAmendment(object: SchemaObject): ColumnIdentityAmendment | undefined {
  const raw = asRecord(object.metadata.columnIdentityAmendment);
  if (!raw) {
    return;
  }
  const action = raw.action;
  const column = raw.column;
  const identity = raw.identity;
  if (
    !(action === "add" || action === "drop" || action === "set") ||
    typeof column !== "string" ||
    column.length === 0
  ) {
    return;
  }
  return {
    action,
    column,
    ...(identity === "a" || identity === "d" ? { identity } : {}),
  };
}

function columnGeneratedAmendment(object: SchemaObject): ColumnGeneratedAmendment | undefined {
  const raw = asRecord(object.metadata.columnGeneratedAmendment);
  if (!raw) {
    return;
  }
  const action = raw.action;
  const column = raw.column;
  if (
    !(action === "drop" || action === "set") ||
    typeof column !== "string" ||
    column.length === 0
  ) {
    return;
  }
  return { action, column, expression: raw.expression ?? null };
}

function tablePartitionAmendment(object: SchemaObject): TablePartitionAmendment | undefined {
  const raw = asRecord(object.metadata.tablePartitionAmendment);
  const parent = asRecord(raw?.parent);
  if (!(raw && parent) || typeof parent.name !== "string") {
    return;
  }
  const schema = typeof parent.schema === "string" ? parent.schema : undefined;
  return {
    bound: raw.bound ?? null,
    parent: {
      name: parent.name,
      ...(schema ? { schema } : {}),
    },
  };
}

function identityForAmendment(
  amendment: ColumnIdentityAmendment,
  column: ColumnDefaultShapeColumn
): string | undefined {
  if (amendment.identity !== undefined) {
    return amendment.identity;
  }
  if (amendment.action === "add") {
    return "a";
  }
  return typeof column.identity === "string" ? column.identity : undefined;
}

function unsupportedIdentityAmendmentDiagnostic(marker: SchemaObject): Diagnostic {
  return diagnostic(
    "SUPA_EXTRACT_UNSUPPORTED",
    "error",
    "ALTER COLUMN IDENTITY sequence options target a non-identity column in the source model",
    { file: marker.file, ref: marker.ref, statement: marker.sql }
  );
}

function isTableAmendmentMarker(object: SchemaObject): boolean {
  return (
    columnDefaultAmendment(object) !== undefined ||
    columnIdentityAmendment(object) !== undefined ||
    columnGeneratedAmendment(object) !== undefined ||
    tablePartitionAmendment(object) !== undefined
  );
}

function tableObjectsByKey(objects: SchemaObject[]): Map<string, SchemaObject> {
  const tablesByKey = new Map<string, SchemaObject>();
  for (const object of objects) {
    if (object.ref.kind === "table" && !isTableAmendmentMarker(object)) {
      tablesByKey.set(object.key, object);
    }
  }
  return tablesByKey;
}

function applyColumnDefaultAmendments(
  objects: SchemaObject[],
  diagnostics: Diagnostic[]
): SchemaObject[] {
  const markers = objects.filter((object) => columnDefaultAmendment(object) !== undefined);
  if (markers.length === 0) {
    return objects;
  }
  const tablesByKey = tableObjectsByKey(objects);
  for (const marker of markers) {
    const amendment = columnDefaultAmendment(marker);
    const table = tablesByKey.get(marker.key);
    const shape = asRecord(table?.metadata.canonicalShape);
    const columns = columnDefaultColumns(shape?.columns);
    const columnIndex = columns?.findIndex((item) => item.name === amendment?.column) ?? -1;
    if (!(table && shape && columns && columnIndex >= 0 && amendment)) {
      diagnostics.push(
        diagnostic(
          "SUPA_EXTRACT_UNSUPPORTED",
          "error",
          "ALTER COLUMN DEFAULT targets a table or column not present in the source model",
          { file: marker.file, ref: marker.ref, statement: marker.sql }
        )
      );
      continue;
    }
    const column = columns[columnIndex];
    if (column === undefined) {
      continue;
    }
    const nextColumns = [...columns];
    let defaultExpression: string | undefined;
    if (amendment.expression === null) {
      const { default: _default, ...withoutDefault } = column;
      nextColumns[columnIndex] = withoutDefault;
    } else {
      defaultExpression = expressionSql(amendment.expression);
      nextColumns[columnIndex] = {
        ...column,
        default: canonicalizeRegclassLiterals(stripLocations(amendment.expression)),
      };
    }
    const nextShape = { ...shape, columns: nextColumns };
    table.metadata = {
      ...updateTableColumnMetadata(table, amendment.column, nextColumns[columnIndex] ?? column, {
        ...(defaultExpression === undefined ? {} : { defaultExpression }),
      }),
      canonicalShape: nextShape,
    };
    table.hash = shapeHash(nextShape, table.key, table.ref);
    table.sql = `${table.sql};\n${marker.sql}`;
    table.dependencies = mergedDependencies([table, marker]);
  }
  return objects.filter((object) => columnDefaultAmendment(object) === undefined);
}

function applyColumnIdentityAmendments(
  objects: SchemaObject[],
  diagnostics: Diagnostic[]
): SchemaObject[] {
  const markers = objects.filter((object) => columnIdentityAmendment(object) !== undefined);
  if (markers.length === 0) {
    return objects;
  }
  const tablesByKey = tableObjectsByKey(objects);
  for (const marker of markers) {
    const amendment = columnIdentityAmendment(marker);
    const table = tablesByKey.get(marker.key);
    const shape = asRecord(table?.metadata.canonicalShape);
    const columns = columnDefaultColumns(shape?.columns);
    const columnIndex = columns?.findIndex((item) => item.name === amendment?.column) ?? -1;
    if (!(table && shape && columns && columnIndex >= 0 && amendment)) {
      diagnostics.push(
        diagnostic(
          "SUPA_EXTRACT_UNSUPPORTED",
          "error",
          "ALTER COLUMN IDENTITY targets a table or column not present in the source model",
          { file: marker.file, ref: marker.ref, statement: marker.sql }
        )
      );
      continue;
    }
    const column = columns[columnIndex];
    if (column === undefined) {
      continue;
    }
    const nextColumns = [...columns];
    if (amendment.action === "drop") {
      const { identity: _identity, ...withoutIdentity } = column;
      nextColumns[columnIndex] = withoutIdentity;
    } else {
      const identity = identityForAmendment(amendment, column);
      if (identity === undefined) {
        diagnostics.push(unsupportedIdentityAmendmentDiagnostic(marker));
        continue;
      }
      const { default: _default, ...withoutDefault } = column;
      nextColumns[columnIndex] = {
        ...withoutDefault,
        identity,
      };
    }
    const nextShape = { ...shape, columns: nextColumns };
    table.metadata = {
      ...updateTableColumnMetadata(table, amendment.column, nextColumns[columnIndex] ?? column),
      canonicalShape: nextShape,
      columnIdentitySqlByColumn: {
        ...asRecord(table.metadata.columnIdentitySqlByColumn),
        [amendment.column]: marker.sql,
      },
    };
    table.hash = shapeHash(nextShape, table.key, table.ref);
    table.sql = `${table.sql};\n${marker.sql}`;
    table.dependencies = mergedDependencies([table, marker]);
  }
  return objects.filter((object) => columnIdentityAmendment(object) === undefined);
}

function applyColumnGeneratedAmendments(
  objects: SchemaObject[],
  diagnostics: Diagnostic[]
): SchemaObject[] {
  const markers = objects.filter((object) => columnGeneratedAmendment(object) !== undefined);
  if (markers.length === 0) {
    return objects;
  }
  const tablesByKey = tableObjectsByKey(objects);
  for (const marker of markers) {
    const amendment = columnGeneratedAmendment(marker);
    const table = tablesByKey.get(marker.key);
    const shape = asRecord(table?.metadata.canonicalShape);
    const columns = columnDefaultColumns(shape?.columns);
    const columnIndex = columns?.findIndex((item) => item.name === amendment?.column) ?? -1;
    if (!(table && shape && columns && columnIndex >= 0 && amendment)) {
      diagnostics.push(
        diagnostic(
          "SUPA_EXTRACT_UNSUPPORTED",
          "error",
          "ALTER COLUMN EXPRESSION targets a table or column not present in the source model",
          { file: marker.file, ref: marker.ref, statement: marker.sql }
        )
      );
      continue;
    }
    const column = columns[columnIndex];
    if (column === undefined) {
      continue;
    }
    const nextColumns = [...columns];
    const generatedExpressions = {
      ...asRecord(table.metadata.columnGeneratedExpressionSqlByColumn),
    };
    if (amendment.action === "drop") {
      const { generated: _generated, ...withoutGenerated } = column;
      nextColumns[columnIndex] = withoutGenerated;
      delete generatedExpressions[amendment.column];
    } else {
      const sql = expressionSql(amendment.expression);
      if (sql === undefined) {
        diagnostics.push(
          diagnostic(
            "SUPA_EXTRACT_UNSUPPORTED",
            "error",
            "ALTER COLUMN SET EXPRESSION could not be rendered from the parsed expression",
            { file: marker.file, ref: marker.ref, statement: marker.sql }
          )
        );
        continue;
      }
      const { default: _default, identity: _identity, ...withoutDefaultOrIdentity } = column;
      nextColumns[columnIndex] = {
        ...withoutDefaultOrIdentity,
        generated: stripLocations(amendment.expression),
      };
      generatedExpressions[amendment.column] = sql;
    }
    const nextShape = { ...shape, columns: nextColumns };
    const generatedExpression = generatedExpressions[amendment.column];
    table.metadata = {
      ...updateTableColumnMetadata(table, amendment.column, nextColumns[columnIndex] ?? column, {
        ...(generatedExpression === undefined
          ? {}
          : { generatedExpression: String(generatedExpression) }),
      }),
      canonicalShape: nextShape,
      columnGeneratedExpressionSqlByColumn: generatedExpressions,
    };
    table.hash = shapeHash(nextShape, table.key, table.ref);
    table.sql = `${table.sql};\n${marker.sql}`;
    table.dependencies = mergedDependencies([table, marker]);
  }
  return objects.filter((object) => columnGeneratedAmendment(object) === undefined);
}

function applyTablePartitionAmendments(
  objects: SchemaObject[],
  diagnostics: Diagnostic[]
): SchemaObject[] {
  const markers = objects.filter((object) => tablePartitionAmendment(object) !== undefined);
  if (markers.length === 0) {
    return objects;
  }
  const tablesByKey = tableObjectsByKey(objects);
  for (const marker of markers) {
    const amendment = tablePartitionAmendment(marker);
    const table = tablesByKey.get(marker.key);
    const shape = asRecord(table?.metadata.canonicalShape);
    if (!(table && shape && amendment)) {
      diagnostics.push(
        diagnostic(
          "SUPA_EXTRACT_UNSUPPORTED",
          "error",
          "ATTACH PARTITION targets a table not present in the source model",
          { file: marker.file, ref: marker.ref, statement: marker.sql }
        )
      );
      continue;
    }
    const nextShape = {
      ...shape,
      inhRelations: [
        {
          RangeVar: {
            ...(amendment.parent.schema ? { schemaname: amendment.parent.schema } : {}),
            inh: true,
            relname: amendment.parent.name,
            relpersistence: "p",
          },
        },
      ],
      partbound: stripLocations(amendment.bound),
    };
    table.metadata = {
      ...table.metadata,
      canonicalShape: nextShape,
      partitionAttachSql: marker.sql,
    };
    table.hash = shapeHash(nextShape, table.key, table.ref);
    table.sql = `${table.sql};\n${marker.sql}`;
    table.dependencies = mergedDependencies([table, marker]);
  }
  return objects.filter((object) => tablePartitionAmendment(object) === undefined);
}

interface SequenceOwnedByAmendment {
  ownedBy: string | null;
}

function sequenceOwnedByAmendment(object: SchemaObject): SequenceOwnedByAmendment | undefined {
  const raw = asRecord(object.metadata.sequenceOwnedByAmendment);
  if (!raw) {
    return;
  }
  const ownedBy = raw.ownedBy;
  if (ownedBy !== null && typeof ownedBy !== "string") {
    return;
  }
  return { ownedBy };
}

function applySequenceOwnedByAmendments(
  objects: SchemaObject[],
  diagnostics: Diagnostic[]
): SchemaObject[] {
  const markers = objects.filter((object) => sequenceOwnedByAmendment(object) !== undefined);
  if (markers.length === 0) {
    return objects;
  }
  const sequencesByKey = new Map<string, SchemaObject>();
  for (const object of objects) {
    if (object.ref.kind === "sequence" && sequenceOwnedByAmendment(object) === undefined) {
      sequencesByKey.set(object.key, object);
    }
  }
  for (const marker of markers) {
    const amendment = sequenceOwnedByAmendment(marker);
    const sequence = sequencesByKey.get(marker.key);
    const shape = asRecord(sequence?.metadata.canonicalShape);
    if (!(sequence && shape && amendment)) {
      diagnostics.push(
        diagnostic(
          "SUPA_EXTRACT_UNSUPPORTED",
          "error",
          "ALTER SEQUENCE ... OWNED BY targets a sequence not present in the source model",
          { file: marker.file, ref: marker.ref, statement: marker.sql }
        )
      );
      continue;
    }
    const nextShape =
      amendment.ownedBy === null
        ? sequenceShapeWithoutOwner(shape)
        : { ...shape, ownedBy: amendment.ownedBy };
    sequence.metadata = { ...sequence.metadata, canonicalShape: nextShape };
    sequence.hash = shapeHash(nextShape, sequence.key, sequence.ref);
    sequence.sql = `${sequence.sql};\n${marker.sql}`;
    sequence.dependencies = mergedDependencies([sequence, marker]);
  }
  return objects.filter((object) => sequenceOwnedByAmendment(object) === undefined);
}

function sequenceShapeWithoutOwner(shape: Record<string, unknown>): Record<string, unknown> {
  const { ownedBy: _ownedBy, ...rest } = shape;
  return rest;
}

const rlsSubtypeOrder = new Map([
  ["AT_EnableRowSecurity", 0],
  ["AT_DisableRowSecurity", 1],
  ["AT_ForceRowSecurity", 2],
  ["AT_NoForceRowSecurity", 3],
]);

async function mergeRlsFacets(
  objects: SchemaObject[],
  options: SourceNormalizeOptions
): Promise<SchemaObject[]> {
  const groups = new Map<string, SchemaObject[]>();
  for (const object of objects) {
    if (object.ref.kind !== "rls" || typeof object.metadata.rlsSubtype !== "string") {
      continue;
    }
    const group = groups.get(object.key) ?? [];
    group.push(object);
    groups.set(object.key, group);
  }
  const replacements = new Map<string, SchemaObject>();
  const removed = new Set<SchemaObject>();
  for (const [key, group] of groups) {
    if (group.length < 2) {
      continue;
    }
    const ordered = [...group].sort(
      (left, right) =>
        (rlsSubtypeOrder.get(String(left.metadata.rlsSubtype)) ?? 9) -
        (rlsSubtypeOrder.get(String(right.metadata.rlsSubtype)) ?? 9)
    );
    const first = ordered[0];
    if (!first) {
      continue;
    }
    const merged = makeObject(
      first.ref,
      ordered.map((member) => member.sql).join(";\n"),
      first.ordinal,
      first.file,
      {
        rlsEnabled: ordered.some((member) => member.metadata.rlsSubtype === "AT_EnableRowSecurity"),
        rlsForced: ordered.some((member) => member.metadata.rlsSubtype === "AT_ForceRowSecurity"),
        rlsSubtype: ordered.some((member) => member.metadata.rlsSubtype === "AT_EnableRowSecurity")
          ? "AT_EnableRowSecurity"
          : String(first.metadata.rlsSubtype),
      }
    );
    merged.dependencies = mergedDependencies(ordered);
    await finalizeObject(merged, { normalize: options.normalize === true });
    replacements.set(key, merged);
    for (const member of group) {
      removed.add(member);
    }
  }
  return replaceMembers(objects, removed, replacements);
}

function replaceMembers(
  objects: SchemaObject[],
  removed: Set<SchemaObject>,
  replacements: Map<string, SchemaObject>
): SchemaObject[] {
  if (replacements.size === 0) {
    return objects;
  }
  const result: SchemaObject[] = [];
  for (const object of objects) {
    if (!removed.has(object)) {
      result.push(object);
      continue;
    }
    const replacement = replacements.get(object.key);
    if (replacement) {
      result.push(replacement);
      replacements.delete(object.key);
    }
  }
  return result;
}

async function mergeSplitPrivileges(
  objects: SchemaObject[],
  options: SourceNormalizeOptions
): Promise<SchemaObject[]> {
  const groups = new Map<string, SchemaObject[]>();
  for (const object of objects) {
    if (object.ref.kind !== "grant" && object.ref.kind !== "default-privilege") {
      continue;
    }
    const group = groups.get(object.key) ?? [];
    group.push(object);
    groups.set(object.key, group);
  }
  const replacements = new Map<string, SchemaObject>();
  const removed = new Set<SchemaObject>();
  for (const [key, group] of groups) {
    if (group.length < 2) {
      continue;
    }
    const merged = await mergePrivilegeGroup(group, options);
    if (!merged) {
      continue;
    }
    replacements.set(key, merged);
    for (const member of group) {
      removed.add(member);
    }
  }
  return replaceMembers(objects, removed, replacements);
}

async function mergePrivilegeGroup(
  group: SchemaObject[],
  options: SourceNormalizeOptions
): Promise<SchemaObject | undefined> {
  const first = group[0];
  if (!first) {
    return;
  }
  const privileges = unionPrivileges(group);
  if (!privileges) {
    return;
  }
  const meta = first.metadata;
  let merged: SchemaObject | undefined;
  if (first.ref.kind === "grant") {
    const grantOptions = new Set(group.map((item) => item.metadata.withGrantOption === true));
    if (grantOptions.size > 1) {
      return;
    }
    if (
      typeof meta.grantee !== "string" ||
      typeof meta.kindPhrase !== "string" ||
      typeof meta.target !== "string" ||
      typeof meta.targetIdentity !== "string" ||
      (meta.verb !== "GRANT" && meta.verb !== "REVOKE")
    ) {
      return;
    }
    merged = buildGrantObject({
      file: first.file,
      grantee: meta.grantee,
      kindPhrase: meta.kindPhrase,
      ordinal: first.ordinal,
      privileges,
      schema: first.ref.schema,
      targetIdentity: meta.targetIdentity,
      targetRendered: meta.target,
      verb: meta.verb,
      withGrantOption: meta.withGrantOption === true,
    });
  } else {
    if (
      typeof meta.grantee !== "string" ||
      typeof meta.objectType !== "string" ||
      (meta.verb !== "GRANT" && meta.verb !== "REVOKE")
    ) {
      return;
    }
    merged = buildDefaultPrivilegeObject({
      file: first.file,
      forRole: typeof meta.forRole === "string" ? meta.forRole : undefined,
      grantee: meta.grantee,
      objectType: meta.objectType,
      ordinal: first.ordinal,
      privileges,
      schema: typeof meta.schema === "string" ? meta.schema : undefined,
      verb: meta.verb,
    });
  }
  merged.dependencies = mergedDependencies(group);
  await finalizeObject(merged, { normalize: options.normalize === true });
  return merged;
}

function unionPrivileges(group: SchemaObject[]): string[] | undefined {
  const union = new Set<string>();
  for (const member of group) {
    const privileges = member.metadata.privileges;
    if (!Array.isArray(privileges) || privileges.some((item) => typeof item !== "string")) {
      return;
    }
    for (const privilege of privileges) {
      if (privilege === "ALL") {
        return ["ALL"];
      }
      union.add(privilege);
    }
  }
  return [...union].sort((left, right) => left.localeCompare(right));
}

function mergedDependencies(group: SchemaObject[]): string[] {
  const union = new Set<string>();
  for (const member of group) {
    for (const dependency of member.dependencies) {
      union.add(dependency);
    }
  }
  return [...union].sort((left, right) => left.localeCompare(right));
}
