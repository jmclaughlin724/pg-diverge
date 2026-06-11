import type { Diagnostic, PgDivergeConfig } from "./core.js";
import { diagnostic } from "./diagnostics.js";
import type { AstStatement } from "./sql/ast.js";
import { asRecord, qualifiedName, readString } from "./sql/ast.js";

export function newEnumAdditionState(): Map<string, Set<string>> {
  return new Map();
}

export function recordEnumAdditions(
  statement: AstStatement,
  state: Map<string, Set<string>>,
): void {
  if (statement.tag !== "AlterEnumStmt") {
    return;
  }
  const node = asRecord(statement.node.AlterEnumStmt);
  const name = qualifiedName(node?.typeName);
  const newValue = readString(node?.newVal);
  if (!name || newValue === undefined) {
    return;
  }
  for (const key of [`${name.schema}.${name.name}`, name.name]) {
    const values = state.get(key) ?? new Set<string>();
    values.add(newValue);
    state.set(key, values);
  }
}

export function enumValueUseDiagnostics(
  statement: AstStatement,
  state: Map<string, Set<string>>,
  config: PgDivergeConfig,
): Diagnostic[] {
  if (state.size === 0 || statement.tag === "AlterEnumStmt") {
    return [];
  }
  const uses: string[] = [];
  collectEnumValueUses(statement.node, state, uses);
  if (uses.length === 0) {
    return [];
  }
  const severity = config.transactionMode === "per-migration" ? "error" : "warning";
  return uses.map((use) =>
    diagnostic(
      "PD_CHECK_ENUM_VALUE_USE_SAME_TRANSACTION",
      severity,
      `enum value ${use} is added and used in the same migration; PostgreSQL cannot use a value added in the same transaction`,
      {
        hint: "Move the usage to a follow-up migration, or run the runner without transaction wrapping and set transactionMode to per-statement.",
        statement: statement.text,
      },
    ),
  );
}

function collectEnumValueUses(
  value: unknown,
  state: Map<string, Set<string>>,
  uses: string[],
): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectEnumValueUses(item, state, uses);
    }
    return;
  }
  const record = asRecord(value);
  if (!record) {
    return;
  }
  const typeCast = asRecord(record.TypeCast);
  if (typeCast) {
    const typeName = asRecord(asRecord(typeCast.typeName)?.TypeName) ?? asRecord(typeCast.typeName);
    const name = qualifiedName(typeName?.names);
    const literal = castStringLiteral(typeCast.arg);
    if (name && literal !== undefined) {
      const added =
        state.get(`${name.schema}.${name.name}`) ??
        (name.schema === "public" ? state.get(name.name) : undefined);
      if (added?.has(literal)) {
        uses.push(`'${literal}'::${name.schema}.${name.name}`);
      }
    }
  }
  for (const child of Object.values(record)) {
    if (child && typeof child === "object") {
      collectEnumValueUses(child, state, uses);
    }
  }
}

function castStringLiteral(arg: unknown): string | undefined {
  const constant = asRecord(asRecord(arg)?.A_Const);
  return readString(asRecord(constant?.sval)?.sval);
}

export function escalateNontransactional(
  diagnostics: Diagnostic[],
  config: PgDivergeConfig,
): Diagnostic[] {
  const escalate = config.adapter === "supabase-auto" || config.transactionMode === "per-migration";
  if (!escalate) {
    return diagnostics;
  }
  return diagnostics.map((item) => {
    if (
      item.code === "PD_CHECK_NONTRANSACTIONAL_INDEX" ||
      item.code === "PD_CHECK_NONTRANSACTIONAL_REFRESH"
    ) {
      return { ...item, severity: "error" as const };
    }
    return item;
  });
}
