import path from "node:path";

const defaultRoot = path.resolve(".");
const patchPrefixes = ["*** Add File: ", "*** Update File: ", "*** Delete File: ", "*** Move to: "];

export function isCodeAtlasQuery(payload) {
  return Boolean(codeAtlasQueryEvidence(payload));
}

export function codeAtlasQueryEvidence(payload) {
  const name = typeof payload?.tool_name === "string" ? payload.tool_name : "";
  if (isCodeAtlasTool(name)) {
    const input = payload?.tool_input ?? {};
    const queryKind = typeof input.kind === "string" ? input.kind : "";
    const value = typeof input.value === "string" ? input.value : "";
    return {
      kind: "code-atlas-query",
      queryKind,
      summary: `Code Atlas ${queryKind || "query"} tool call`,
      value,
    };
  }
  if (name !== "Bash") {
    return;
  }
  const command =
    typeof payload?.tool_input?.command === "string" ? payload.tool_input.command : "";
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
  const name = typeof payload?.tool_name === "string" ? payload.tool_name : "";
  const input = payload?.tool_input ?? {};
  if (
    ["Edit", "MultiEdit", "Read", "Write"].includes(name) &&
    typeof input.file_path === "string"
  ) {
    return repoRelative(input.file_path, root);
  }
  if (name === "NotebookEdit" && typeof input.notebook_path === "string") {
    return repoRelative(input.notebook_path, root);
  }
  if (isCodeAtlasTool(name) && typeof input.value === "string") {
    return repoRelative(input.value, root);
  }
  const patch = name === "apply_patch" && typeof input.command === "string" ? input.command : "";
  return patchTarget(patch, root);
}

function patchTarget(patch, root) {
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
  return name === "mcp__supaschema__code_atlas_query";
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
