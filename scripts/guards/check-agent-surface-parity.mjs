#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { assert, ok, ROOT, readText } from "./lib/guard-utils.js";

const skills = {
  "code-atlas": ["SKILL.md", "references/mcp-tool-map.md", "references/query-contract.md"],
  fastmcp: ["SKILL.md"],
  "fastmcp-client-cli": ["SKILL.md"],
  supaschema: ["SKILL.md"],
  ultracite: [
    "SKILL.md",
    "agents/openai.yaml",
    "references/code-standards.md",
    "references/override-zones.md",
  ],
  upstream: ["SKILL.md", "agents/openai.yaml"],
};

for (const [skill, files] of Object.entries(skills)) {
  compareFiles(
    path.join(ROOT, ".claude", "skills", skill),
    path.join(ROOT, ".agents", "skills", skill),
    files
  );
  compareFiles(
    path.join(ROOT, ".claude", "skills", skill),
    path.join(ROOT, ".codex", "skills", skill),
    files
  );
}

for (const surface of [".claude", ".agents", ".codex"]) {
  assert(
    !fs.existsSync(path.join(ROOT, surface, "skills", "gitnexus")),
    `project GitNexus skills must not be bundled under ${surface}/skills/gitnexus`
  );
}

const doctrine = "Before any broad owner, route, consumer, dependency, DB, API, worker";
assert(readText("AGENTS.md").includes(doctrine), "AGENTS.md missing Code Atlas doctrine");
assert(
  readText(".claude/rules/supaschema.md").includes(doctrine),
  "Claude rule missing Code Atlas doctrine"
);
assert(
  readText(".codex/rules/supaschema.rules").includes(doctrine),
  "Codex rule missing Code Atlas doctrine"
);

ok("AGENT_SURFACE_PARITY_OK");

function compareFiles(left, right, files) {
  assert(fs.existsSync(left), `missing source skill dir ${left}`);
  assert(fs.existsSync(right), `missing mirror skill dir ${right}`);
  for (const file of files) {
    const leftText = fs.readFileSync(path.join(left, file), "utf8");
    const rightText = fs.readFileSync(path.join(right, file), "utf8");
    assert(leftText === rightText, `skill mirror drifted for ${path.basename(left)}: ${file}`);
  }
}
