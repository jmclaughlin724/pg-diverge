#!/usr/bin/env node
// Rule-citation integrity guard. Every "rule NN" reference in the agent bundle
// (rules, skills, the Codex/agents mirrors, and the root AGENTS/CLAUDE briefs)
// must resolve to an existing .claude/rules/NN-*.md file. The de-templating pass
// renumbered the rules to a clean 00-13 sequence but left dangling citations
// (rules 16/18/23/24/25/27) behind because nothing enforced the namespace.
// Rule 01: no standard without enforcement.
import fs from "node:fs";
import path from "node:path";
import { assert, ok, ROOT } from "./lib/guard-utils.js";

// The valid citation namespace is derived from the actual numbered rule files, so
// it auto-adapts the next time a rule is added, removed, or renumbered.
const ruleDir = path.join(ROOT, ".claude", "rules");
const validNumbers = new Set();
for (const name of fs.readdirSync(ruleDir)) {
  const prefix = /^(\d{2})-.+\.md$/.exec(name); // regex-ok: 2-digit rule filename prefix (text, not code structure)
  if (prefix) {
    validNumbers.add(prefix[1]);
  }
}
assert(validNumbers.size > 0, "no numbered .claude/rules/NN-*.md files found");

const scanRoots = [
  ".claude/rules",
  ".claude/skills",
  ".codex/rules",
  ".codex/skills",
  ".agents/skills",
];
const scanExtensions = [".md", ".rules"];
const extraFiles = ["AGENTS.md", "CLAUDE.md"];

// regex-ok: free-text scan for "rule NN" citations over markdown prose (not code structure)
const citationRe = /\b[Rr]ules?\s+#?\d{1,2}(?:\s*(?:and|,|\/)\s*#?\d{1,2})*/g;
const digitRe = /\d{1,2}/g; // regex-ok: extract cited numbers from a matched citation string

const violations = [];

function scanText(rel, text) {
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const citations = lines[index].match(citationRe);
    if (!citations) {
      continue;
    }
    for (const citation of citations) {
      for (const raw of citation.match(digitRe) ?? []) {
        const nn = raw.padStart(2, "0");
        if (!validNumbers.has(nn)) {
          violations.push(`${rel}:${index + 1}: cites "rule ${raw}" but no rule ${nn} exists`);
        }
      }
    }
  }
}

function walk(dir) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) {
    return;
  }
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(rel);
    } else if (scanExtensions.some((ext) => entry.name.endsWith(ext))) {
      scanText(rel, fs.readFileSync(path.join(ROOT, rel), "utf8"));
    }
  }
}

for (const root of scanRoots) {
  walk(root);
}
for (const file of extraFiles) {
  if (fs.existsSync(path.join(ROOT, file))) {
    scanText(file, fs.readFileSync(path.join(ROOT, file), "utf8"));
  }
}

assert(violations.length === 0, `stale rule citations found:\n${violations.join("\n")}`);
ok("RULE_CITATIONS_OK");
