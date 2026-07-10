#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, ok } from "../lib/assertions.js";
import { exists, ROOT, readJson, readText } from "../lib/repository.js";
import {
  claudePreToolUseCommandsFor,
  codexPreToolUseCommandsFor,
  hookHandlers,
  runnerDeclaresFunction,
  runnerImportsEvaluateBashPolicy,
} from "./hook-topology.mjs";

const claudeHookFiles = [
  ".claude/hooks/sync-llm-on-claude-surface-change.mjs",
  ".claude/hooks/supaschema-source-hook.mjs",
  ".claude/hooks/guards/bash-policy-checks.mjs",
];
const sourceRepoClaudeRegisteredHookPaths = [
  ".claude/hooks/sync-llm-on-claude-surface-change.mjs",
  ".claude/hooks/supaschema-source-hook.mjs",
];
const sourceRepoClaudeContextHooks = [
  ".claude/hooks/context-session-start.mjs",
  ".claude/hooks/context-user-prompt-submit.mjs",
  ".claude/hooks/context-pre-tool-use.mjs",
  ".claude/hooks/context-post-tool-use.mjs",
  ".claude/hooks/context-subagent-start.mjs",
  ".claude/hooks/context-task-completed.mjs",
  ".claude/hooks/context-permission-denied.mjs",
  ".claude/hooks/context-session-end.mjs",
];
const codexMirrorHookPaths = [
  ".codex/hooks/sync-llm-on-claude-surface-change.mjs",
  ".codex/hooks/supaschema-source-hook.mjs",
  ".codex/hooks/general-guard.mjs",
  ".codex/hooks/guards/bash-policy-checks.mjs",
];
const sourceRepoCodexContextHooks = [
  ".codex/hooks/context-session-start.mjs",
  ".codex/hooks/context-user-prompt-submit.mjs",
  ".codex/hooks/context-pre-tool-use.mjs",
  ".codex/hooks/context-post-tool-use.mjs",
  ".codex/hooks/context-subagent-start.mjs",
  ".codex/hooks/context-task-completed.mjs",
  ".codex/hooks/context-permission-denied.mjs",
  ".codex/hooks/context-session-end.mjs",
];
const codexRegisteredHookPaths = [
  ".codex/hooks/context-session-start.mjs",
  ".codex/hooks/context-user-prompt-submit.mjs",
  ".codex/hooks/context-pre-tool-use.mjs",
  ".codex/hooks/context-post-tool-use.mjs",
  ".codex/hooks/context-subagent-start.mjs",
  ".codex/hooks/sync-llm-on-claude-surface-change.mjs",
];
const retiredWorkflowHookPaths = [
  ".claude/hooks/auto-diff-on-schema-change.mjs",
  ".claude/hooks/block-generated-migration-edits.mjs",
  ".claude/hooks/context-stop.mjs",
  ".claude/hooks/context-subagent-stop.mjs",
  ".codex/hooks/auto-diff-on-schema-change.mjs",
  ".codex/hooks/block-generated-migration-edits.mjs",
  ".codex/hooks/context-stop.mjs",
  ".codex/hooks/context-subagent-stop.mjs",
];

