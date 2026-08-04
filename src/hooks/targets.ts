import { readdirSync, readFileSync } from "node:fs";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { lineagePrefix } from "../migrations/lineage.js";
import { pathContainsOrEqual } from "../paths.js";

const editTools = new Set(["Edit", "MultiEdit", "Write"]);
const addHeader = "*** Add File: ";
const deleteHeader = "*** Delete File: ";
const updateHeader = "*** Update File: ";
const moveHeader = "*** Move to: ";

export interface ChangedSchemaGroup {
  changed: string[];
  display: string;
}

export interface ArtifactEditTarget {
  operation: "delete" | "write";
  path: string;
  reviewedMigrationDelete?: true;
}

export function hookProjectDir(payload: unknown): string {
  const cwdValue =
    typeof payload === "object" && payload !== null ? Reflect.get(payload, "cwd") : undefined;
  const cwd = typeof cwdValue === "string" && cwdValue.length > 0 ? cwdValue : undefined;
  return resolve(cwd ?? process.env.CLAUDE_PROJECT_DIR ?? process.env.CODEX_PROJECT_DIR ?? ".");
}

export function hookEditTargets(payload: unknown, projectDir: string): string[] {
  if (typeof payload !== "object" || payload === null) {
    return [];
  }
  const toolNameValue = Reflect.get(payload, "tool_name");
  const toolName = typeof toolNameValue === "string" ? toolNameValue : "";
  const inputValue = Reflect.get(payload, "tool_input");
  if (typeof inputValue !== "object" || inputValue === null || Array.isArray(inputValue)) {
    return [];
  }
  if (toolName === "apply_patch") {
    const command = Reflect.get(inputValue, "command");
    return typeof command === "string" ? hookPatchTargets(command, projectDir) : [];
  }
  if (!editTools.has(toolName)) {
    return [];
  }
  const filePath = Reflect.get(inputValue, "file_path");
  if (typeof filePath === "string" && filePath.length > 0) {
    return [resolveHookTarget(projectDir, filePath)];
  }
  return [];
}

export function generatedArtifactEditTargets(
  payload: unknown,
  projectDir: string
): ArtifactEditTarget[] {
  if (typeof payload !== "object" || payload === null) {
    return [];
  }
  const toolNameValue = Reflect.get(payload, "tool_name");
  const toolName = typeof toolNameValue === "string" ? toolNameValue : "";
  const inputValue = Reflect.get(payload, "tool_input");
  if (typeof inputValue !== "object" || inputValue === null || Array.isArray(inputValue)) {
    return [];
  }
  if (toolName === "apply_patch") {
    const command = Reflect.get(inputValue, "command");
    return typeof command === "string" ? generatedArtifactPatchTargets(command, projectDir) : [];
  }
  if (toolName === "Bash") {
    const command = Reflect.get(inputValue, "command");
    return typeof command === "string" ? bashArtifactTargets(command, projectDir) : [];
  }
  if (!editTools.has(toolName)) {
    return [];
  }
  const filePath = Reflect.get(inputValue, "file_path");
  if (typeof filePath === "string" && filePath.length > 0) {
    return [{ operation: "write", path: resolveHookTarget(projectDir, filePath) }];
  }
  return [];
}

export function changedSchemaTargets(
  paths: string[],
  schemaRoots: { display: string; root: string }[]
): { changed: string[]; groups: ChangedSchemaGroup[] } {
  const groups = new Map<string, ChangedSchemaGroup>();
  const changed: string[] = [];
  for (const path of paths) {
    if (!path.endsWith(".sql") || isGeneratedMigration(path)) {
      continue;
    }
    const matched = matchedSchemaRoot(path, schemaRoots);
    if (matched === undefined) {
      continue;
    }
    changed.push(path);
    const group = groups.get(matched.root) ?? { changed: [], display: matched.display };
    group.changed.push(path);
    groups.set(matched.root, group);
  }
  return { changed, groups: Array.from(groups.values()) };
}

export function migrationOutputs(stdout: string): string[] {
  return stdout
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.endsWith(".sql"))
    .map(slashPath);
}

export function isGeneratedMigration(path: string): boolean {
  if (!path.endsWith(".sql")) {
    return false;
  }
  try {
    return readFileSync(path, "utf8").includes(lineagePrefix);
  } catch {
    return false;
  }
}

export function rel(projectDir: string, path: string): string {
  const relPath = relative(projectDir, path);
  return slashPath(relPath.startsWith("..") ? path : relPath);
}

export function slashPath(path: string): string {
  return path.replaceAll("\\", "/");
}

