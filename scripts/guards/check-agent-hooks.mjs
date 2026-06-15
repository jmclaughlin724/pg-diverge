#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { assert, exists, ok, ROOT, readJson } from "./lib/guard-utils.js";

const claudeHooks = [
  ".claude/hooks/block-generated-migration-edits.mjs",
  ".claude/hooks/auto-diff-on-schema-change.mjs",
  ".claude/hooks/skill_session_init.sh",
  ".claude/hooks/skill_inject.sh",
  ".claude/hooks/skill_gate.sh",
  ".claude/hooks/skill_subagent_gate.sh",
  ".claude/hooks/skill_record.sh",
  ".claude/hooks/pre_tool_guard.sh",
];
const codexHooks = [
  ".codex/hooks/supaschema-tool-gate.mjs",
  ".codex/hooks/auto-diff-on-schema-change.mjs",
];

for (const hook of [...claudeHooks, ...codexHooks]) {
  assert(exists(hook), `missing hook ${hook}`);
}
for (const hook of claudeHooks.filter((item) => item.endsWith(".sh"))) {
  try {
    fs.accessSync(path.join(ROOT, hook), fs.constants.X_OK);
  } catch {
    assert(false, `${hook} must be executable`);
  }
}

const settingsText = JSON.stringify(readJson(".claude/settings.json"));
for (const hook of claudeHooks) {
  assert(
    settingsText.includes(path.basename(hook)),
    `.claude/settings.json does not register ${hook}`
  );
}

const codexHooksJson = JSON.stringify(readJson(".codex/hooks.json"));
for (const hook of codexHooks) {
  assert(
    codexHooksJson.includes(path.basename(hook)),
    `.codex/hooks.json does not register ${hook}`
  );
}

ok("AGENT_HOOKS_OK");
