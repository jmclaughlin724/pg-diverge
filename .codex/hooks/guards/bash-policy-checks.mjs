#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const readCommands = new Set([
  "awk",
  "bat",
  "cat",
  "egrep",
  "fgrep",
  "grep",
  "head",
  "less",
  "more",
  "rg",
  "sed",
  "tail",
]);
const secretFlagNames = new Set([
  "--api-key",
  "--password",
  "--secret",
  "--token",
  "--value",
]);
const safeEnvTemplates = new Set([
  ".env.default",
  ".env.defaults",
  ".env.example",
  ".env.sample",
  ".env.template",
]);
export function evaluateBashPolicy(input, env = process.env) {
  if (!isBashPayload(input)) {
    return allowResult();
  }

  const command = commandFromPayload(input);
  if (!command.trim()) {
    return allowResult();
  }

  for (const check of [
    checkSecretArgv,
    checkSecretEnvFileRead,
    checkRawSqlDdlCommand,
    checkDangerousGitAndShellWrites,
  ]) {
    const result = check(command, env);
    if (result.action !== "allow") {
      return result;
    }
  }

  return allowResult();
}

function isBashPayload(input) {
  return ["Bash", "exec_command", "functions.exec_command"].includes(
    String(input?.tool_name ?? "")
  );
}

function commandFromPayload(input) {
  const toolInput = input?.tool_input ?? {};
  if (typeof toolInput.command === "string") {
    return toolInput.command;
  }
  if (typeof toolInput.cmd === "string") {
    return toolInput.cmd;
  }
  if (Array.isArray(toolInput.command)) {
    return toolInput.command
      .filter((part) => typeof part === "string")
      .join(" ");
  }
  return "";
}

function allowResult() {
  return { action: "allow" };
}

function block(message) {
  return { action: "block", message };
}

function checkSecretArgv(command) {
  const scanned = stripHeredocs(command);
  const hits = [];

  for (const tokens of commandSegments(scanned)) {
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index] ?? "";
      if (hasDbUrlWithInlinePassword(token)) {
        hits.push(describeHit("DB connection URL with inline password", token));
      }
      const assignment = envAssignment(token);
      if (
        assignment &&
        secretName(assignment.name) &&
        literalSecretValue(assignment.value)
      ) {
        hits.push(
          describeHit(`inline secret env ${assignment.name}=<literal>`, token)
        );
        continue;
      }

      const flagHit = secretFlagValue(tokens, index);
      if (flagHit && literalSecretValue(flagHit.value)) {
        hits.push(
          describeHit(`${flagHit.name} literal in argv`, flagHit.preview)
        );
      }
    }
  }

  if (hits.length === 0) {
    return allowResult();
  }

  return block(
    "BLOCKED: Secret material detected in Bash argv.\n\n" +
      `Matched patterns:\n  - ${hits.join("\n  - ")}\n\n` +
      "Use env-var references, stdin, or a secure file/secret-manager handoff. Do not put secrets in command argv."
  );
}

function checkSecretEnvFileRead(command) {
  const matches = [];
  for (const tokens of commandSegments(stripHeredocs(command))) {
    const start = commandStart(tokens);
    if (!readCommands.has(tokens[start] ?? "")) {
      continue;
    }
    for (const token of tokens.slice(start + 1)) {
      const fileName = envFileName(token);
      if (fileName && !safeEnvTemplates.has(fileName)) {
        matches.push(fileName);
      }
    }
  }

  if (matches.length === 0) {
    return allowResult();
  }

  return block(
    "BLOCKED: Bash read/search of secret-bearing env files is prohibited.\n\n" +
      `Matched env file(s): ${[...new Set(matches)].join(", ")}\n\n` +
      "Use env-var references, a targeted non-secret example file, or an approved secret manager command."
  );
}

function checkRawSqlDdlCommand(command) {
  for (const tokens of commandSegments(stripHeredocs(command))) {
    if (!isRawSqlCliSegment(tokens)) {
      continue;
    }
    const keyword = sqlDdlKeyword(stripSqlComments(rawSqlPayload(tokens)));
    if (keyword) {
      return block(
        `BLOCKED: raw SQL DDL through Bash detected: ${keyword}.\n\n` +
          "Structural database changes must go through the declarative schema and generated migration workflow. Use `supaschema diff` and `supaschema check` for durable schema changes."
      );
    }
  }
  return allowResult();
}

