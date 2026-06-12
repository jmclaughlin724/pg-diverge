import type { SchemaObject } from "./core.js";
import { asRecord, readArray, readString, stringList } from "./sql/ast.js";
import { parseSqlAst } from "./sql/parser.js";
import type { ColumnShape, TableShape } from "./typegen-model.js";

interface ViewTarget {
  alias?: string;
  isStar: boolean;
  sourceColumn?: string;
  starQualifier?: string;
}

export async function collectViewColumns(
  object: SchemaObject,
  tablesByKey: Map<string, TableShape>,
): Promise<{ name: string; type: string }[]> {
  const aliasNames = Array.isArray(object.metadata.viewColumns)
    ? object.metadata.viewColumns.map((value) => String(value))
    : undefined;
  const parsed = await parseSqlAst(object.sql, object.file);
  const select = firstSelect(parsed.ast);
  const fromInfo = soleFromTable(select, object.ref.schema ?? "public", tablesByKey);
  const targets = readArray(select?.targetList).map((target) => parseTarget(target));
  const expanded = expandTargets(targets, fromInfo);
  if (aliasNames) {
    return aliasNames.map((name, index) => ({
      name,
      type:
        aliasNames.length === expanded.length ? (expanded[index]?.type ?? "unknown") : "unknown",
    }));
  }
  return expanded;
}

function expandTargets(
  targets: ViewTarget[],
  fromInfo: { columns: ColumnShape[]; names: Set<string> } | undefined,
): { name: string; type: string }[] {
  const output: { name: string; type: string }[] = [];
  for (const target of targets) {
    if (target.isStar) {
      const coversFrom =
        fromInfo &&
        (target.starQualifier === undefined || fromInfo.names.has(target.starQualifier));
      if (coversFrom && fromInfo) {
        for (const column of fromInfo.columns) {
          output.push({ name: column.name, type: column.type });
        }
      }
      continue;
    }
    const name = target.alias ?? target.sourceColumn;
    if (!name) {
      continue;
    }
    const match =
      target.sourceColumn === undefined
        ? undefined
        : fromInfo?.columns.find((column) => column.name === target.sourceColumn);
    output.push({ name, type: match?.type ?? "unknown" });
  }
  return output;
}

function parseTarget(target: unknown): ViewTarget {
  const resTarget = asRecord(asRecord(target)?.ResTarget);
  const columnRef = asRecord(asRecord(resTarget?.val)?.ColumnRef);
  const fields = readArray(columnRef?.fields);
  const lastField = fields.at(-1);
  const isStar = asRecord(lastField)?.A_Star !== undefined;
  const lastName = stringList(columnRef?.fields).at(-1);
  const alias = readString(resTarget?.name);
  if (isStar) {
    return {
      isStar: true,
      ...(lastName !== undefined && fields.length > 1 ? { starQualifier: lastName } : {}),
    };
  }
  return {
    isStar: false,
    ...(alias !== undefined ? { alias } : {}),
    ...(lastName !== undefined ? { sourceColumn: lastName } : {}),
  };
}

function firstSelect(ast: unknown): Record<string, unknown> | undefined {
  const statements = readArray(asRecord(ast)?.stmts);
  const stmt = asRecord(asRecord(statements[0])?.stmt);
  const view = asRecord(stmt?.ViewStmt);
  const tableAs = asRecord(stmt?.CreateTableAsStmt);
  return asRecord(asRecord(view?.query ?? tableAs?.query)?.SelectStmt);
}

function soleFromTable(
  select: Record<string, unknown> | undefined,
  defaultSchema: string,
  tablesByKey: Map<string, TableShape>,
): { columns: ColumnShape[]; names: Set<string> } | undefined {
  const fromClause = readArray(select?.fromClause);
  if (fromClause.length !== 1) {
    return undefined;
  }
  const rangeVar = asRecord(asRecord(fromClause[0])?.RangeVar);
  const relname = readString(rangeVar?.relname);
  if (!(rangeVar && relname)) {
    return undefined;
  }
  const schemaName = readString(rangeVar?.schemaname) ?? defaultSchema;
  const table = tablesByKey.get(`${schemaName}.${relname}`);
  if (!table) {
    return undefined;
  }
  const aliasName = asRecord(rangeVar.alias)?.aliasname;
  const names = new Set([relname]);
  if (typeof aliasName === "string") {
    names.add(aliasName);
  }
  return { columns: table.columns, names };
}
