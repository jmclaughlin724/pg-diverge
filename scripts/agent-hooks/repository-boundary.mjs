import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  commandArgs,
  commandName,
  commandSegmentObjects,
  isReadCommandName,
} from "../../.claude/hooks/guards/bash-policy-checks.mjs";

const patchPathPrefixes = [
  "*** Add File: ",
  "*** Update File: ",
  "*** Delete File: ",
  "*** Move to: ",
];
const pathOperandCommands = new Set([
  "chmod",
  "chown",
  "cp",
  "find",
  "ln",
  "ls",
  "mkdir",
  "mv",
  "node",
  "open",
  "readlink",
  "realpath",
  "rm",
  "rmdir",
  "stat",
  "touch",
  "unzip",
  "zip",
]);
const directoryValueOptions = new Set([
  "--chdir",
  "--cwd",
  "--directory",
  "--git-dir",
  "--output",
  "--prefix",
  "--root",
  "--tmpdir",
  "--work-tree",
  "-C",
  "-D",
  "-d",
  "-o",
  "-p",
]);
const leadingExpressionCommands = new Set(["awk", "egrep", "fgrep", "grep", "rg", "sed"]);
const patternValueOptions = new Set(["-e", "--expression", "--regexp"]);
const readerAttachedPathFlags = new Map([
  ["awk", "f"],
  ["grep", "f"],
  ["sed", "f"],
]);
const inlineCodeOptions = new Map([
  ["bun", new Set(["-e", "--eval", "--print"])],
  ["node", new Set(["-e", "--eval", "-p", "--print"])],
  ["nodejs", new Set(["-e", "--eval", "-p", "--print"])],
  ["perl", new Set(["-e"])],
  ["php", new Set(["-r"])],
  ["ruby", new Set(["-e"])],
]);
const branchActionWords = new Set([
  "add",
  "adding",
  "change",
  "changing",
  "create",
  "creating",
  "delete",
  "deleting",
  "make",
  "making",
  "move",
  "moving",
  "remove",
  "removing",
  "start",
  "starting",
  "switch",
  "switching",
]);
const localFilesystemToolNames = new Set([
  "Edit",
  "Glob",
  "Grep",
  "LS",
  "MultiEdit",
  "NotebookEdit",
  "NotebookRead",
  "Read",
  "Write",
]);
const nonFileUriSchemes = new Set([
  "ftp",
  "ftps",
  "git",
  "http",
  "https",
  "postgres",
  "postgresql",
  "sftp",
  "ssh",
  "ws",
  "wss",
]);
const conditionalOrNegativeWords = new Set([
  "cannot",
  "describe",
  "describing",
  "document",
  "documentation",
  "dont",
  "example",
  "examples",
  "explain",
  "explaining",
  "if",
  "never",
  "no",
  "not",
  "only",
  "unless",
  "until",
  "what",
  "when",
  "why",
  "without",
]);

export function evaluateRepositoryBoundary(payload, options = {}) {
  const root = fs.realpathSync(options.root);
  const gitMetadata = path.join(root, ".git");
  if (isLinkedWorktreeMetadata(gitMetadata)) {
    return block(
      "BLOCKED: this repository is running from a linked Git worktree. Worktrees are prohibited; restart the task from the primary repository checkout."
    );
  }

  const cwdValue = typeof payload?.cwd === "string" && payload.cwd.length > 0 ? payload.cwd : root;
  const cwdCheck = inspectPath(cwdValue, root, root);
  const cwdBlock = pathViolationBlock("hook cwd", cwdValue, cwdCheck, root);
  if (cwdBlock) {
    return cwdBlock;
  }
  const cwd = cwdCheck.resolved;

  const bashResult = inspectBashCommand(payload, cwd, root);
  if (bashResult.action === "block") {
    return bashResult;
  }

  for (const target of structuredPathTargets(payload, cwd, root)) {
    const targetCheck = inspectPath(target.value, cwd, root);
    const targetBlock = pathViolationBlock(target.label, target.value, targetCheck, root);
    if (targetBlock) {
      return targetBlock;
    }
  }

  return allow();
}