function checkDangerousGitAndShellWrites(command) {
  const ast = parseShellAst(stripHeredocs(command));
  const segments = ast.segments.map((segment) => segment.words);
  if (
    segments.some(
      (tokens) =>
        commandName(tokens) === "rm" &&
        rmArgsIncludeRecursiveForce(commandArgs(tokens))
    )
  ) {
    return block(
      "BLOCKED: `rm -rf` and equivalent recursive+force rm invocations are prohibited. Use explicit, reviewed file operations instead."
    );
  }

  for (const tokens of segments) {
    if (commandName(tokens) !== "git") {
      continue;
    }
    const args = commandArgs(tokens);
    const subcommand = args[0] ?? "";

    if (subcommand === "stash") {
      return block(
        "BLOCKED: git stash is prohibited. Preserve unrelated work without stash."
      );
    }
    if (subcommand === "merge" && args.includes("--squash")) {
      return block(
        "BLOCKED: local `git merge --squash` is prohibited for PR merges. Use the hosted PR squash flow instead."
      );
    }
    if (subcommand === "checkout") {
      return block(
        "BLOCKED: git checkout is prohibited. Use git switch for branches, git diff/git show for comparisons, and direct edits for file changes."
      );
    }
    if (subcommand === "reset") {
      return block(
        "BLOCKED: git reset is prohibited. Ask the user before running reset."
      );
    }
    if (subcommand === "commit" && args.includes("--no-verify")) {
      return block(
        "BLOCKED: --no-verify is prohibited. Fix the hook failure instead."
      );
    }
    if (subcommand === "push" && isForcePushToMain(args)) {
      return block("BLOCKED: force-push to main is prohibited.");
    }
    if (subcommand === "push" && isDiagnosticPush(ast, tokens, args)) {
      return block(
        "BLOCKED: Do not use `git push` as a diagnostic or inventory probe. Use the repo pre-push check or `git push --dry-run` only when remote negotiation must be tested."
      );
    }
    if (
      subcommand === "restore" &&
      args.some((arg) => arg === "-s" || arg.startsWith("--source"))
    ) {
      return block(
        "BLOCKED: git restore --source is prohibited. It overwrites local files with content from another branch. Use git diff or git show for read-only comparisons."
      );
    }
  }

  return allowResult();
}

function commandSegments(command) {
  return parseShellAst(command).segments.map((segment) => segment.words);
}

function parseShellAst(command) {
  const segments = [];
  let current = [];
  let nextOperator = "";
  for (const token of shellTokens(command)) {
    if (token.kind === "operator") {
      if (current.length > 0) {
        segments.push({ operatorBefore: nextOperator, words: current });
        current = [];
      }
      nextOperator = token.value;
      continue;
    }
    current.push(token.value);
  }
  if (current.length > 0) {
    segments.push({ operatorBefore: nextOperator, words: current });
  }
  return { segments };
}

function shellTokens(command) {
  const tokens = [];
  let token = "";
  let quote = "";
  let escape = false;

  const pushToken = () => {
    if (token.length > 0) {
      tokens.push({ kind: "word", value: token });
      token = "";
    }
  };

  for (const char of command) {
    if (escape) {
      token += char;
      escape = false;
      continue;
    }
    if (char === "\\") {
      escape = true;
      continue;
    }
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
      pushToken();
      continue;
    }
    if (
      char === ";" ||
      char === "|" ||
      char === "&" ||
      char === "(" ||
      char === ")"
    ) {
      pushToken();
      tokens.push({ kind: "operator", value: char });
      continue;
    }
    token += char;
  }
  pushToken();
  return tokens;
}

function commandStart(tokens) {
  let index = 0;
  while (index < tokens.length && envAssignment(tokens[index])) {
    index += 1;
  }
  return index;
}

