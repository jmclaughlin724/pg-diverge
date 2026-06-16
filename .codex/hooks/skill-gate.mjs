#!/usr/bin/env node
import { sep } from "node:path";
import { fileURLToPath } from "node:url";
import { runSkillHook } from "../../scripts/skills/skill-hook-core.mjs";

runSkillHook({ command: "gate", runtime: hookRuntime() });

function hookRuntime() {
  const normalized = fileURLToPath(import.meta.url).split(sep).join("/");
  return normalized.includes("/.codex/hooks/") || process.env.CODEX_PROJECT_DIR
    ? "codex"
    : "claude";
}