function hookPatchTargets(patch: string, projectDir: string): string[] {
  const out: string[] = [];
  for (const line of patch.split("\n")) {
    const target = hookPatchLineTarget(line, projectDir);
    if (target !== undefined) {
      out.push(target);
    }
  }
  return out;
}

function generatedArtifactPatchTargets(
  patchText: string,
  projectDir: string
): ArtifactEditTarget[] {
  const writes: string[] = [];
  const deletes: string[] = [];
  const adds = new Set<string>();
  for (const line of patchText.split("\n")) {
    if (line.startsWith(updateHeader)) {
      writes.push(resolveHookTarget(projectDir, line.slice(updateHeader.length).trim()));
    } else if (line.startsWith(deleteHeader)) {
      deletes.push(resolveHookTarget(projectDir, line.slice(deleteHeader.length).trim()));
    } else if (line.startsWith(addHeader)) {
      adds.add(resolveHookTarget(projectDir, line.slice(addHeader.length).trim()));
    } else if (line.startsWith(moveHeader)) {
      writes.push(resolveHookTarget(projectDir, line.slice(moveHeader.length).trim()));
    }
  }
  return [
    ...writes.map((path): ArtifactEditTarget => ({ operation: "write", path })),
    ...[...adds].map((path): ArtifactEditTarget => ({ operation: "write", path })),
    ...deletes.map(
      (path): ArtifactEditTarget => ({
        operation: adds.has(path) ? "write" : "delete",
        path,
        ...(adds.has(path) ? {} : { reviewedMigrationDelete: true }),
      })
    ),
  ];
}

function bashArtifactTargets(command: string, projectDir: string): ArtifactEditTarget[] {
  const tokens = shellTokens(command);
  const targets: ArtifactEditTarget[] = [];
  const variables = new Map<string, string>();
  let segment: string[] = [];
  const flush = () => {
    targets.push(...bashSegmentTargets(segment, projectDir, variables));
    segment = [];
  };
  for (const token of tokens) {
    if (shellCommandSeparators.has(token)) {
      flush();
    } else {
      segment.push(token);
    }
  }
  flush();
  return targets;
}

const shellCommandSeparators = new Set(["&&", "||", ";", "|"]);
const shellRedirections = new Set([">", ">>", ">|"]);
const directWriteCommands = new Set(["cp", "install", "mv", "rm", "tee", "touch", "truncate"]);
const shellAssignmentCommands = new Set(["declare", "export", "local", "readonly", "typeset"]);

function mvMoveOperands(
  operands: string[],
  targetDirectory: string | undefined
): { destination: string | undefined; sources: string[] } {
  if (targetDirectory !== undefined) {
    return { destination: targetDirectory, sources: operands };
  }
  return { destination: operands.at(-1), sources: operands.slice(0, -1) };
}

function bashSegmentTargets(
  segment: string[],
  projectDir: string,
  variables: Map<string, string>
): ArtifactEditTarget[] {
  if (segment.length === 0) {
    return [];
  }
  const targets = redirectionTargets(segment, projectDir, variables);
  const commandIndex = shellCommandIndex(segment, variables);
  if (commandIndex === -1) {
    return targets;
  }
  const command = basename(segment[commandIndex] ?? "");
  const args = shellCommandArguments(segment.slice(commandIndex + 1));
  if (shellAssignmentCommands.has(command)) {
    for (const arg of args) {
      const assignment = environmentAssignment(arg, variables);
      if (assignment !== undefined) {
        variables.set(assignment.name, assignment.value);
      }
    }
  }
  targets.push(...directWriteTargets(command, args, projectDir, variables));
  targets.push(...flagWriteTargets(command, args, projectDir, variables));
  return targets;
}

function redirectionTargets(
  segment: string[],
  projectDir: string,
  variables: Map<string, string>
): ArtifactEditTarget[] {
  const targets: ArtifactEditTarget[] = [];
  for (let index = 0; index < segment.length - 1; index += 1) {
    if (shellRedirections.has(segment[index] ?? "")) {
      const value = segment[index + 1];
      if (value) {
        targets.push({
          operation: "write",
          path: resolveHookTarget(projectDir, expandShellVariables(value, variables)),
        });
      }
    }
  }
  return targets;
}

