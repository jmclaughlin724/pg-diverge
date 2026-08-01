#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  executableName,
  parseShellCommand,
  parseStaticArguments,
  staticWordValue,
} from "../../../scripts/agent-hooks/shell-command.mjs";

const postgresClassifier = fileURLToPath(
  new URL("../../../scripts/agent-hooks/postgres-ddl.mjs", import.meta.url)
);

export function evaluateBashPolicy(input, env = process.env, options = {}) {
  if (input?.tool_name !== "Bash") {
    return allowResult();
  }
  const command = commandFromPayload(input);
  if (!command.trim()) {
    return allowResult();
  }
  const analysis = parseShellCommand(command);
  if (analysis.errors.length > 0) {
    return allowResult();
  }
  const secretArgumentResult = checkSecretArguments(analysis.invocations, env);
  if (secretArgumentResult.action === "block") {
    return secretArgumentResult;
  }
  const secretFileResult = checkSecretFileDisplays(analysis.invocations);
  if (secretFileResult.action === "block") {
    return secretFileResult;
  }
  const ddlResult = checkRawSqlDdl(analysis.invocations);
  if (ddlResult.action === "block") {
    return ddlResult;
  }
  return checkRecursiveForcedDeletion(analysis.invocations, input, env, options);
}

function commandFromPayload(input) {
  const toolInput = input?.tool_input ?? {};
  if (typeof toolInput.command === "string") {
    return toolInput.command;
  }
  return typeof toolInput.cmd === "string" ? toolInput.cmd : "";
}

function allowResult() {
  return { action: "allow" };
}

function block(message) {
  return { action: "block", message };
}

function collectAssignmentSecretHits(assignments, hits) {
  for (const assignment of assignments) {
    const value = staticWordValue(assignment.value);
    if (
      typeof assignment.name === "string" &&
      sensitiveName(assignment.name) &&
      literalSecretValue(value)
    ) {
      hits.push(`inline secret environment variable ${assignment.name}=<literal>`);
    }
  }
}

function collectArgumentSecretHits(values, env, hits) {
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === null) {
      continue;
    }
    if (databaseUrlHasLiteralPassword(value)) {
      hits.push("database connection URL with inline password");
    }
    const assignment = environmentAssignment(value);
    if (assignment && sensitiveName(assignment.name) && literalSecretValue(assignment.value)) {
      hits.push(`inline secret environment variable ${assignment.name}=<literal>`);
    }
    const flagged = secretFlagValue(values, index);
    if (flagged && literalSecretValue(flagged.value)) {
      hits.push(`${flagged.name} literal in argv`);
    }
    const environmentName = matchingSecretEnvironmentName(value, env);
    if (environmentName) {
      hits.push(`literal value of secret environment variable ${environmentName}`);
    }
  }
}

function checkSecretArguments(invocations, env) {
  const hits = [];
  for (const invocation of invocations) {
    collectAssignmentSecretHits(invocation.assignments, hits);
    collectArgumentSecretHits(invocation.arguments.map(staticWordValue), env, hits);
  }
  if (hits.length === 0) {
    return allowResult();
  }
  return block(
    "BLOCKED: Secret material detected in Bash argv.\n\n" +
      `Matched classifications:\n  - ${[...new Set(hits)].join("\n  - ")}\n\n` +
      "Use env-var references, stdin, or a secure file/secret-manager handoff. Do not put secrets in command argv."
  );
}

function checkSecretFileDisplays(invocations) {
  const matches = [];
  for (const invocation of invocations) {
    if (executableName(invocation.executable) !== "cat") {
      continue;
    }
    for (const word of invocation.arguments) {
      const value = staticWordValue(word);
      if (value === null || value.startsWith("-")) {
        continue;
      }
      const fileName = secretFileName(value);
      if (fileName) {
        matches.push(fileName);
      }
    }
  }
  if (matches.length === 0) {
    return allowResult();
  }
  return block(
    "BLOCKED: Direct display of a known secret-bearing file is prohibited.\n\n" +
      `Matched file(s): ${[...new Set(matches)].join(", ")}\n\n` +
      "Use env-var references, a non-secret example/template file, or an approved secret-manager command."
  );
}

function checkRawSqlDdl(invocations) {
  for (const invocation of invocations) {
    for (const sql of literalPostgresArguments(invocation)) {
      const classification = classifyPostgresSql(sql);
      if (!classification.ddl) {
        continue;
      }
      return block(
        `BLOCKED: raw SQL DDL through Bash detected: ${classification.tag}.\n\n` +
          "Structural database changes must go through the declarative schema and generated migration workflow. This hook classifies only direct literal CLI arguments; SQL files, stdin, and heredocs remain outside this hook and are governed by project policy and Supaschema checks."
      );
    }
  }
  return allowResult();
}