export function promptAuthorizesBranchMutation(prompt) {
  const tokens = promptTokens(prompt);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    if (
      token === "git" &&
      (tokens[index + 1] === "branch" || tokens[index + 1] === "switch") &&
      !hasConditionalOrNegativeContext(tokens, index)
    ) {
      return true;
    }
    if (!branchActionWords.has(token)) {
      continue;
    }
    const nearby = tokens.slice(Math.max(0, index - 2), index + 7);
    if (
      nearby.some((candidate) => candidate === "branch" || candidate === "branches") &&
      !hasConditionalOrNegativeContext(tokens, index)
    ) {
      return true;
    }
  }
  return false;
}

function inspectBashCommand(payload, cwd, root) {
  if (payload?.tool_name !== "Bash" || typeof payload?.tool_input?.command !== "string") {
    return allow();
  }

  for (const segment of commandSegmentObjects(payload.tool_input.command)) {
    const result = inspectBashSegment(segment, cwd, root);
    if (result.action === "block") {
      return result;
    }
  }

  return allow();
}

function inspectBashSegment(segment, cwd, root) {
  const words = segment.words;
  const name = commandName(words);
  const args = commandArgs(words);
  for (const result of [
    inspectShellRedirection(segment, cwd, root),
    inspectDirectoryChange(name, args, cwd, root),
    inspectEnvironmentAssignments(words, cwd, root),
    inspectInlineCodeExecution(name, args),
  ]) {
    if (result.action === "block") {
      return result;
    }
  }
  if (name === "mktemp" && !explicitMktempTarget(args)) {
    return block(
      "BLOCKED: `mktemp` without an explicit repository-contained template or temp directory writes outside the repository."
    );
  }
  return inspectCommandPathArguments(name, args, cwd, root);
}

function inspectShellRedirection(segment, cwd, root) {
  if (segment.operatorBefore !== ">" && segment.operatorBefore !== "<") {
    return allow();
  }
  const redirectedPath = segment.words[0];
  return typeof redirectedPath === "string"
    ? inspectBoundaryPath("shell redirection", redirectedPath, cwd, root)
    : allow();
}

function inspectDirectoryChange(name, args, cwd, root) {
  if (name === "popd") {
    return block(
      "BLOCKED: `popd` can leave the repository through dynamic directory-stack state. Use an explicit repository-contained working directory."
    );
  }
  if (name !== "cd" && name !== "pushd") {
    return allow();
  }
  const destination = args[0];
  if (!destination || destination === "-") {
    return block(
      `BLOCKED: \`${name}\` without an explicit repository-contained destination can leave the repository.`
    );
  }
  return inspectBoundaryPath(`${name} destination`, destination, cwd, root);
}

function inspectCommandPathArguments(name, args, cwd, root) {
  const inspectEveryArgument = !isReadCommandName(name) && pathOperandCommands.has(name);
  let expressionPending = leadingExpressionCommands.has(name);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index] ?? "";
    const skipped = leadingExpressionAt(argument, expressionPending);
    if (skipped) {
      expressionPending = false;
      index += skipped.consumed;
      continue;
    }
    const option = directoryOptionAt(name, args, index) ?? readerPathOptionAt(name, args, index);
    if (option) {
      expressionPending = false;
      const result = inspectBoundaryPath(option.label, option.value, cwd, root);
      if (result.action === "block") {
        return result;
      }
      index += option.consumed;
      continue;
    }
    if (inspectEveryArgument || looksLikePath(argument)) {
      const result = inspectBoundaryPath(`${name} path`, argument, cwd, root);
      if (result.action === "block") {
        return result;
      }
    }
  }
  return allow();
}

