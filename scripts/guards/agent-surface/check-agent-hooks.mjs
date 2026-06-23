#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, exists, gitTrackedFiles, ok, ROOT, readJson } from "../lib/guard-utils.js";
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
  ".claude/hooks/context-subagent-stop.mjs",
  ".claude/hooks/context-stop.mjs",
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
  ".codex/hooks/context-subagent-stop.mjs",
  ".codex/hooks/context-stop.mjs",
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
  ".codex/hooks/context-subagent-stop.mjs",
  ".codex/hooks/context-stop.mjs",
  ".codex/hooks/sync-llm-on-claude-surface-change.mjs",
];
const retiredWorkflowHookPaths = [
  ".claude/hooks/auto-diff-on-schema-change.mjs",
  ".claude/hooks/block-generated-migration-edits.mjs",
  ".codex/hooks/auto-diff-on-schema-change.mjs",
  ".codex/hooks/block-generated-migration-edits.mjs",
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
  assert(
    sourceClaudeBashCommands.length === 1 &&
      sourceClaudeBashCommands[0].includes(".claude/hooks/context-pre-tool-use.mjs"),
    ".claude/settings.json Bash PreToolUse must resolve through exactly one context hook command"
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
    "context-subagent-stop.mjs",
    "context-stop.mjs",
  ]) {
    assert(codexHooksJson.includes(hook), `.codex/hooks.json must register ${hook}`);
  }
  assert(
    !codexHooksJson.includes("general-guard.mjs"),
    ".codex/hooks.json must not register source-repo Codex general-guard fan-out"
  );
  for (const toolName of ["Bash", "exec_command", "functions.exec_command"]) {
    const commands = codexPreToolUseCommandsFor(codexConfig, toolName);
    assert(
      commands.length === 1 && commands[0].includes(".codex/hooks/context-pre-tool-use.mjs"),
      `.codex/hooks.json ${toolName} PreToolUse must resolve through exactly one context hook command`
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
  const syncLlmText = fs.readFileSync(path.join(root, "scripts/skills/sync-llm.mjs"), "utf8");
  const syncHookText = fs.readFileSync(
    path.join(root, ".claude/hooks/sync-llm-on-claude-surface-change.mjs"),
    "utf8"
  );
  const sourceRepoAgentRuntimeFiles = [
    ".claude/settings.json",
    "scripts/agent-hooks/atlas.mjs",
    "scripts/agent-hooks/command-evidence.mjs",
    "scripts/agent-hooks/evidence-gate.mjs",
    "scripts/agent-hooks/hook-output.mjs",
    "scripts/agent-hooks/response-claims.mjs",
    "scripts/agent-hooks/response-evidence.mjs",
    "scripts/agent-hooks/response-shape.mjs",
    "scripts/agent-hooks/runner.mjs",
    "scripts/agent-hooks/skill-frontmatter.mjs",
    "scripts/agent-hooks/skill-paths.mjs",
    "scripts/agent-hooks/skills.mjs",
    "scripts/agent-hooks/state.mjs",
    "scripts/agent-hooks/tool-payload.mjs",
  ];
  const trackedFiles = new Set(gitTrackedFiles(root));
  assert(
    sourceRepoAgentRuntimeFiles.every((file) => exists(file, root)),
    `source-repo agent hook runtime is incomplete; missing ${sourceRepoAgentRuntimeFiles.filter((file) => !exists(file, root)).join(", ")}`
  );
  const skillMatcherText = fs.readFileSync(
    path.join(root, "scripts/agent-hooks/skills.mjs"),
    "utf8"
  );
  const hookRunnerText = fs.readFileSync(path.join(root, "scripts/agent-hooks/runner.mjs"), "utf8");
  const hookStateText = fs.readFileSync(path.join(root, "scripts/agent-hooks/state.mjs"), "utf8");
  const claudeSkillFiles = [...trackedFiles]
    .filter((file) => file.startsWith(".claude/skills/") && path.basename(file) === "SKILL.md")
    .filter((file) => exists(file, root))
    .map((file) => path.join(root, file));

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
  assert(
    JSON.stringify(codexStop).includes("context-stop.mjs"),
    ".codex/hooks.json must run response-shape context enforcement from Stop"
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
  assert(
    runnerImportsEvaluateBashPolicy(hookRunnerText) &&
      runnerDeclaresFunction(hookRunnerText, "bashSafety") &&
      !hookRunnerText.includes("../github/") &&
      !hookRunnerText.includes(".codex/hooks/general-guard.mjs"),
    "scripts/agent-hooks/runner.mjs must own source-repo PreToolUse Bash safety without GitHub helper dispatch"
  );
  assert(
    hookRunnerText.includes("function responseShape") &&
      hookRunnerText.includes("block: detectorResult.contextParts.join") &&
      !hookRunnerText.includes('context.runtime === "codex" && detectorResult.contextParts'),
    "scripts/agent-hooks/runner.mjs must block response-shape corrections for both Claude and Codex Stop hooks"
  );
  assert(
    hookRunnerText.includes("withSessionState") &&
      hookStateText.includes("export function withSessionState") &&
      hookStateText.includes("acquireSessionLock") &&
      hookStateText.includes("fs.mkdirSync(lockPath)") &&
      hookStateText.includes("clearStaleLock"),
    "scripts/agent-hooks must serialize session-state mutation so concurrent PostToolUse hooks cannot overwrite skill-load or evidence state"
  );
  assert(
    syncLlmText.includes("renderSourceCodexHooks") &&
      syncLlmText.includes("syncCodexHookConfig") &&
      syncLlmText.includes("checkCodexHookConfig") &&
      syncLlmText.includes("assertClaudeHookSource"),
    "sync:llm must render, write, and check source-repo .codex/hooks.json from the Claude hook registration contract"
  );
  assert(
    syncHookText.includes(".codex/hooks.json") &&
      syncHookText.includes("agent-bundle/codex/hooks.npm.json") &&
      syncHookText.includes("scripts/skills/sync-llm.mjs") &&
      syncHookText.includes("syncTriggerFiles"),
    "sync surface hook must run sync:llm for generated Codex hook config, package hook templates, and sync owner edits"
  );
  assert(
    syncLlmText.includes("consumerCodexHooks") &&
      syncLlmText.includes("ensureConsumerCodexGeneralGuard") &&
      !JSON.stringify(readJson("agent-bundle/codex/hooks.npm.json", root)).includes("context-") &&
      !JSON.stringify(readJson("agent-bundle/codex/hooks.npm.json", root)).includes(
        "supaschema-source-hook.mjs"
      ) &&
      !JSON.stringify(readJson("agent-bundle/codex/hooks.npm.json", root)).includes(
        "scripts/agent-hooks"
      ),
    "sync:llm must strip repo-local context enforcement hooks from packaged Codex hook templates"
  );
  const evidenceGateText = fs.readFileSync(
    path.join(root, "scripts/agent-hooks/evidence-gate.mjs"),
    "utf8"
  );
  assert(
    evidenceGateText.includes("isSubagentInvocation"),
    "scripts/agent-hooks/evidence-gate.mjs response-evidence gate must downgrade to advisory inside subagents"
  );
  const responseShapeText = fs.readFileSync(
    path.join(root, "scripts/agent-hooks/response-shape.mjs"),
    "utf8"
  );
  assert(
    responseShapeText.includes("mechanismClaimWithoutArchitecture") &&
      responseShapeText.includes("mechanism-claim-without-architecture") &&
      responseShapeText.includes("architecture/end-state disposition") &&
      responseShapeText.includes("verification disposition"),
    "scripts/agent-hooks/response-shape.mjs must block mechanism-only correctness answers until architecture/end-state and verification dispositions are present"
  );
  const commandEvidenceText = fs.readFileSync(
    path.join(root, "scripts/agent-hooks/command-evidence.mjs"),
    "utf8"
  );
  assert(
    commandEvidenceText.includes("domains.length === 0"),
    "scripts/agent-hooks/command-evidence.mjs must exclude source/inventory reads from verification evidence"
  );
  const responseEvidenceText = fs.readFileSync(
    path.join(root, "scripts/agent-hooks/response-evidence.mjs"),
    "utf8"
  );
  assert(
    responseEvidenceText.includes("exitCodeFromExecutionStatus") &&
      responseEvidenceText.includes("isExecutionStatusLabel") &&
      !responseEvidenceText.includes("textMentionsExit"),
    "scripts/agent-hooks/response-evidence.mjs must parse only execution-status exit lines"
  );
  for (const file of claudeSkillFiles) {
    const text = fs.readFileSync(file, "utf8");
    assert(
      !text.includes("intent-patterns:"),
      `${path.relative(root, file)} must use literal metadata.keywords, not intent-patterns`
    );
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  check();
  ok("AGENT_HOOKS_OK");
}