function directWriteTargets(
  command: string,
  args: string[],
  projectDir: string,
  variables: Map<string, string>
): ArtifactEditTarget[] {
  if (!directWriteCommands.has(command)) {
    return [];
  }
  const operands = args
    .filter((token, index) => {
      if (token.startsWith("-")) {
        return false;
      }
      const previous = args[index - 1];
      return previous !== "-t" && previous !== "--target-directory";
    })
    .map((token) => expandShellVariables(token, variables));
  const targetDirectory =
    command === "cp" || command === "mv" || command === "install"
      ? shellTargetDirectory(args, variables)
      : undefined;
  if (command === "mv") {
    const { destination, sources } = mvMoveOperands(operands, targetDirectory);
    const targets: ArtifactEditTarget[] = sources.map((path) => ({
      operation: "delete",
      path: resolveHookTarget(projectDir, path),
    }));
    if (destination !== undefined) {
      targets.push({ operation: "write", path: resolveHookTarget(projectDir, destination) });
    }
    return targets;
  }
  if (command === "install" && (args.includes("-d") || args.includes("--directory"))) {
    return operands.map(
      (path): ArtifactEditTarget => ({
        operation: "write",
        path: resolveHookTarget(projectDir, path),
      })
    );
  }
  const selected = directWriteOperands(command, operands, targetDirectory);
  return selected.map(
    (path): ArtifactEditTarget => ({
      operation: command === "rm" ? "delete" : "write",
      path: resolveHookTarget(projectDir, path),
    })
  );
}

function flagWriteTargets(
  command: string,
  args: string[],
  projectDir: string,
  variables: Map<string, string>
): ArtifactEditTarget[] {
  const inPlaceSed = command === "sed" && args.some(isInPlaceSedFlag);
  const writeFlag = args.some((arg) => writeFlags.has(arg) || arg.startsWith("--write="));
  if (!(inPlaceSed || writeFlag)) {
    return [];
  }
  const writeOperands = inPlaceSed
    ? sedInPlaceWriteOperands(args)
    : args.filter((arg) => !arg.startsWith("-") && isPotentialPath(arg));
  const flagTargets = args
    .map(writeFlagTarget)
    .filter((path): path is string => path !== undefined)
    .map((path) => expandShellVariables(path, variables));
  return [...writeOperands, ...flagTargets]
    .map((path) => expandShellVariables(path, variables))
    .map(
      (path): ArtifactEditTarget => ({
        operation: "write",
        path: resolveHookTarget(projectDir, path),
      })
    );
}

const writeFlags = new Set(["--fix", "--write", "-w"]);

function sedInPlaceWriteOperands(args: string[]): string[] {
  const operands: string[] = [];
  let scriptProvidedByFlag = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (isInPlaceSedFlag(arg)) {
      const possibleBackupSuffix = args[index + 1] ?? "";
      if (arg === "-i" && possibleBackupSuffix.startsWith(".")) {
        index += 1;
      }
      continue;
    }
    if (arg === "-e" || arg === "--expression" || arg === "-f" || arg === "--file") {
      scriptProvidedByFlag = true;
      index += 1;
      continue;
    }
    if (
      arg.startsWith("-e") ||
      arg.startsWith("--expression=") ||
      arg.startsWith("-f") ||
      arg.startsWith("--file=")
    ) {
      scriptProvidedByFlag = true;
      continue;
    }
    if (!arg.startsWith("-") && isPotentialPath(arg)) {
      operands.push(arg);
    }
  }
  return scriptProvidedByFlag ? operands : operands.slice(1);
}

function directWriteOperands(
  command: string,
  operands: string[],
  targetDirectory: string | undefined
): string[] {
  if (targetDirectory !== undefined) {
    return command === "mv" ? [...operands, targetDirectory] : [targetDirectory];
  }
  if (command === "cp" || command === "install") {
    return operands.slice(-1);
  }
  return operands;
}

function shellTargetDirectory(args: string[], variables: Map<string, string>): string | undefined {
  for (const [index, arg] of args.entries()) {
    if (arg === "-t" || arg === "--target-directory") {
      const value = args[index + 1];
      return value === undefined ? undefined : expandShellVariables(value, variables);
    }
    if (arg.startsWith("--target-directory=")) {
      return expandShellVariables(arg.slice("--target-directory=".length), variables);
    }
  }
}

function writeFlagTarget(value: string): string | undefined {
  return value.startsWith("--write=") && value.length > "--write=".length
    ? value.slice("--write=".length)
    : undefined;
}

function isInPlaceSedFlag(value: string): boolean {
  return value.startsWith("-i") || value === "--in-place" || value.startsWith("--in-place=");
}

function isPotentialPath(value: string): boolean {
  return value !== "" && !value.includes("=");
}

