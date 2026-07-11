import { loadModule, parse } from "libpg-query";

let loaded = false;

export async function parseSql(text) {
  if (!loaded) {
    await loadModule();
    loaded = true;
  }
  return parse(text);
}

export function stmtKind(stmt) {
  return Object.keys(stmt ?? {})[0] ?? "UnknownStmt";
}

export function relName(rel) {
  if (!rel || typeof rel !== "object") {
    return;
  }
  const schema = typeof rel.schemaname === "string" ? rel.schemaname : "public";
  const name = typeof rel.relname === "string" ? rel.relname : undefined;
  return name ? { name, schema } : undefined;
}

export function dottedName(list) {
  const parts = arrayItems(list)
    .map((item) => {
      if (typeof item?.String?.sval === "string") {
        return item.String.sval;
      }
      if (typeof item?.String?.str === "string") {
        return item.String.str;
      }
      return "";
    })
    .filter(Boolean);
  if (parts.length === 0) {
    return;
  }
  if (parts.length === 1) {
    return { name: parts[0], schema: "public" };
  }
  return { name: parts.at(-1), schema: parts.slice(0, -1).join(".") };
}

export function arrayItems(value) {
  return Array.isArray(value) ? value : [];
}
