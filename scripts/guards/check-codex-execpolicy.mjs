#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { codexExecPolicyEntries } from "../skills/sync-llm.mjs";
import { assert, ok, ROOT } from "./lib/guard-utils.js";

const oldMirrorText = "Claude Markdown policy is mirrored as comments";
const claudeRuleRoot = path.join(ROOT, ".claude", "rules");
const codexRuleRoot = path.join(ROOT, ".codex", "rules");

for (const relativePath of filesUnder(".codex/rules", ".rules")) {
  const text = fs.readFileSync(path.join(ROOT, relativePath), "utf8");
  assert(
    !text.includes(oldMirrorText),
    `${relativePath} must not be a comment-only Markdown mirror`
  );
}

for (const sourceRelativePath of filesUnder(".claude/rules", ".md")) {
  const sourcePath = path.join(ROOT, sourceRelativePath);
  const entries = codexExecPolicyEntries(fs.readFileSync(sourcePath, "utf8"), sourceRelativePath);
  if (entries.length === 0) {
    continue;
  }

  const targetRelativePath = codexRulePathFor(sourceRelativePath);
  const targetPath = path.join(ROOT, targetRelativePath);
  assert(fs.existsSync(targetPath), `${targetRelativePath} missing generated Codex rule`);

  const targetText = fs.readFileSync(targetPath, "utf8");
  assert(
    targetText.includes("prefix_rule("),
    `${targetRelativePath} must render codexExecPolicy as prefix_rule entries`
  );

  for (const [entryIndex, entry] of entries.entries()) {
    for (const command of entry.match) {
      assert(
        prefixMatchesCommand(entry.pattern, command),
        `${sourceRelativePath} codexExecPolicy[${entryIndex}] match does not match pattern: ${command}`
      );
    }
    for (const command of entry.not_match) {
      assert(
        !prefixMatchesCommand(entry.pattern, command),
        `${sourceRelativePath} codexExecPolicy[${entryIndex}] not_match matches pattern: ${command}`
      );
    }
  }
}

ok("CODEX_EXECPOLICY_OK");

function filesUnder(root, extension) {
  const absoluteRoot = path.join(ROOT, root);
  if (!fs.existsSync(absoluteRoot)) {
    return [];
  }
  const files = [];
  walk(root, extension, files);
  return files.sort();
}

function walk(relativeDir, extension, files) {
  for (const entry of fs.readdirSync(path.join(ROOT, relativeDir), { withFileTypes: true })) {
    const child = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      walk(child, extension, files);
    } else if (entry.name.endsWith(extension)) {
      files.push(child);
    }
  }
}

function codexRulePathFor(sourceRelativePath) {
  const relative = path.relative(claudeRuleRoot, path.join(ROOT, sourceRelativePath));
  const parsed = path.parse(relative);
  return path.join(path.relative(ROOT, codexRuleRoot), parsed.dir, `${parsed.name}.rules`);
}

function prefixMatchesCommand(pattern, command) {
  const words = shellWords(command);
  if (words.length < pattern.length) {
    return false;
  }
  return pattern.every((part, index) => {
    const word = words[index] ?? "";
    return Array.isArray(part) ? part.includes(word) : part === word;
  });
}

function shellWords(command) {
  const words = [];
  let word = "";
  let quote = "";
  let escaped = false;

  const pushWord = () => {
    if (word.length > 0) {
      words.push(word);
      word = "";
    }
  };

  for (const char of command) {
    if (escaped) {
      word += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = "";
      } else {
        word += char;
      }
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (isWhitespace(char)) {
      pushWord();
      continue;
    }
    word += char;
  }
  pushWord();
  return words;
}

function isWhitespace(char) {
  return char === " " || char === "\t" || char === "\n" || char === "\r" || char === "\f";
}
