import path from "node:path";
import { isCommandTool, toolCommand, toolName } from "./tool-payload.mjs";

const defaultRoot = path.resolve(".");
const pathKeys = ["file_path", "notebook_path", "path", "target", "uri"];
const patchPrefixes = ["*** Add File: ", "*** Update File: ", "*** Delete File: ", "*** Move to: "];

export function isCodeAtlasQuery(payload) {
  return Boolean(codeAtlasQueryEvidence(payload));
}

export function codeAtlasQueryEvidence(payload) {
  const name = toolName(payload);
  if (isCodeAtlasTool(name)) {
    const input = payload?.tool_input ?? {};
    const queryKind = firstString(input.kind, input.queryKind, input.query, input.type);
    const value = firstString(input.value, input.target, input.path, input.file_path);
    return {
      kind: "code-atlas-query",
      queryKind,
      value,
      summary: `Code Atlas ${queryKind || "query"} tool call`,
    };
  }
  if (!isCommandTool(name)) {
    return;
  }
  const command = toolCommand(payload);
  const parsed = parseCodeAtlasCommand(command);
  if (!parsed) {
    return;
  }
  return {
    command,
    kind: "code-atlas-query",
    summary: `Code Atlas ${parsed.queryKind || "query"} command`,
    ...parsed,
  };
}

export function atlasAdvisoryTarget(payload, root = defaultRoot) {
  const input = payload?.tool_input ?? {};
  for (const key of pathKeys) {
    if (typeof input[key] === "string" && input[key].trim()) {
      return repoRelative(input[key], root);
    }
  }
  const patch = firstString(input.patch, input.command, input.input);
  if (!patch) {
    return "";
  }
  for (const line of patch.split("\n")) {
    for (const prefix of patchPrefixes) {
      if (line.startsWith(prefix)) {
        const target = repoRelative(line.slice(prefix.length).trim(), root);
        if (target) {
          return target;
        }
      }
    }
  }
  return "";
}

function parseCodeAtlasCommand(command) {
  const tokens = shellTokens(command);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = normalizedScriptToken(tokens[index]);
    if (token === "code-atlas:query") {
      return queryArgs(tokens, index + 1);
    }
    if (token === "scripts/code-atlas/query.mjs") {
      return queryArgs(tokens, index + 1);
    }
  }
}

function queryArgs(tokens, startIndex) {
  let index = startIndex;
  if (tokens[index] === "--") {
    index += 1;
  }
  while (index < tokens.length && isOption(tokens[index])) {
    index += 1;
  }
  const queryKind = tokens[index] ?? "";
  let value = "";
  for (let next = index + 1; next < tokens.length; next += 1) {
    const token = tokens[next];
    if (token === "--" || isOption(token)) {
      continue;
    }
    value = token;
    break;
  }
  return queryKind ? { queryKind, value } : { queryKind: "", value: "" };
}

function normalizedScriptToken(token) {
  const normalized = token.split(path.sep).join("/");
  const prefix = "./";
  const withoutDot = normalized.startsWith(prefix) ? normalized.slice(prefix.length) : normalized;
  const marker = "/scripts/code-atlas/query.mjs";
  if (withoutDot.endsWith(marker)) {
    return "scripts/code-atlas/query.mjs";
  }
  return withoutDot;
}

function isCodeAtlasTool(name) {
  return (
    name === "mcp__supaschema__code_atlas_query" ||
    name === "supaschema.code_atlas_query" ||
    name.endsWith("__code_atlas_query")
  );
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string") {
      return value;
    }
  }
  return "";
}

function shellTokens(command) {
  const tokens = [];
  let token = "";
  let quote = "";
  for (const char of command.trim()) {
    if (quote) {
      if (char === quote) {
        quote = "";
      } else {
        token += char;
      }
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (isWhitespace(char)) {
      if (token) {
        tokens.push(token);
        token = "";
      }
      continue;
    }
    token += char;
  }
  if (token) {
    tokens.push(token);
  }
  return tokens;
}

function repoRelative(value, root) {
  const withoutScheme = value.startsWith("file://") ? value.slice("file://".length) : value;
  const normalized = withoutScheme.split(path.sep).join("/");
  if (!path.isAbsolute(withoutScheme)) {
    return normalized;
  }
  return path.relative(root, withoutScheme).split(path.sep).join("/");
}

function isOption(token) {
  return token.startsWith("-");
}

function isWhitespace(char) {
  return char === " " || char === "\n" || char === "\r" || char === "\t";
}