function directoryOptionAt(name, args, index) {
  const argument = args[index] ?? "";
  if (directoryValueOptions.has(argument) && typeof args[index + 1] === "string") {
    return { consumed: 1, label: `${name} ${argument}`, value: args[index + 1] };
  }
  const equals = argument.indexOf("=");
  if (equals > 0 && directoryValueOptions.has(argument.slice(0, equals))) {
    return { consumed: 0, label: `${name} option`, value: argument.slice(equals + 1) };
  }
  for (const option of directoryValueOptions) {
    if (option.length !== 2 || !argument.startsWith(option) || argument.length <= option.length) {
      continue;
    }
    const attached = argument.slice(option.length);
    return {
      consumed: 0,
      label: `${name} ${option}`,
      value: attached.startsWith("=") ? attached.slice(1) : attached,
    };
  }
}

function leadingExpressionAt(argument, expressionPending) {
  if (!expressionPending) {
    return;
  }
  if (patternValueOptions.has(argument)) {
    return { consumed: 1 };
  }
  return argument.startsWith("-") ? undefined : { consumed: 0 };
}

function readerPathOptionAt(name, args, index) {
  const flag = readerAttachedPathFlags.get(name);
  const argument = args[index] ?? "";
  if (!(flag && argument.startsWith("-")) || argument.startsWith("--")) {
    return;
  }
  const flagIndex = argument.indexOf(flag, 1);
  if (flagIndex === -1) {
    return;
  }
  const attached = argument.slice(flagIndex + 1);
  if (attached.length > 0) {
    return { consumed: 0, label: `${name} -${flag}`, value: attached };
  }
  return typeof args[index + 1] === "string"
    ? { consumed: 1, label: `${name} -${flag}`, value: args[index + 1] }
    : undefined;
}

function inspectBoundaryPath(label, value, cwd, root) {
  const result = inspectPath(value, cwd, root);
  return pathViolationBlock(label, value, result, root) ?? allow();
}

function inspectEnvironmentAssignments(words, cwd, root) {
  for (const word of words) {
    const equals = word.indexOf("=");
    if (equals <= 0 || !isShellIdentifier(word.slice(0, equals))) {
      continue;
    }
    const name = word.slice(0, equals);
    const value = word.slice(equals + 1);
    if (!(looksLikePath(value) || hasDynamicPathSyntax(value))) {
      continue;
    }
    if (value.includes("=") || hasPathListSeparator(value)) {
      return block(
        `BLOCKED: environment ${name} contains an uninspectable filesystem path. Use one explicit repository-contained path.`
      );
    }
    const result = inspectBoundaryPath(`environment ${name}`, value, cwd, root);
    if (result.action === "block") {
      return result;
    }
  }
  return allow();
}

function inspectInlineCodeExecution(name, args) {
  const options = name.startsWith("python") ? new Set(["-c"]) : inlineCodeOptions.get(name);
  const inlineSubcommand = name === "deno" && args[0] === "eval";
  const inlineOption = options
    ? args.some((argument) => options.has(argument.split("=")[0] ?? ""))
    : false;
  if (!(inlineSubcommand || inlineOption)) {
    return allow();
  }
  return block(
    `BLOCKED: inline ${name} code is not statically inspectable for repository confinement. Use a reviewed script stored inside the repository.`
  );
}

function isShellIdentifier(value) {
  if (value.length === 0 || !isIdentifierStart(value[0] ?? "")) {
    return false;
  }
  return [...value.slice(1)].every(isIdentifierCharacter);
}

function isIdentifierStart(character) {
  return (
    character === "_" ||
    (character >= "a" && character <= "z") ||
    (character >= "A" && character <= "Z")
  );
}

function isIdentifierCharacter(character) {
  return isIdentifierStart(character) || (character >= "0" && character <= "9");
}

function hasPathListSeparator(value) {
  if (path.delimiter === ";") {
    return value.includes(";");
  }
  const colon = value.indexOf(":");
  return colon > 1;
}

