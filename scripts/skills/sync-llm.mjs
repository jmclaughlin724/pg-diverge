#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MIRRORED_SKILLS = {
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

for (const [skill, files] of Object.entries(MIRRORED_SKILLS)) {
  const source = path.join(ROOT, ".claude", "skills", skill);
  if (!fs.existsSync(source)) {
    continue;
  }
  copyFiles(source, path.join(ROOT, ".agents", "skills", skill), files);
  copyFiles(source, path.join(ROOT, ".codex", "skills", skill), files);
}

process.stdout.write(`SYNC_LLM_OK skills=${Object.keys(MIRRORED_SKILLS).length}\n`);

function copyFiles(source, target, files) {
  fs.rmSync(target, { recursive: true, force: true });
  for (const file of files) {
    const from = path.join(source, file);
    const to = path.join(target, file);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
}
