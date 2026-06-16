#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { assert, exists, ok, ROOT, readJson } from "./lib/guard-utils.js";

const claudeHooks = [
  ".claude/hooks/context-session-start.mjs",
  ".claude/hooks/context-user-prompt-submit.mjs",
  ".claude/hooks/context-pre-tool-use.mjs",
  ".claude/hooks/context-post-tool-use.mjs",
  ".claude/hooks/context-subagent-start.mjs",
  ".claude/hooks/context-subagent-stop.mjs",
  ".claude/hooks/context-stop.mjs",
  ".claude/hooks/context-task-completed.mjs",
  ".claude/hooks/context-permission-denied.mjs",
  ".claude/hooks/context-session-end.mjs",
  ".claude/hooks/block-generated-migration-edits.mjs",
  ".claude/hooks/auto-diff-on-schema-change.mjs",
  ".claude/hooks/sync-llm-on-claude-surface-change.mjs",
  ".claude/hooks/pre_tool_guard.sh",
];
const codexMirrorHookPaths = [
  ".codex/hooks/context-session-start.mjs",
  ".codex/hooks/context-user-prompt-submit.mjs",
  ".codex/hooks/context-pre-tool-use.mjs",
  ".codex/hooks/context-post-tool-use.mjs",
  ".codex/hooks/context-subagent-start.mjs",
  ".codex/hooks/context-subagent-stop.mjs",
  ".codex/hooks/context-stop.mjs",
  ".codex/hooks/context-task-completed.mjs",
  ".codex/hooks/context-permission-denied.mjs",
  ".codex/hooks/context-session-end.mjs",
  ".codex/hooks/block-generated-migration-edits.mjs",
  ".codex/hooks/auto-diff-on-schema-change.mjs",
  ".codex/hooks/sync-llm-on-claude-surface-change.mjs",
];
const codexRegisteredHookPaths = [
  ".codex/hooks/block-generated-migration-edits.mjs",
  ".codex/hooks/auto-diff-on-schema-change.mjs",
  ".codex/hooks/sync-llm-on-claude-surface-change.mjs",
];
const skillMatcherText = fs.readFileSync(path.join(ROOT, "scripts/agent-hooks/skills.mjs"), "utf8");
const claudeSkillFiles = fs
  .readdirSync(path.join(ROOT, ".claude/skills"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(ROOT, ".claude/skills", entry.name, "SKILL.md"))
  .filter((file) => fs.existsSync(file));
const legacyClaudeNodeWrappers = [
  ['node "', "$CLAUDE_PROJECT_DIR", '"'].join(""),
  ['node "', "${", "CLAUDE_PROJECT_DIR", "}"].join(""),
];

for (const hook of [...claudeHooks, ...codexMirrorHookPaths]) {
  assert(exists(hook), `missing hook ${hook}`);
}
for (const hook of claudeHooks.filter((item) => item.endsWith(".sh"))) {
  try {
    fs.accessSync(path.join(ROOT, hook), fs.constants.X_OK);
  } catch {
    assert(false, `${hook} must be executable`);
  }
}

const claudeSettings = readJson(".claude/settings.json");
const settingsText = JSON.stringify(claudeSettings);
const claudeHandlers = hookHandlers(claudeSettings);
for (const hook of claudeHooks) {
  assert(
    settingsText.includes(path.basename(hook)),
    `.claude/settings.json does not register ${hook}`
  );
}
for (const hook of claudeHooks.filter((item) => item.endsWith(".mjs"))) {
  const expectedArg = `\${CLAUDE_PROJECT_DIR}/${hook}`;
  assert(
    claudeHandlers.some(
      (handler) =>
        handler.command === "node" &&
        Array.isArray(handler.args) &&
        handler.args.includes(expectedArg)
    ),
    `.claude/settings.json must register ${hook} as exec-form node command with args`
  );
}
for (const hook of claudeHooks.filter((item) => item.endsWith(".sh"))) {
  assert(
    claudeHandlers.some(
      (handler) =>
        handler.command === `\${CLAUDE_PROJECT_DIR}/${hook}` && Array.isArray(handler.args)
    ),
    `.claude/settings.json must register ${hook} as exec-form script command`
  );
}
assert(
  !legacyClaudeNodeWrappers.some((fragment) => settingsText.includes(fragment)),
  ".claude/settings.json must use command+args instead of shell-quoted node hook paths"
);
for (const legacy of [
  "skill_session_init.sh",
  "skill_inject.sh",
  "skill_gate.sh",
  "skill_subagent_gate.sh",
  "skill_record.sh",
]) {
  assert(!exists(`.claude/hooks/${legacy}`), `.claude/hooks/${legacy} should not exist`);
  assert(!settingsText.includes(legacy), `.claude/settings.json still registers ${legacy}`);
}
const claudePostToolUseText = JSON.stringify(claudeSettings.hooks?.PostToolUse ?? []);
const claudePostToolBatch = claudeSettings.hooks?.PostToolBatch;
assert(Array.isArray(claudePostToolBatch), ".claude/settings.json missing PostToolBatch entries");
assert(
  !claudePostToolUseText.includes("sync-llm-on-claude-surface-change.mjs"),
  ".claude/settings.json must not run sync:llm from per-tool PostToolUse"
);
assert(
  JSON.stringify(claudePostToolBatch).includes("sync-llm-on-claude-surface-change.mjs"),
  ".claude/settings.json must run sync:llm from PostToolBatch"
);
for (const entry of claudePostToolBatch) {
  assert(
    !("matcher" in entry),
    ".claude/settings.json PostToolBatch entries must not use unsupported matchers"
  );
}

const codexConfig = readJson(".codex/hooks.json");
const codexHooksJson = JSON.stringify(codexConfig);
for (const hook of codexRegisteredHookPaths) {
  assert(
    codexHooksJson.includes(path.basename(hook)),
    `.codex/hooks.json does not register ${hook}`
  );
}
assert(
  !(codexHooksJson.includes("context-") || codexHooksJson.includes("scripts/agent-hooks")),
  ".codex/hooks.json must stay consumer-only and must not register repo context enforcement"
);
for (const eventName of ["PreToolUse", "PostToolUse"]) {
  const entries = codexConfig.hooks?.[eventName];
  assert(Array.isArray(entries), `.codex/hooks.json missing ${eventName} entries`);
  for (const entry of entries) {
    assert(
      typeof entry.matcher === "string" && entry.matcher.length > 0,
      `.codex/hooks.json ${eventName} entries must use narrow matchers`
    );
  }
}
const codexPostToolUseText = JSON.stringify(codexConfig.hooks?.PostToolUse ?? []);
const codexStop = codexConfig.hooks?.Stop;
assert(Array.isArray(codexStop), ".codex/hooks.json missing Stop entries");
assert(
  !codexPostToolUseText.includes("sync-llm-on-claude-surface-change.mjs"),
  ".codex/hooks.json must not run sync:llm from per-tool PostToolUse"
);
assert(
  JSON.stringify(codexStop).includes("sync-llm-on-claude-surface-change.mjs"),
  ".codex/hooks.json must run sync:llm from Stop"
);
for (const entry of codexStop) {
  assert(!("matcher" in entry), ".codex/hooks.json Stop entries must not use matchers");
}
for (const forbidden of [
  "new RegExp",
  "RegExp(",
  ".matchAll(",
  "metadata.intent-patterns",
  "intent-patterns",
]) {
  assert(
    !skillMatcherText.includes(forbidden),
    `scripts/agent-hooks/skills.mjs must not use ${forbidden} for skill matching`
  );
}
assert(
  skillMatcherText.includes("isSubagentInvocation") && skillMatcherText.includes("agent_id"),
  "scripts/agent-hooks/skills.mjs must downgrade the PreToolUse skill gate to advisory inside subagents (agent_id)"
);
const evidenceGateText = fs.readFileSync(
  path.join(ROOT, "scripts/agent-hooks/detectors.mjs"),
  "utf8"
);
assert(
  evidenceGateText.includes("isSubagentInvocation"),
  "scripts/agent-hooks/detectors.mjs response-evidence gate must downgrade to advisory inside subagents"
);
for (const file of claudeSkillFiles) {
  const text = fs.readFileSync(file, "utf8");
  assert(
    !text.includes("intent-patterns:"),
    `${path.relative(ROOT, file)} must use literal metadata.keywords, not intent-patterns`
  );
}

ok("AGENT_HOOKS_OK");

function hookHandlers(value) {
  const out = [];
  const visit = (candidate) => {
    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        visit(item);
      }
      return;
    }
    if (!(candidate && typeof candidate === "object")) {
      return;
    }
    if (typeof candidate.command === "string" && candidate.type === "command") {
      out.push(candidate);
    }
    for (const item of Object.values(candidate)) {
      visit(item);
    }
  };
  visit(value);
  return out;
}