function structuredPathTargets(payload, cwd, root) {
  const input = payload?.tool_input;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return [];
  }

  const targets = [];
  if (payload?.tool_name === "apply_patch" && typeof input.command === "string") {
    for (const line of input.command.split("\n")) {
      const prefix = patchPathPrefixes.find((candidate) => line.startsWith(candidate));
      if (prefix) {
        targets.push({ label: "patch target", value: line.slice(prefix.length).trim() });
      }
    }
  }

  const localTool = localFilesystemToolNames.has(payload?.tool_name);
  const visit = (value, key = "") => {
    if (typeof value === "string") {
      if (
        isPathField(key) &&
        isFilesystemValue(value, key) &&
        (localTool || resolvesWithinRoot(value, cwd, root))
      ) {
        targets.push({ label: `tool_input.${key}`, value });
      }
      return;
    }
    if (!value || typeof value !== "object") {
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item, key);
      }
      return;
    }
    for (const [nextKey, nextValue] of Object.entries(value)) {
      if (nextKey !== "command") {
        visit(nextValue, nextKey.toLowerCase());
      }
    }
  };
  visit(input);
  return targets;
}

function resolvesWithinRoot(value, cwd, root) {
  return inspectPath(value, cwd, root).violation !== "outside";
}

function isPathField(key) {
  return (
    key === "cwd" ||
    key === "dir" ||
    key === "directory" ||
    key === "file" ||
    key === "path" ||
    key === "target" ||
    key === "uri" ||
    key === "workdir" ||
    key.endsWith("_cwd") ||
    key.endsWith("_dir") ||
    key.endsWith("_directory") ||
    key.endsWith("_file") ||
    key.endsWith("_files") ||
    key.endsWith("_path") ||
    key.endsWith("_paths")
  );
}

function isFilesystemValue(value, key) {
  if (key === "uri") {
    return value.startsWith("file:");
  }
  if (key === "target") {
    return looksLikePath(value);
  }
  return value.length > 0 && !hasNonFileScheme(value);
}

function inspectPath(value, cwd, root) {
  if (isNullDevice(value)) {
    return { resolved: value };
  }
  if (hasNonFileScheme(value)) {
    return { resolved: value };
  }

  let candidate = value;
  if (candidate.startsWith("file:")) {
    candidate = fileURLToPath(candidate);
  }
  if (hasDynamicPathSyntax(candidate)) {
    return { resolved: candidate, violation: "dynamic" };
  }

  const absolute = resolveSymlinkAwarePath(candidate, cwd);
  if (!isWithin(root, absolute)) {
    return { resolved: absolute, violation: "outside" };
  }
  const gitMetadata = path.join(root, ".git");
  if (isWithin(gitMetadata, absolute)) {
    return { resolved: absolute, violation: "git-metadata" };
  }

  const existing = nearestExistingPath(absolute);
  const realExisting = fs.realpathSync(existing);
  if (!isWithin(root, realExisting)) {
    return { resolved: absolute, violation: "outside" };
  }
  if (isWithin(gitMetadata, realExisting)) {
    return { resolved: absolute, violation: "git-metadata" };
  }
  return { resolved: absolute };
}

function resolveSymlinkAwarePath(value, cwd) {
  const absolute = path.isAbsolute(value) ? value : `${cwd}${path.sep}${value}`;
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const segment of pathSegments(absolute.slice(parsed.root.length))) {
    if (segment === "..") {
      current = path.dirname(current);
      continue;
    }
    current = path.join(current, segment);
    if (isSymbolicLink(current)) {
      current = fs.realpathSync(current);
    }
  }
  return current;
}

function pathSegments(value) {
  return value
    .split("/")
    .flatMap((part) => part.split("\\"))
    .filter((segment) => segment.length > 0 && segment !== ".");
}

function isSymbolicLink(candidate) {
  try {
    return fs.lstatSync(candidate).isSymbolicLink();
  } catch {
    return false;
  }
}