const shellNullaryWrappers = new Set(["builtin", "command", "exec", "nohup"]);
const shellWrapperValueOptions: Record<string, Set<string>> = {
  env: new Set(["-C", "-P", "-S", "-u", "--chdir", "--split-string", "--unset", "--argv0"]),
  sudo: new Set([
    "-C",
    "-g",
    "-h",
    "-p",
    "-R",
    "-T",
    "-t",
    "-U",
    "-u",
    "--chdir",
    "--group",
    "--host",
    "--user",
  ]),
};

function shellCommandIndex(segment: string[], variables: Map<string, string>): number {
  let index = 0;
  while (index < segment.length) {
    const assignment = environmentAssignment(segment[index] ?? "", variables);
    if (assignment !== undefined) {
      variables.set(assignment.name, assignment.value);
      index += 1;
      continue;
    }
    const redirection = shellRedirectionAt(segment, index);
    if (redirection !== undefined) {
      index = redirection.nextIndex;
      continue;
    }
    const wrapperSkip = shellWrapperSkip(segment, index);
    if (wrapperSkip > 0) {
      index += wrapperSkip;
      continue;
    }
    return index;
  }
  return -1;
}

function shellWrapperSkip(segment: string[], index: number): number {
  const token = basename(segment[index] ?? "");
  if (shellNullaryWrappers.has(token)) {
    return 1;
  }
  const valueOptions = shellWrapperValueOptions[token];
  if (valueOptions === undefined) {
    return 0;
  }
  let skip = 1;
  while (index + skip < segment.length) {
    const option = segment[index + skip] ?? "";
    if (!option.startsWith("-")) {
      break;
    }
    skip += valueOptions.has(option) ? 2 : 1;
  }
  return skip;
}

function shellCommandArguments(segment: string[]): string[] {
  const args: string[] = [];
  let index = 0;
  while (index < segment.length) {
    const redirection = shellRedirectionAt(segment, index);
    if (redirection !== undefined) {
      index = redirection.nextIndex;
      continue;
    }
    args.push(segment[index] ?? "");
    index += 1;
  }
  return args;
}

function shellRedirectionAt(tokens: string[], index: number): { nextIndex: number } | undefined {
  if (shellRedirections.has(tokens[index] ?? "")) {
    return { nextIndex: Math.min(index + 2, tokens.length) };
  }
  if (
    isFileDescriptorToken(tokens[index] ?? "") &&
    shellRedirections.has(tokens[index + 1] ?? "")
  ) {
    return { nextIndex: Math.min(index + 3, tokens.length) };
  }
}

function isFileDescriptorToken(value: string): boolean {
  if (value === "&") {
    return true;
  }
  return value.length > 0 && [...value].every((char) => char >= "0" && char <= "9");
}

function environmentAssignment(
  value: string,
  variables: Map<string, string>
): { name: string; value: string } | undefined {
  const separator = value.indexOf("=");
  if (separator <= 0) {
    return;
  }
  const name = value.slice(0, separator);
  if (!isShellVariableStart(name[0] ?? "")) {
    return;
  }
  for (const char of name.slice(1)) {
    if (!isShellVariablePart(char)) {
      return;
    }
  }
  return {
    name,
    value: expandShellVariables(value.slice(separator + 1), variables),
  };
}

function expandShellVariables(value: string, variables: Map<string, string>): string {
  let expanded = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index] ?? "";
    if (char !== "$") {
      expanded += char;
      continue;
    }
    const braced = value[index + 1] === "{";
    const nameStart = index + (braced ? 2 : 1);
    let nameEnd = nameStart;
    while (nameEnd < value.length && isShellVariablePart(value[nameEnd] ?? "")) {
      nameEnd += 1;
    }
    if (nameEnd === nameStart || (braced && value[nameEnd] !== "}")) {
      expanded += char;
      continue;
    }
    const name = value.slice(nameStart, nameEnd);
    const replacement = variables.get(name) ?? process.env[name];
    const tokenEnd = braced ? nameEnd + 1 : nameEnd;
    if (replacement === undefined) {
      expanded += value.slice(index, tokenEnd);
    } else {
      expanded += replacement;
    }
    index = tokenEnd - 1;
  }
  return expanded;
}

function isShellVariableStart(char: string): boolean {
  return (char >= "a" && char <= "z") || (char >= "A" && char <= "Z") || char === "_";
}

function isShellVariablePart(char: string): boolean {
  return isShellVariableStart(char) || (char >= "0" && char <= "9");
}