function literalPostgresArguments(invocation) {
  const name = executableName(invocation.executable);
  if (name === "psql") {
    const parsed = parseStaticArguments(invocation.arguments, {
      options: { command: { multiple: true, short: "c", type: "string" } },
    });
    return staticOptionValues(parsed.values.command);
  }
  if (name !== "supabase") {
    return [];
  }
  const parsed = parseStaticArguments(invocation.arguments, {
    options: { sql: { multiple: true, type: "string" } },
  });
  if (!(parsed.positionals[0] === "db" && postgresSupabaseSubcommand(parsed.positionals[1]))) {
    return [];
  }
  return staticOptionValues(parsed.values.sql);
}

function postgresSupabaseSubcommand(value) {
  return value === "execute" || value === "query";
}

function staticOptionValues(value) {
  let values = [];
  if (Array.isArray(value)) {
    values = value;
  } else if (typeof value === "string") {
    values = [value];
  }
  return values.filter((item) => !item.startsWith("agent-hook-dynamic-"));
}

function classifyPostgresSql(sql) {
  const result = spawnSync(process.execPath, [postgresClassifier], {
    encoding: "utf8",
    input: sql,
    maxBuffer: 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 2000,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const stderr = String(result.stderr ?? "")
      .trim()
      .slice(0, 2000);
    throw new Error(`PostgreSQL parser exited with status ${String(result.status)}: ${stderr}`);
  }
  const parsed = JSON.parse(result.stdout);
  if (!(parsed && typeof parsed === "object" && typeof parsed.ddl === "boolean")) {
    throw new Error("PostgreSQL parser returned an invalid classification");
  }
  return parsed;
}

function checkRecursiveForcedDeletion(invocations, input, env, options) {
  for (const invocation of invocations) {
    if (executableName(invocation.executable) !== "rm") {
      continue;
    }
    const parsed = parseStaticArguments(invocation.arguments, {
      options: {
        force: { short: "f", type: "boolean" },
        recursive: { short: "r", type: "boolean" },
        recursiveUpper: { short: "R", type: "boolean" },
      },
    });
    if (!(parsed.values.force && (parsed.values.recursive || parsed.values.recursiveUpper))) {
      continue;
    }
    for (const token of parsed.tokens) {
      if (token.kind !== "positional") {
        continue;
      }
      const word = invocation.arguments[token.index];
      const target = staticWordValue(word);
      if (target === null) {
        return block(
          "BLOCKED: recursive forced deletion has an unresolved variable, glob, or command-substitution target. Use a literal path whose resolved scope can be reviewed."
        );
      }
      if (dangerousResolvedDeletionTarget(target, input, env, options)) {
        return block(
          "BLOCKED: recursive forced deletion resolves to the filesystem root, user home, repository root, or a repository ancestor. Use a narrower literal target."
        );
      }
    }
  }
  return allowResult();
}

function dangerousResolvedDeletionTarget(target, input, env, options) {
  const root = canonicalPath(options.root ?? path.resolve("."));
  const homeValue = env.HOME ?? env.USERPROFILE ?? "";
  const home = homeValue ? canonicalPath(homeValue) : "";
  const cwd = input?.tool_input?.cwd ?? input?.cwd ?? path.resolve(".");
  let expanded = target;
  if (target === "~") {
    expanded = homeValue;
  } else if (target.startsWith("~/")) {
    expanded = path.join(homeValue, target.slice(2));
  }
  const resolved = canonicalPath(
    path.isAbsolute(expanded) ? expanded : path.resolve(cwd, expanded)
  );
  return (
    resolved === path.parse(resolved).root ||
    (home && resolved === home) ||
    resolved === root ||
    isAncestorPath(resolved, root)
  );
}

function canonicalPath(value) {
  const resolved = path.resolve(value);
  return existsSync(resolved) ? realpathSync(resolved) : resolved;
}

const { pathContainsOrEqual } = await import(
  new URL("../../../src/paths.ts", import.meta.url).href
);

function isAncestorPath(candidate, descendant) {
  return pathContainsOrEqual(candidate, descendant) && !pathContainsOrEqual(descendant, candidate);
}

function databaseUrlHasLiteralPassword(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (
    parsed.protocol !== "mysql:" &&
    parsed.protocol !== "postgres:" &&
    parsed.protocol !== "postgresql:"
  ) {
    return false;
  }
  return literalSecretValue(parsed.password);
}

function environmentAssignment(value) {
  const separator = value.indexOf("=");
  if (separator <= 0) {
    return;
  }
  const name = value.slice(0, separator);
  if (!environmentIdentifier(name)) {
    return;
  }
  return { name, value: value.slice(separator + 1) };
}

function environmentIdentifier(value) {
  if (!(value && (asciiLetter(value[0]) || value[0] === "_"))) {
    return false;
  }
  return [...value.slice(1)].every(
    (character) => asciiLetter(character) || asciiDigit(character) || character === "_"
  );
}

function sensitiveName(value) {
  const words = identifierWords(value);
  for (const [index, word] of words.entries()) {
    if (
      word === "credential" ||
      word === "credentials" ||
      word === "passwd" ||
      word === "password" ||
      word === "secret" ||
      word === "token"
    ) {
      return true;
    }
    if (word === "key" && (words[index - 1] === "api" || words[index - 1] === "private")) {
      return true;
    }
  }
  return false;
}

function secretFlagValue(values, index) {
  const value = values[index];
  if (!(typeof value === "string" && value.startsWith("--"))) {
    return;
  }
  const separator = value.indexOf("=");
  const name = separator === -1 ? value.slice(2) : value.slice(2, separator);
  if (!sensitiveName(name)) {
    return;
  }
  if (separator !== -1) {
    return { name: `--${name}`, value: value.slice(separator + 1) };
  }
  const next = values[index + 1];
  return typeof next === "string" ? { name: `--${name}`, value: next } : undefined;
}

function matchingSecretEnvironmentName(value, env) {
  if (!literalSecretValue(value)) {
    return "";
  }
  for (const [name, environmentValue] of Object.entries(env)) {
    if (sensitiveName(name) && environmentValue === value) {
      return name;
    }
  }
  return "";
}

function literalSecretValue(value) {
  return typeof value === "string" && value.length >= 12 && !maskedValue(value);
}

const maskedMarkers = [
  "redacted",
  "password-here",
  "secret-here",
  "token-here",
  ["place", "holder"].join(""),
];

function maskedValue(value) {
  const normalized = value.toLowerCase();
  if (maskedMarkers.some((marker) => normalized.includes(marker))) {
    return true;
  }
  const meaningful = [...normalized].filter(
    (character) => asciiLetter(character) || asciiDigit(character)
  );
  return meaningful.length > 0 && new Set(meaningful).size === 1;
}

function secretFileName(value) {
  const fileName = path.basename(value.split("\\").join("/"));
  if (templateFileName(fileName)) {
    return "";
  }
  if (fileName === ".env" || fileName.startsWith(".env.")) {
    return fileName;
  }
  if (fileName === ".netrc" || fileName === ".npmrc" || fileName === ".pgpass") {
    return fileName;
  }
  return "";
}

function templateFileName(fileName) {
  for (const word of identifierWords(fileName)) {
    if (
      word === "default" ||
      word === "defaults" ||
      word === "example" ||
      word === "sample" ||
      word === "template"
    ) {
      return true;
    }
  }
  return false;
}

function identifierWords(value) {
  const words = [];
  let current = "";
  for (const character of String(value)) {
    if (asciiLetter(character) || asciiDigit(character)) {
      current += character.toLowerCase();
    } else if (current) {
      words.push(current);
      current = "";
    }
  }
  if (current) {
    words.push(current);
  }
  return words;
}

function asciiLetter(character) {
  const code = character?.charCodeAt(0) ?? -1;
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function asciiDigit(character) {
  const code = character?.charCodeAt(0) ?? -1;
  return code >= 48 && code <= 57;
}

function main() {
  try {
    const raw = readFileSync(0, "utf8");
    const result = evaluateBashPolicy(raw.trim() ? JSON.parse(raw) : {});
    if (result.action === "block") {
      process.stderr.write(`${result.message}\n`);
      process.exit(2);
    }
  } catch (error) {
    process.stderr.write(
      `Agent hook warning: bash policy check crashed; no policy decision was made: ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exit(1);
  }
}

function isMainModule() {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  const modulePath = fileURLToPath(import.meta.url);
  try {
    return realpathSync(entry) === realpathSync(modulePath);
  } catch {
    return entry === modulePath;
  }
}

if (isMainModule()) {
  main();
}