function nearestExistingPath(value) {
  let candidate = value;
  while (!fs.existsSync(candidate)) {
    const parent = path.dirname(candidate);
    if (parent === candidate) {
      throw new Error(`no existing ancestor for path ${value}`);
    }
    candidate = parent;
  }
  return candidate;
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return !(relative.startsWith("..") || path.isAbsolute(relative));
}

function explicitMktempTarget(args) {
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index] ?? "";
    if (
      directoryValueOptions.has(argument) &&
      typeof args[index + 1] === "string" &&
      args[index + 1].length > 0
    ) {
      return true;
    }
    if (argument.startsWith("--tmpdir=") && argument.length > "--tmpdir=".length) {
      return true;
    }
    if (!argument.startsWith("-") && argument.length > 0) {
      return true;
    }
  }
  return false;
}

function looksLikePath(value) {
  return (
    path.isAbsolute(value) ||
    value === "." ||
    value === ".." ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    value.startsWith(".\\") ||
    value.startsWith("..\\") ||
    value.startsWith("file:") ||
    value.startsWith("~") ||
    value.includes("/") ||
    value.includes("\\")
  );
}

function hasDynamicPathSyntax(value) {
  return (
    value === "~" ||
    value.startsWith("~/") ||
    value.startsWith("~\\") ||
    value.includes("$") ||
    value.includes("`") ||
    value.includes("{") ||
    hasWindowsEnvironmentExpansion(value)
  );
}

function hasWindowsEnvironmentExpansion(value) {
  const first = value.indexOf("%");
  return first !== -1 && value.indexOf("%", first + 1) > first + 1;
}

function hasNonFileScheme(value) {
  const separator = value.indexOf("://");
  if (separator <= 0) {
    return false;
  }
  const scheme = value.slice(0, separator).toLowerCase();
  return scheme !== "file" && nonFileUriSchemes.has(scheme);
}

function isNullDevice(value) {
  const normalized = value.split("\\").join("/").toLowerCase();
  return normalized === "/dev/null" || normalized === "nul";
}

function isLinkedWorktreeMetadata(gitMetadata) {
  try {
    return !fs.lstatSync(gitMetadata).isDirectory();
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function promptTokens(value) {
  const normalized = String(value ?? "")
    .toLowerCase()
    .replaceAll("don't", "do not")
    .replaceAll("dont", "do not");
  const tokens = [];
  let token = "";
  for (const character of normalized) {
    const isTokenCharacter =
      (character >= "a" && character <= "z") ||
      (character >= "0" && character <= "9") ||
      character === "/" ||
      character === "_" ||
      character === "-";
    if (isTokenCharacter) {
      token += character;
    } else if (token) {
      tokens.push(token);
      token = "";
    }
  }
  if (token) {
    tokens.push(token);
  }
  return tokens;
}

function hasConditionalOrNegativeContext(tokens, actionIndex) {
  return tokens
    .slice(Math.max(0, actionIndex - 6), actionIndex)
    .some((token) => conditionalOrNegativeWords.has(token));
}

function allow() {
  return { action: "allow" };
}

function block(message) {
  return { action: "block", message };
}

function outsidePathBlock(label, value, root) {
  return block(
    `BLOCKED: repository boundary violation. ${label} resolves outside ${root}: ${value}. All filesystem work must remain inside the active repository.`
  );
}

function pathViolationBlock(label, value, result, root) {
  if (result.violation === "outside") {
    return outsidePathBlock(label, value, root);
  }
  if (result.violation === "dynamic") {
    return block(
      `BLOCKED: repository boundary violation. ${label} uses dynamic shell path syntax: ${value}. Use one explicit repository-contained path.`
    );
  }
  if (result.violation === "git-metadata") {
    return block(
      `BLOCKED: direct access to Git control metadata is prohibited by the active-branch boundary: ${value}. Use approved Git diagnostics instead.`
    );
  }
}