function commandName(tokens) {
  return tokens[commandStart(tokens)] ?? "";
}

function commandArgs(tokens) {
  return tokens.slice(commandStart(tokens) + 1);
}

function envAssignment(token) {
  const equals = token.indexOf("=");
  if (equals <= 0) {
    return;
  }
  const name = token.slice(0, equals);
  if (!isIdentifierName(name)) {
    return;
  }
  return { name, value: token.slice(equals + 1) };
}

function secretName(name) {
  const upper = name.toUpperCase();
  return (
    upper.includes("SECRET") ||
    upper.includes("TOKEN") ||
    upper.includes("PASSWORD") ||
    upper.includes("KEY") ||
    upper.includes("CREDENTIAL") ||
    upper.includes("PASSWD") ||
    upper.includes("PASS")
  );
}

function literalSecretValue(value) {
  return value.length >= 16 && !looksMasked(value) && value[0] !== "$";
}

function secretFlagValue(tokens, index) {
  const token = tokens[index] ?? "";
  const equals = token.indexOf("=");
  if (equals > 0) {
    const name = token.slice(0, equals);
    if (secretFlagNames.has(name)) {
      return { name, preview: token, value: token.slice(equals + 1) };
    }
    return;
  }
  if (secretFlagNames.has(token) && typeof tokens[index + 1] === "string") {
    return {
      name: token,
      preview: `${token} ${tokens[index + 1]}`,
      value: tokens[index + 1],
    };
  }
}

function envFileName(token) {
  const cleaned = trimShellPunctuation(token);
  const fileName = cleaned.split("/").pop() ?? "";
  if (
    fileName === ".envrc" ||
    fileName === ".env" ||
    fileName.startsWith(".env.")
  ) {
    return fileName;
  }
}

function isRawSqlCliSegment(tokens) {
  const start = commandStart(tokens);
  const command = tokens[start] ?? "";
  if (command === "psql") {
    return true;
  }
  return (
    command === "supabase" &&
    tokens[start + 1] === "db" &&
    ["execute", "query"].includes(tokens[start + 2] ?? "")
  );
}

function rawSqlPayload(tokens) {
  const start = commandStart(tokens);
  const command = tokens[start] ?? "";
  for (let index = start + 1; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    if (
      (command === "psql" && ["-c", "--command"].includes(token)) ||
      token === "--sql"
    ) {
      return tokens[index + 1] ?? "";
    }
    const sqlFlag = "--sql=";
    if (token.startsWith(sqlFlag)) {
      return token.slice(sqlFlag.length);
    }
  }
  return tokens.slice(start + 1).join(" ");
}

function rmArgsIncludeRecursiveForce(args) {
  let recursive = false;
  let force = false;
  for (const arg of args) {
    if (arg === "--") {
      break;
    }
    if (!arg.startsWith("-") || arg === "-") {
      continue;
    }
    if (arg === "--recursive") {
      recursive = true;
    } else if (arg === "--force") {
      force = true;
    } else if (!arg.startsWith("--")) {
      recursive ||= containsAny(arg, ["r", "R"]);
      force ||= arg.includes("f");
    }
    if (recursive && force) {
      return true;
    }
  }
  return false;
}

function isForcePushToMain(args) {
  return (
    args.some(
      (arg) =>
        arg === "--force" ||
        arg === "--force-with-lease" ||
        arg.startsWith("--force-with-lease=")
    ) &&
    args.some(
      (arg) =>
        arg === "main" || arg === "refs/heads/main" || arg.endsWith(":main")
    )
  );
}

function isDiagnosticPush(ast, gitPushTokens, args) {
  if (args.some((arg) => arg === "--dry-run" || arg === "-n")) {
    return false;
  }
  const index = ast.segments.findIndex(
    (segment) => segment.words === gitPushTokens
  );
  if (index === -1) {
    return false;
  }
  const next = ast.segments[index + 1];
  return (
    next?.operatorBefore === "|" &&
    ["awk", "grep", "head", "sed", "tail", "wc"].includes(
      commandName(next.words)
    )
  );
}

