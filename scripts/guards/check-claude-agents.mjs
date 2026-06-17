#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { assert, ok, ROOT, readJson } from "./lib/guard-utils.js";

const forbiddenFragments = ["Anilize", "anilize", "@anilize", "anilize-code-map"];
const frontmatterLinePattern = /\r?\n/;
const listItemPattern = /^\s+-\s+(.+)\s*$/;
const listStartPattern = /^([A-Za-z][A-Za-z0-9]*):\s*$/;
const namePattern = /^[a-z][a-z0-9-]*$/;
const permissionModes = new Set([
  "default",
  "acceptEdits",
  "auto",
  "dontAsk",
  "bypassPermissions",
  "plan",
]);
const scalarLinePattern = /^([A-Za-z][A-Za-z0-9]*):\s*(.+)\s*$/;
const agentDir = path.join(ROOT, ".claude/agents");
const skillDir = path.join(ROOT, ".claude/skills");
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

  const frontmatter = parseFrontmatter(text, relativePath);
  const name = scalar(frontmatter, "name");
  const description = scalar(frontmatter, "description");
  const permissionMode = scalar(frontmatter, "permissionMode");
  assert(name !== undefined, `${relativePath} missing required name`);
  assert(description !== undefined, `${relativePath} missing required description`);
  assert(namePattern.test(name ?? ""), `${relativePath} name must be lowercase kebab-case`);
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

function parseFrontmatter(text, relativePath) {
  const lines = text.split(frontmatterLinePattern);
  assert(lines[0] === "---", `${relativePath} must start with YAML frontmatter`);
  const out = new Map();
  let currentList;
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line === "---") {
      return out;
    }
    const listItem = line.match(listItemPattern);
    if (currentList && listItem) {
      out.get(currentList).push(unquote(listItem[1] ?? ""));
      continue;
    }
    const listStart = line.match(listStartPattern);
    if (listStart) {
      currentList = listStart[1];
      out.set(currentList, []);
      continue;
    }
    const scalarLine = line.match(scalarLinePattern);
    if (scalarLine) {
      currentList = undefined;
      out.set(scalarLine[1], unquote(scalarLine[2] ?? ""));
      continue;
    }
    if (!line.startsWith(" ") && line.trim() !== "") {
      currentList = undefined;
    }
  }
  assert(false, `${relativePath} frontmatter is not closed`);
}

function scalar(frontmatter, key) {
  const value = frontmatter.get(key);
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function list(frontmatter, key) {
  const value = frontmatter.get(key);
  return Array.isArray(value) ? value : [];
}

function unquote(value) {
  return value.trim().replace(/^["']|["']$/g, "");
}
