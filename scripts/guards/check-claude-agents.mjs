#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { list, parseFrontmatter, scalar } from "../lib/frontmatter.mjs";
import { assert, ok, ROOT, readJson } from "./lib/guard-utils.js";

const forbiddenFragments = ["Anilize", "anilize", "@anilize", "anilize-code-map"];
const permissionModes = new Set([
  "default",
  "acceptEdits",
  "auto",
  "dontAsk",
  "bypassPermissions",
  "plan",
]);
const agentDir = path.join(ROOT, ".claude/agents");
const skillDir = path.join(ROOT, ".claude/skills");
if (!(fs.existsSync(agentDir) && fs.existsSync(path.join(ROOT, ".claude/settings.json")))) {
  ok("CLAUDE_AGENTS_SKIPPED_PRIVATE_SURFACE");
  process.exit(0);
}
const enabledMcpServers = new Set(readJson(".claude/settings.json").enabledMcpjsonServers ?? []);
const availableSkills = new Set(listDirectories(skillDir));
const names = new Map();

assert(fs.existsSync(agentDir), ".claude/agents must exist");

for (const fileName of listMarkdownFiles(agentDir)) {
  const relativePath = `.claude/agents/${fileName}`;
  const text = fs.readFileSync(path.join(agentDir, fileName), "utf8");
  for (const fragment of forbiddenFragments) {
    assert(!text.includes(fragment), `${relativePath} must not reference ${fragment}`);
  }

  const frontmatter = parseFrontmatter(text, relativePath).frontmatter;
  const name = scalar(frontmatter, "name");
  const description = scalar(frontmatter, "description");
  const permissionMode = scalar(frontmatter, "permissionMode");
  assert(name !== undefined, `${relativePath} missing required name`);
  assert(description !== undefined, `${relativePath} missing required description`);
  assert(isKebabName(name ?? ""), `${relativePath} name must be lowercase kebab-case`);
  assert(
    permissionMode === undefined || permissionModes.has(permissionMode),
    `${relativePath} permissionMode must be one of ${[...permissionModes].join(", ")}`
  );
  assert(!names.has(name), `${relativePath} duplicates agent name ${name} from ${names.get(name)}`);
  names.set(name, relativePath);

  for (const skill of list(frontmatter, "skills")) {
    assert(availableSkills.has(skill), `${relativePath} references missing skill ${skill}`);
  }
  for (const server of list(frontmatter, "mcpServers")) {
    assert(
      enabledMcpServers.has(server),
      `${relativePath} references disabled MCP server ${server}`
    );
  }
}

ok("CLAUDE_AGENTS_OK");

function listMarkdownFiles(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort();
}

function listDirectories(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function isKebabName(value) {
  return value.length > 0 && isLowercaseAscii(value[0] ?? "") && [...value].every(isKebabChar);
}

function isKebabChar(char) {
  return isLowercaseAscii(char) || isDigit(char) || char === "-";
}

function isLowercaseAscii(char) {
  const code = char.charCodeAt(0);
  return code >= 97 && code <= 122;
}

function isDigit(char) {
  const code = char.charCodeAt(0);
  return code >= 48 && code <= 57;
}