function shellTokens(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  const push = () => {
    if (current !== "") {
      tokens.push(current);
      current = "";
    }
  };
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index] ?? "";
    if (quote) {
      const consumed = consumeQuotedChar(command, index, quote, current);
      current = consumed.current;
      index = consumed.index;
      quote = consumed.quote;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (
      char === "\\" &&
      index + 1 < command.length &&
      shellEscapable.has(command[index + 1] ?? "")
    ) {
      index += 1;
      current += command[index] ?? "";
      continue;
    }
    if (isShellWhitespace(char)) {
      push();
      continue;
    }
    const operator = shellOperator(command, index);
    if (operator) {
      push();
      tokens.push(operator);
      index += operator.length - 1;
      continue;
    }
    current += char;
  }
  push();
  return tokens;
}

function consumeQuotedChar(
  command: string,
  index: number,
  quote: "'" | '"',
  current: string
): { current: string; index: number; quote: "'" | '"' | undefined } {
  const char = command[index] ?? "";
  if (char === quote) {
    return { current, index, quote: undefined };
  }
  if (
    char === "\\" &&
    quote === '"' &&
    index + 1 < command.length &&
    doubleQuoteEscapable.has(command[index + 1] ?? "")
  ) {
    return { current: current + (command[index + 1] ?? ""), index: index + 1, quote };
  }
  return { current: current + char, index, quote };
}

const shellEscapable = new Set([
  " ",
  "\t",
  "\n",
  "\r",
  "'",
  '"',
  "`",
  "$",
  "\\",
  "|",
  ";",
  ">",
  "<",
  "&",
  "(",
  ")",
]);
const doubleQuoteEscapable = new Set(['"', "\\", "$", "`"]);

function shellOperator(command: string, index: number): string | undefined {
  const pair = command.slice(index, index + 2);
  if (pair === "&&" || pair === "||" || pair === ">>" || pair === ">|") {
    return pair;
  }
  const char = command[index];
  return char === ";" || char === "|" || char === ">" ? char : undefined;
}

function isShellWhitespace(char: string): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r";
}

export function artifactTargetMatches(target: string, artifact: string): boolean {
  const targetPath = slashPath(target);
  const artifactPath = slashPath(artifact);
  return hasWildcard(targetPath)
    ? wildcardMatches(targetPath, artifactPath)
    : pathContainsOrEqual(targetPath, artifactPath);
}

function hasWildcard(value: string): boolean {
  return value.includes("*") || value.includes("?");
}

function wildcardMatches(pattern: string, value: string): boolean {
  let patternIndex = 0;
  let valueIndex = 0;
  let starIndex = -1;
  let starValueIndex = -1;
  while (valueIndex < value.length) {
    const token = pattern[patternIndex];
    if (token === "?" || token === value[valueIndex]) {
      patternIndex += 1;
      valueIndex += 1;
      continue;
    }
    if (token === "*") {
      starIndex = patternIndex;
      starValueIndex = valueIndex;
      patternIndex += 1;
      continue;
    }
    if (starIndex === -1) {
      return false;
    }
    patternIndex = starIndex + 1;
    starValueIndex += 1;
    valueIndex = starValueIndex;
  }
  while (pattern[patternIndex] === "*") {
    patternIndex += 1;
  }
  return patternIndex === pattern.length;
}

export function generatedMigrationsIn(directory: string | undefined): string[] {
  if (!directory) {
    return [];
  }
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
      .map((entry) => resolve(directory, entry.name))
      .filter(isGeneratedMigration);
  } catch {
    return [];
  }
}

function hookPatchLineTarget(line: string, projectDir: string): string | undefined {
  if (line.startsWith(addHeader)) {
    return resolveHookTarget(projectDir, line.slice(addHeader.length).trim());
  }
  if (line.startsWith(deleteHeader)) {
    return resolveHookTarget(projectDir, line.slice(deleteHeader.length).trim());
  }
  if (line.startsWith(updateHeader)) {
    return resolveHookTarget(projectDir, line.slice(updateHeader.length).trim());
  }
  if (line.startsWith(moveHeader)) {
    return resolveHookTarget(projectDir, line.slice(moveHeader.length).trim());
  }
}

function resolveHookTarget(projectDir: string, path: string): string {
  const normalized = slashPath(path);
  return isAbsolute(normalized) ? resolve(normalized) : resolve(projectDir, normalized);
}

function matchedSchemaRoot(
  path: string,
  schemaRoots: { display: string; root: string }[]
): { display: string; root: string } | undefined {
  const matches = schemaRoots.filter((entry) => pathContainsOrEqual(entry.root, path));
  return matches.sort((left, right) => right.root.length - left.root.length)[0];
}