function stripHeredocs(command) {
  const lines = command.split("\n");
  const out = [];
  let marker = "";
  for (const line of lines) {
    if (marker) {
      if (line.trim() === marker) {
        out.push("HEREDOC");
        marker = "";
      }
      continue;
    }
    const heredoc = heredocMarker(line);
    if (heredoc) {
      marker = heredoc;
      out.push("<<HEREDOC");
      out.push("[heredoc body stripped]");
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

function looksMasked(value) {
  const lower = value.toLowerCase();
  return (
    lower.includes("[redacted]") ||
    lower.includes("<password>") ||
    lower.includes("<secret>") ||
    lower.includes("<token>") ||
    value.includes("***") ||
    lower.includes("xxx")
  );
}

function describeHit(kind, match) {
  const preview =
    match.length > 44 ? `${match.slice(0, 16)}...${match.slice(-6)}` : match;
  return `${kind}: ${preview}`;
}

function isWhitespace(char) {
  return char === " " || char === "\n" || char === "\r" || char === "\t";
}

function hasDbUrlWithInlinePassword(value) {
  const schemeEnd = value.indexOf("://");
  if (schemeEnd <= 0) {
    return false;
  }
  const scheme = value.slice(0, schemeEnd).toLowerCase();
  if (!["mysql", "postgres", "postgresql"].includes(scheme)) {
    return false;
  }
  const authorityStart = schemeEnd + 3;
  const authorityEnd = firstIndexOfAny(value, ["/", "?", "#"], authorityStart);
  const authority = value.slice(
    authorityStart,
    authorityEnd === -1 ? value.length : authorityEnd
  );
  const at = authority.lastIndexOf("@");
  if (at <= 0) {
    return false;
  }
  const userinfo = authority.slice(0, at);
  const colon = userinfo.indexOf(":");
  if (colon <= 0) {
    return false;
  }
  const password = userinfo.slice(colon + 1);
  return password.length >= 12 && !looksMasked(password);
}

function sqlDdlKeyword(sql) {
  const tokens = sqlTokens(sql);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const next = tokens[index + 1] ?? "";
    const third = tokens[index + 2] ?? "";
    const fourth = tokens[index + 3] ?? "";
    if (token === "GRANT" || token === "REVOKE" || token === "TRUNCATE") {
      return token;
    }
    if (
      token === "ENABLE" &&
      next === "ROW" &&
      third === "LEVEL" &&
      fourth === "SECURITY"
    ) {
      return "ENABLE ROW LEVEL SECURITY";
    }
    if (token === "CREATE" && createKinds(tokens, index + 1)) {
      return `CREATE ${createKinds(tokens, index + 1)}`;
    }
    if (token === "ALTER" && alterKinds(tokens, index + 1)) {
      return `ALTER ${alterKinds(tokens, index + 1)}`;
    }
    if (token === "DROP" && dropKinds(tokens, index + 1)) {
      return `DROP ${dropKinds(tokens, index + 1)}`;
    }
  }
}

function createKinds(tokens, index) {
  const first = tokens[index] ?? "";
  const second = tokens[index + 1] ?? "";
  if (first === "MATERIALIZED" && second === "VIEW") {
    return "MATERIALIZED VIEW";
  }
  return [
    "EXTENSION",
    "FUNCTION",
    "INDEX",
    "POLICY",
    "ROLE",
    "SCHEMA",
    "SEQUENCE",
    "TABLE",
    "TRIGGER",
    "TYPE",
    "VIEW",
  ].includes(first)
    ? first
    : "";
}

function alterKinds(tokens, index) {
  const first = tokens[index] ?? "";
  return [
    "FUNCTION",
    "POLICY",
    "ROLE",
    "SCHEMA",
    "SEQUENCE",
    "TABLE",
    "TYPE",
  ].includes(first)
    ? first
    : "";
}

function dropKinds(tokens, index) {
  const first = tokens[index] ?? "";
  const second = tokens[index + 1] ?? "";
  if (first === "MATERIALIZED" && second === "VIEW") {
    return "MATERIALIZED VIEW";
  }
  return [
    "EXTENSION",
    "FUNCTION",
    "INDEX",
    "POLICY",
    "ROLE",
    "SCHEMA",
    "SEQUENCE",
    "TABLE",
    "TRIGGER",
    "TYPE",
    "VIEW",
  ].includes(first)
    ? first
    : "";
}

function sqlTokens(sql) {
  const tokens = [];
  let token = "";
  let quote = "";
  const push = () => {
    if (token) {
      tokens.push(token.toUpperCase());
      token = "";
    }
  };

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index] ?? "";
    if (quote) {
      if (char === quote) {
        quote = "";
      }
      continue;
    }
    if (char === "'" || char === '"') {
      push();
      quote = char;
      continue;
    }
    if (isIdentifierChar(char)) {
      token += char;
      continue;
    }
    push();
  }
  push();
  return tokens;
}

