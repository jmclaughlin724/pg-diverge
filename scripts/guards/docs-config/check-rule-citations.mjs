#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, ok } from "../lib/assertions.js";
import { gitTrackedFiles, ROOT } from "../lib/repository.js";

function numberedRulePrefix(name) {
  if (name.length < 6 || !name.endsWith(".md") || name[2] !== "-") {
    return;
  }
  const prefix = name.slice(0, 2);
  return isDigits(prefix) ? prefix : undefined;
}

function ruleCitationNumbers(line) {
  const tokens = tokensForLine(line);
  const numbers = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.kind !== "word" || !(token.value === "rule" || token.value === "rules")) {
      continue;
    }
    for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
      const current = tokens[cursor];
      if (current.kind === "number" && current.value.length <= 2) {
        numbers.push(current.value);
        continue;
      }
      if (
        (current.kind === "word" && current.value === "and") ||
        (current.kind === "symbol" &&
          (current.value === "," || current.value === "/" || current.value === "#"))
      ) {
        continue;
      }
      break;
    }
  }
  return numbers;
}

function tokensForLine(line) {
  const tokens = [];
  let index = 0;
  while (index < line.length) {
    const char = line[index] ?? "";
    if (isAsciiLetter(char)) {
      const start = index;
      index += 1;
      while (index < line.length && isAsciiLetter(line[index] ?? "")) {
        index += 1;
      }
      tokens.push({ kind: "word", value: line.slice(start, index).toLowerCase() });
      continue;
    }
    if (isDigit(char)) {
      const start = index;
      index += 1;
      while (index < line.length && isDigit(line[index] ?? "")) {
        index += 1;
      }
      tokens.push({ kind: "number", value: line.slice(start, index) });
      continue;
    }
    if (char === "," || char === "/" || char === "#") {
      tokens.push({ kind: "symbol", value: char });
    }
    index += 1;
  }
  return tokens;
}

function isDigits(value) {
  return value.length > 0 && [...value].every(isDigit);
}

function isAsciiLetter(char) {
  const code = char.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isDigit(char) {
  const code = char.charCodeAt(0);
  return code >= 48 && code <= 57;
}

export function check(root = ROOT) {
  const ruleDir = path.join(root, ".claude", "rules");
  const validNumbers = new Set();
  for (const name of fs.readdirSync(ruleDir)) {
    const prefix = numberedRulePrefix(name);
    if (prefix !== undefined) {
      validNumbers.add(prefix);
    }
  }
  assert(validNumbers.size > 0, "no numbered .claude/rules/NN-*.md files found");

  const scanRoots = [".claude/rules", ".claude/skills", ".codex/rules", ".agents/skills"];
  const scanExtensions = [".md", ".rules"];
  const extraFiles = ["AGENTS.md", "CLAUDE.md"];
  const trackedFiles = gitTrackedFiles(root);
  const violations = [];

  function scanText(rel, text) {
    const lines = text.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      for (const raw of ruleCitationNumbers(lines[index] ?? "")) {
        const nn = raw.padStart(2, "0");
        if (!validNumbers.has(nn)) {
          violations.push(`${rel}:${index + 1}: cites "rule ${raw}" but no rule ${nn} exists`);
        }
      }
    }
  }

  function walk(dir) {
    for (const rel of trackedFiles) {
      if (
        (rel === dir || rel.startsWith(`${dir}/`)) &&
        scanExtensions.some((ext) => rel.endsWith(ext))
      ) {
        scanText(rel, fs.readFileSync(path.join(root, rel), "utf8"));
      }
    }
  }

  for (const scanRoot of scanRoots) {
    walk(scanRoot);
  }
  for (const file of extraFiles) {
    if (trackedFiles.includes(file) && fs.existsSync(path.join(root, file))) {
      scanText(file, fs.readFileSync(path.join(root, file), "utf8"));
    }
  }

  assert(violations.length === 0, `stale rule citations found:\n${violations.join("\n")}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  check();
  ok("RULE_CITATIONS_OK");
}