function assertClaudeSettings(claudeSettings, root) {
  const settingsText = JSON.stringify(claudeSettings);
  const claudeHandlers = hookHandlers(claudeSettings);
  const claudeRegisteredHookPaths = [
    ...sourceRepoClaudeRegisteredHookPaths,
    ...sourceRepoClaudeContextHooks,
  ];
  const shellQuotedClaudeNodeCommands = [
    ['node "', "$CLAUDE_PROJECT_DIR", '"'].join(""),
    ['node "', "${", "CLAUDE_PROJECT_DIR", "}"].join(""),
  ];
  for (const hook of claudeRegisteredHookPaths) {
    assert(
      settingsText.includes(path.basename(hook)),
      `.claude/settings.json does not register ${hook}`
    );
  }
  assert(
    settingsText.includes("/.claude/hooks/supaschema-source-hook.mjs") &&
      settingsText.includes('"generated-migration-edit"') &&
      settingsText.includes('"schema-write"'),
    ".claude/settings.json must register the tracked source-repo supaschema hook launcher"
  );
  assert(
    !settingsText.includes("/bin/"),
    ".claude/settings.json must use tracked source hook launchers, not package bin wrappers"
  );
  assert(
    !(settingsText.includes('"npx"') && settingsText.includes('"supaschema"')),
    ".claude/settings.json must not use consumer package-manager supaschema commands in this source repo"
  );
  assert(
    !(
      settingsText.includes("auto-diff-on-schema-change.mjs") ||
      settingsText.includes("block-generated-migration-edits.mjs")
    ),
    ".claude/settings.json must not register removed supaschema hook scripts"
  );
  for (const hook of claudeRegisteredHookPaths.filter((item) => item.endsWith(".mjs"))) {
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
  const sourceClaudeBashCommands = claudePreToolUseCommandsFor(claudeSettings, "Bash");
  const sourceClaudeContextCommands = sourceClaudeBashCommands.filter((command) =>
    command.includes(".claude/hooks/context-pre-tool-use.mjs")
  );
  const sourceClaudeSchemaCommands = sourceClaudeBashCommands.filter(
    (command) =>
      command.includes(".claude/hooks/supaschema-source-hook.mjs") &&
      command.includes("generated-migration-edit")
  );
  assert(
    sourceClaudeContextCommands.length === 1 && sourceClaudeSchemaCommands.length === 1,
    ".claude/settings.json Bash PreToolUse must resolve through one context hook and one supaschema policy hook"
  );
  assert(
    !sourceClaudeBashCommands.some((command) =>
      command.includes(".claude/hooks/guards/bash-policy-checks.mjs")
    ),
    ".claude/settings.json must not register a direct source Claude Bash guard"
  );
  assert(
    !shellQuotedClaudeNodeCommands.some((fragment) => settingsText.includes(fragment)),
    ".claude/settings.json must use command+args instead of shell-quoted node hook paths"
  );
  for (const removedHook of [
    "skill_session_init.sh",
    "skill_inject.sh",
    "skill_gate.sh",
    "skill_subagent_gate.sh",
    "skill_record.sh",
  ]) {
    assert(
      !exists(`.claude/hooks/${removedHook}`, root),
      `.claude/hooks/${removedHook} should not exist`
    );
    assert(
      !settingsText.includes(removedHook),
      `.claude/settings.json still registers ${removedHook}`
    );
  }
  const claudePostToolUse = claudeSettings.hooks?.PostToolUse ?? [];
  assert(
    hookHandlers(claudePostToolUse).some((handler) =>
      handler.args?.some((arg) =>
        arg.endsWith("/.claude/hooks/sync-llm-on-claude-surface-change.mjs")
      )
    ),
    ".claude/settings.json must run sync:llm from PostToolUse"
  );
  assert(
    claudeSettings.hooks?.PostToolBatch === undefined,
    ".claude/settings.json must not register the removed PostToolBatch wrapper"
  );
  assert(
    claudeSettings.hooks?.Stop === undefined && claudeSettings.hooks?.SubagentStop === undefined,
    ".claude/settings.json must not register Stop continuation hooks"
  );
}

function assertCodexConfig(codexConfig, root) {
  const codexHooksJson = JSON.stringify(codexConfig);
  for (const hook of codexRegisteredHookPaths) {
    assert(
      codexHooksJson.includes(path.basename(hook)),
      `.codex/hooks.json does not register ${hook}`
    );
  }
  assert(
    !codexHooksJson.includes("scripts/agent-hooks"),
    ".codex/hooks.json must use hook entrypoints, not scripts/agent-hooks directly"
  );
  for (const hook of [
    "context-session-start.mjs",
    "context-user-prompt-submit.mjs",
    "context-pre-tool-use.mjs",
    "context-post-tool-use.mjs",
    "context-subagent-start.mjs",
  ]) {
    assert(codexHooksJson.includes(hook), `.codex/hooks.json must register ${hook}`);
  }
  assert(
    !codexHooksJson.includes("general-guard.mjs"),
    ".codex/hooks.json must not register source-repo Codex general-guard fan-out"
  );
  for (const toolName of ["Bash", "apply_patch"]) {
    const commands = codexPreToolUseCommandsFor(codexConfig, toolName);
    const contextCommands = commands.filter((command) =>
      command.includes(".codex/hooks/context-pre-tool-use.mjs")
    );
    const schemaCommands = commands.filter(
      (command) =>
        command.includes(".codex/hooks/supaschema-source-hook.mjs") &&
        command.includes("generated-migration-edit")
    );
    assert(
      contextCommands.length === 1 && schemaCommands.length === 1,
      `.codex/hooks.json ${toolName} PreToolUse must resolve through one context hook and one supaschema policy hook`
    );
  }
  const packageCodexHooksJson = JSON.stringify(readJson("agent-bundle/codex/hooks.npm.json", root));
  assert(
    packageCodexHooksJson.includes("general-guard.mjs") &&
      !packageCodexHooksJson.includes("context-") &&
      !packageCodexHooksJson.includes("supaschema-source-hook.mjs") &&
      !packageCodexHooksJson.includes("scripts/agent-hooks"),
    "agent-bundle/codex/hooks.npm.json must keep the consumer Bash guard and strip source-only Codex hooks"
  );
  assert(
    codexHooksJson.includes(".codex/hooks/supaschema-source-hook.mjs") &&
      codexHooksJson.includes("hook generated-migration-edit") &&
      codexHooksJson.includes("hook schema-write"),
    ".codex/hooks.json must register the tracked source-repo supaschema hook launcher"
  );
  assert(
    !codexHooksJson.includes("bin/"),
    ".codex/hooks.json must use tracked source hook launchers, not package bin wrappers"
  );
  assert(
    !(
      codexHooksJson.includes("npm exec -- supaschema") ||
      codexHooksJson.includes("pnpm exec supaschema") ||
      codexHooksJson.includes("npx --no-install supaschema")
    ),
    ".codex/hooks.json must not use consumer package-manager supaschema commands in this source repo"
  );
  assert(
    !(
      codexHooksJson.includes("auto-diff-on-schema-change.mjs") ||
      codexHooksJson.includes("block-generated-migration-edits.mjs")
    ),
    ".codex/hooks.json must not register removed supaschema hook scripts"
  );
}

export function check(root = ROOT) {
  const sourceRepoAgentRuntimeFiles = [
    ".claude/settings.json",
    "scripts/agent-hooks/atlas.mjs",
    "scripts/agent-hooks/command-evidence.mjs",
    "scripts/agent-hooks/hook-output.mjs",
    "scripts/agent-hooks/response-evidence.mjs",
    "scripts/agent-hooks/runner.mjs",
    "scripts/agent-hooks/skill-frontmatter.mjs",
    "scripts/agent-hooks/skill-paths.mjs",
    "scripts/agent-hooks/skills.mjs",
    "scripts/agent-hooks/state.mjs",
  ];
  assert(
    sourceRepoAgentRuntimeFiles.every((file) => exists(file, root)),
    `source-repo agent hook runtime is incomplete; missing ${sourceRepoAgentRuntimeFiles.filter((file) => !exists(file, root)).join(", ")}`
  );
  const hookRunnerText = readText("scripts/agent-hooks/runner.mjs", root);

  for (const hook of [
    ...claudeHookFiles,
    ...sourceRepoClaudeContextHooks,
    ...codexMirrorHookPaths,
    ...sourceRepoCodexContextHooks,
  ]) {
    assert(exists(hook, root), `missing hook ${hook}`);
  }
  for (const hook of retiredWorkflowHookPaths) {
    assert(
      !exists(hook, root),
      `${hook} must not exist; use supaschema hook CLI commands directly`
    );
  }
  const claudeSettings = readJson(".claude/settings.json", root);
  assertClaudeSettings(claudeSettings, root);

  const codexConfig = readJson(".codex/hooks.json", root);
  assertCodexConfig(codexConfig, root);
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
  assert(
    codexPostToolUseText.includes("sync-llm-on-claude-surface-change.mjs"),
    ".codex/hooks.json must run sync:llm from PostToolUse"
  );
  assert(
    codexConfig.hooks?.Stop === undefined && codexConfig.hooks?.SubagentStop === undefined,
    ".codex/hooks.json must not register Stop continuation hooks"
  );
  assert(
    runnerImportsEvaluateBashPolicy(hookRunnerText) &&
      runnerDeclaresFunction(hookRunnerText, "bashSafety"),
    "scripts/agent-hooks/runner.mjs must own source-repo PreToolUse Bash safety"
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  check();
  ok("AGENT_HOOKS_OK");
}