function stripSqlComments(sql) {
  let out = "";
  let index = 0;
  while (index < sql.length) {
    const char = sql[index] ?? "";
    const next = sql[index + 1] ?? "";
    if (char === "-" && next === "-") {
      index += 2;
      while (index < sql.length && !["\n", "\r"].includes(sql[index] ?? "")) {
        index += 1;
      }
      out += " ";
      continue;
    }
    if (char === "/" && next === "*") {
      index += 2;
      while (
        index < sql.length &&
        !((sql[index] ?? "") === "*" && (sql[index + 1] ?? "") === "/")
      ) {
        index += 1;
      }
      index += 2;
      out += " ";
      continue;
    }
    out += char;
    index += 1;
  }
  return out;
}

function heredocMarker(line) {
  const markerStart = line.indexOf("<<");
  if (markerStart === -1) {
    return "";
  }
  let index = markerStart + 2;
  if (line[index] === "-") {
    index += 1;
  }
  while (index < line.length && isWhitespace(line[index] ?? "")) {
    index += 1;
  }
  const quote = line[index] === "'" || line[index] === '"' ? line[index] : "";
  if (quote) {
    index += 1;
  }
  let marker = "";
  while (index < line.length) {
    const char = line[index] ?? "";
    if (
      (quote && char === quote) ||
      (!quote && (isWhitespace(char) || [";", "|", "&"].includes(char)))
    ) {
      break;
    }
    marker += char;
    index += 1;
  }
  return marker;
}

function trimShellPunctuation(value) {
  let start = 0;
  let end = value.length;
  const leading = new Set(["<", ">", '"', "'"]);
  const trailing = new Set(["<", ">", '"', "'", ",", ":", ";", "|", ")"]);
  while (start < end && leading.has(value[start] ?? "")) {
    start += 1;
  }
  while (end > start && trailing.has(value[end - 1] ?? "")) {
    end -= 1;
  }
  return value.slice(start, end);
}

function isIdentifierName(value) {
  if (!value) {
    return false;
  }
  if (!(isAsciiLetter(value[0] ?? "") || value[0] === "_")) {
    return false;
  }
  for (const char of value.slice(1)) {
    if (!(isAsciiLetter(char) || isDigit(char) || char === "_")) {
      return false;
    }
  }
  return true;
}

function isIdentifierChar(char) {
  return isAsciiLetter(char) || isDigit(char) || char === "_";
}

function isAsciiLetter(char) {
  const code = char.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isDigit(char) {
  const code = char.charCodeAt(0);
  return code >= 48 && code <= 57;
}

function containsAny(value, candidates) {
  return candidates.some((candidate) => value.includes(candidate));
}

function firstIndexOfAny(value, chars, start) {
  let found = -1;
  for (const char of chars) {
    const index = value.indexOf(char, start);
    if (index !== -1 && (found === -1 || index < found)) {
      found = index;
    }
  }
  return found;
}

async function main() {
  let payload = {};
  try {
    const raw = readFileSync(0, "utf8");
    payload = raw.trim() ? JSON.parse(raw) : {};
    const result = evaluateBashPolicy(payload);
    if (result.action === "block") {
      process.stderr.write(`${result.message}\n`);
      process.exit(2);
    }
  } catch (error) {
    process.stderr.write(
      `bash-policy-checks hook failed closed: ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exit(2);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
