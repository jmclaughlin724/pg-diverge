#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, ok } from "../lib/assertions.js";
import { exists, ROOT, readJson, readText } from "../lib/repository.js";
import {
  claudePreToolUseCommandsFor,
  codexPreToolUseCommandsFor,
  hookHandlers,
  importsNamedBinding,
  runnerDeclaresFunction,
  runnerImportsEvaluateBashPolicy,
  sessionLifecycleEntrypoints,
  sessionLifecycleEntrypointsFor,
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
const claudeLifecycleEntrypoints = sessionLifecycleEntrypointsFor(".claude");
const codexLifecycleEntrypoints = sessionLifecycleEntrypointsFor(".codex");
const sourceRepoClaudeContextHooks = [
  ...claudeLifecycleEntrypoints,
  ".claude/hooks/context-user-prompt-submit.mjs",
  ".claude/hooks/context-pre-tool-use.mjs",
  ".claude/hooks/context-post-tool-use.mjs",
  ".claude/hooks/context-post-tool-use-failure.mjs",
  ".claude/hooks/context-subagent-start.mjs",
  ".claude/hooks/context-task-completed.mjs",
  ".claude/hooks/context-subagent-stop.mjs",
  ".claude/hooks/context-stop.mjs",
];
const codexMirrorHookPaths = [
  ".codex/hooks/sync-llm-on-claude-surface-change.mjs",
  ".codex/hooks/supaschema-source-hook.mjs",
  ".codex/hooks/guards/bash-policy-checks.mjs",
];
const sourceRepoCodexContextHooks = [
  ...codexLifecycleEntrypoints,
  ".codex/hooks/context-user-prompt-submit.mjs",
  ".codex/hooks/context-pre-tool-use.mjs",
  ".codex/hooks/context-post-tool-use.mjs",
  ".codex/hooks/context-post-tool-use-failure.mjs",
  ".codex/hooks/context-subagent-start.mjs",
  ".codex/hooks/context-task-completed.mjs",
  ".codex/hooks/context-subagent-stop.mjs",
  ".codex/hooks/context-stop.mjs",
];
const codexRegisteredHookPaths = [
  ...codexLifecycleEntrypoints,
  ".codex/hooks/context-user-prompt-submit.mjs",
  ".codex/hooks/context-pre-tool-use.mjs",
  ".codex/hooks/context-post-tool-use.mjs",
  ".codex/hooks/context-subagent-start.mjs",
  ".codex/hooks/context-subagent-stop.mjs",
  ".codex/hooks/context-stop.mjs",
  ".codex/hooks/sync-llm-on-claude-surface-change.mjs",
];
const removedHookPaths = [
  ".claude/hooks/auto-diff-on-schema-change.mjs",
  ".claude/hooks/block-generated-migration-edits.mjs",
  ".claude/hooks/context-permission-denied.mjs",
  ".claude/hooks/context-worktree-create.mjs",
  ".codex/hooks/auto-diff-on-schema-change.mjs",
  ".codex/hooks/block-generated-migration-edits.mjs",
  ".codex/hooks/context-permission-denied.mjs",
  ".codex/hooks/context-worktree-create.mjs",
  ".codex/hooks/general-guard.mjs",
  "agent-bundle/claude/hooks/guards/bash-policy-checks.mjs",
  "agent-bundle/codex/hooks/general-guard.mjs",
  "agent-bundle/codex/hooks/guards/bash-policy-checks.mjs",
  "scripts/agent-hooks/evidence-gate.mjs",
  "scripts/agent-hooks/merged-branch-state.mjs",
  "scripts/agent-hooks/repository-boundary.mjs",
  "scripts/agent-hooks/response-shape.mjs",
];
const sourceRepoHookRuntimeOwners = [
  ".claude/hooks/sync-llm-on-claude-surface-change.mjs",
  ".claude/hooks/supaschema-source-hook.mjs",
  "scripts/agent-hooks/hook-entrypoint.mjs",
  "scripts/agent-hooks/runner.mjs",
  "scripts/agent-hooks/session-lifecycle.mjs",
];
const consumerClaudeSettingsFiles = ["npm", "pnpm", "yarn", "bun"].map(
  (packageManager) => `agent-bundle/claude/settings.${packageManager}.json`
);
const contextPreToolMatcher =
  "Agent|Bash|Edit|Glob|Grep|MultiEdit|NotebookEdit|Read|Task|WebFetch|WebSearch|Write|apply_patch";
const claudeEditToolMatcher = "Write|Edit|MultiEdit|apply_patch";
const codexEditToolMatcher = "apply_patch";
const contextPostToolMatcher = "Bash|Read|Skill";

function assertLabeledCommandHandlers(value, owner) {
  const invalid = hookHandlers(value).filter(
    (handler) =>
      typeof handler.statusMessage !== "string" ||
      handler.statusMessage.trim().length === 0 ||
      handler.statusMessage !== handler.statusMessage.trim() ||
      handler.statusMessage.includes("\n")
  );
  assert(
    invalid.length === 0,
    `${owner} command hook handlers must define a non-empty single-line statusMessage`
  );
}

function assertClaudeSettings(claudeSettings, root) {
  const settingsText = JSON.stringify(claudeSettings);
  const claudeHandlers = hookHandlers(claudeSettings);
  assertLabeledCommandHandlers(claudeSettings, ".claude/settings.json");
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
      settingsText.includes('"generated-artifact-edit"') &&
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
      command.includes("generated-artifact-edit")
  );
  assert(
    sourceClaudeContextCommands.length === 1 && sourceClaudeSchemaCommands.length === 0,
    ".claude/settings.json Bash PreToolUse must resolve only through the context hook"
  );
  const claudeContextPreToolUse = (claudeSettings.hooks?.PreToolUse ?? []).filter((entry) =>
    hookHandlers(entry).some((handler) =>
      handler.args?.some((arg) => arg.endsWith("/.claude/hooks/context-pre-tool-use.mjs"))
    )
  );
  assert(
    claudeContextPreToolUse.length === 1 &&
      claudeContextPreToolUse[0]?.matcher === contextPreToolMatcher,
    `.claude/settings.json context PreToolUse must use ${contextPreToolMatcher}`
  );
  const sourceClaudeApplyPatchSchemaCommands = claudePreToolUseCommandsFor(
    claudeSettings,
    "apply_patch"
  ).filter(
    (command) =>
      command.includes(".claude/hooks/supaschema-source-hook.mjs") &&
      command.includes("generated-artifact-edit")
  );
  assert(
    sourceClaudeApplyPatchSchemaCommands.length === 1,
    ".claude/settings.json apply_patch PreToolUse must register the generated-artifact policy hook"
  );
  const claudeProductPreToolUse = (claudeSettings.hooks?.PreToolUse ?? []).find((entry) =>
    hookHandlers(entry).some((handler) =>
      handler.args?.some((arg) => arg === "generated-artifact-edit")
    )
  );
  assert(
    claudeProductPreToolUse?.matcher === claudeEditToolMatcher,
    `.claude/settings.json generated-artifact PreToolUse must use ${claudeEditToolMatcher}`
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
  const claudeContextPostToolUse = claudePostToolUse.find((entry) =>
    hookHandlers(entry).some((handler) =>
      handler.args?.some((arg) => arg.endsWith("/.claude/hooks/context-post-tool-use.mjs"))
    )
  );
  assert(
    claudeContextPostToolUse?.matcher === contextPostToolMatcher,
    `.claude/settings.json context PostToolUse must use ${contextPostToolMatcher}`
  );
  for (const commandFragment of ["schema-write", "sync-llm-on-claude-surface-change.mjs"]) {
    const entry = claudePostToolUse.find((candidate) =>
      hookHandlers(candidate).some((handler) =>
        [handler.command, ...(handler.args ?? [])].join(" ").includes(commandFragment)
      )
    );
    assert(
      entry?.matcher === claudeEditToolMatcher,
      `.claude/settings.json ${commandFragment} PostToolUse must use ${claudeEditToolMatcher}`
    );
  }
  const claudePostToolUseFailure = claudeSettings.hooks?.PostToolUseFailure ?? [];
  const claudePostToolUseFailureText = JSON.stringify(claudePostToolUseFailure);
  assert(
    claudePostToolUseFailureText.includes("context-post-tool-use-failure.mjs") &&
      claudePostToolUseFailure.length === 1 &&
      claudePostToolUseFailure[0]?.matcher === "Bash" &&
      !claudePostToolUseFailureText.includes("sync-llm-on-claude-surface-change.mjs"),
    ".claude/settings.json must record failed Bash evidence without running surface sync"
  );
  assert(
    claudeSettings.hooks?.PermissionDenied === undefined,
    ".claude/settings.json must not register PermissionDenied without an explicit retry policy"
  );
  assert(
    !readText("agent-bundle/claude/settings.npm.json", root).includes(
      "sync-llm-on-claude-surface-change.mjs"
    ),
    "agent-bundle/claude/settings.npm.json must strip the source-only surface sync hook"
  );
  assert(
    claudeSettings.hooks?.PostToolBatch === undefined,
    ".claude/settings.json must not register the removed PostToolBatch wrapper"
  );
  assert(
    Array.isArray(claudeSettings.hooks?.Stop) && Array.isArray(claudeSettings.hooks?.SubagentStop),
    ".claude/settings.json must register Stop and SubagentStop continuation hooks"
  );
  assert(
    Array.isArray(claudeSettings.hooks?.TaskCompleted) &&
      settingsText.includes("context-task-completed.mjs") &&
      claudeSettings.hooks?.WorktreeCreate === undefined,
    ".claude/settings.json must register TaskCompleted and omit WorktreeCreate"
  );
}

function assertCodexConfig(codexConfig, root) {
  const codexHooksJson = JSON.stringify(codexConfig);
  assertLabeledCommandHandlers(codexConfig, ".codex/hooks.json");
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
    "context-session-end.mjs",
  ]) {
    assert(codexHooksJson.includes(hook), `.codex/hooks.json must register ${hook}`);
  }
  assert(
    !codexHooksJson.includes("general-guard.mjs"),
    ".codex/hooks.json must not register source-repo Codex general-guard fan-out"
  );
  assert(
    codexHooksJson.includes("$(git rev-parse --show-toplevel)") &&
      !codexHooksJson.includes("CODEX_PROJECT_DIR"),
    ".codex/hooks.json must resolve repo-local commands from the git root"
  );
  assert(
    hookHandlers(codexConfig).every(
      (handler) =>
        typeof handler.commandWindows === "string" &&
        handler.commandWindows.includes("git rev-parse --show-toplevel") &&
        handler.commandWindows.includes('do @node "')
    ),
    ".codex/hooks.json must provide git-rooted, echo-suppressed commandWindows overrides"
  );
  assert(
    codexConfig.hooks?.PermissionDenied === undefined &&
      codexConfig.hooks?.PostToolUseFailure === undefined,
    ".codex/hooks.json must not register unsupported Codex hook events"
  );
  const codexContextPreToolUse = (codexConfig.hooks?.PreToolUse ?? []).filter((entry) =>
    hookHandlers(entry).some((handler) =>
      handler.command.includes(".codex/hooks/context-pre-tool-use.mjs")
    )
  );
  assert(
    codexContextPreToolUse.length === 1 &&
      codexContextPreToolUse[0]?.matcher === contextPreToolMatcher,
    `.codex/hooks.json context PreToolUse must use ${contextPreToolMatcher}`
  );
  for (const [toolName, expectedSchemaCommands] of [
    ["Bash", 0],
    ["apply_patch", 1],
  ]) {
    const commands = codexPreToolUseCommandsFor(codexConfig, toolName);
    const contextCommands = commands.filter((command) =>
      command.includes(".codex/hooks/context-pre-tool-use.mjs")
    );
    const schemaCommands = commands.filter(
      (command) =>
        command.includes(".codex/hooks/supaschema-source-hook.mjs") &&
        command.includes("generated-artifact-edit")
    );
    assert(
      contextCommands.length === 1 && schemaCommands.length === expectedSchemaCommands,
      `.codex/hooks.json ${toolName} PreToolUse must keep the expected context and generated-artifact hook topology`
    );
  }
  const codexProductPreToolUse = (codexConfig.hooks?.PreToolUse ?? []).find((entry) =>
    hookHandlers(entry).some((handler) => handler.command.includes("generated-artifact-edit"))
  );
  assert(
    codexProductPreToolUse?.matcher === codexEditToolMatcher,
    `.codex/hooks.json generated-artifact PreToolUse must use ${codexEditToolMatcher}`
  );
  for (const commandFragment of ["schema-write", "sync-llm-on-claude-surface-change.mjs"]) {
    const entry = (codexConfig.hooks?.PostToolUse ?? []).find((candidate) =>
      hookHandlers(candidate).some((handler) => handler.command.includes(commandFragment))
    );
    assert(
      entry?.matcher === codexEditToolMatcher,
      `.codex/hooks.json ${commandFragment} PostToolUse must use ${codexEditToolMatcher}`
    );
  }
  const packageCodexConfig = readJson("agent-bundle/codex/hooks.npm.json", root);
  const packageCodexHooksJson = JSON.stringify(packageCodexConfig);
  const packageCodexHandlers = hookHandlers(packageCodexConfig);
  assert(
    !(
      packageCodexHooksJson.includes("general-guard.mjs") ||
      packageCodexHooksJson.includes("bash-policy-checks.mjs") ||
      packageCodexHooksJson.includes("context-") ||
      packageCodexHooksJson.includes("supaschema-source-hook.mjs") ||
      packageCodexHooksJson.includes("sync-llm-on-claude-surface-change.mjs") ||
      packageCodexHooksJson.includes("scripts/agent-hooks")
    ) &&
      packageCodexHooksJson.includes("hook generated-artifact-edit") &&
      packageCodexHooksJson.includes("hook schema-write"),
    "agent-bundle/codex/hooks.npm.json must contain only Supaschema product hooks"
  );
  assert(
    packageCodexHandlers.length === 2 &&
      packageCodexHandlers.every(
        (handler) =>
          typeof handler.command === "string" &&
          handler.command.includes("supaschema hook") &&
          handler.commandWindows === undefined
      ),
    "agent-bundle Codex handlers must be the two portable Supaschema hook commands"
  );
  assert(
    packageCodexConfig.hooks?.PreToolUse?.length === 1 &&
      packageCodexConfig.hooks.PreToolUse[0]?.matcher === codexEditToolMatcher &&
      packageCodexConfig.hooks?.PostToolUse?.length === 1 &&
      packageCodexConfig.hooks.PostToolUse[0]?.matcher === codexEditToolMatcher,
    "agent-bundle Codex product hooks must use apply_patch"
  );
  assert(
    codexHooksJson.includes(".codex/hooks/supaschema-source-hook.mjs") &&
      codexHooksJson.includes("hook generated-artifact-edit") &&
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
  assert(
    codexConfig.hooks?.TaskCompleted === undefined &&
      codexConfig.hooks?.WorktreeCreate === undefined,
    ".codex/hooks.json must omit Claude-only TaskCompleted and removed WorktreeCreate events"
  );
  const codexContextPostToolUse = (codexConfig.hooks?.PostToolUse ?? []).find((entry) =>
    hookHandlers(entry).some((handler) =>
      handler.command.includes(".codex/hooks/context-post-tool-use.mjs")
    )
  );
  assert(
    codexContextPostToolUse?.matcher === contextPostToolMatcher,
    `.codex/hooks.json context PostToolUse must use ${contextPostToolMatcher}`
  );
}

function assertConsumerClaudeSettings(root) {
  for (const settingsFile of consumerClaudeSettingsFiles) {
    const settings = readJson(settingsFile, root);
    const settingsText = JSON.stringify(settings);
    const handlers = hookHandlers(settings);
    const supaschemaHandlers = handlers.filter(
      (handler) =>
        typeof handler.command === "string" && handler.command.includes("supaschema hook")
    );
    assert(
      handlers.length === 2 &&
        supaschemaHandlers.length === 2 &&
        supaschemaHandlers.every((handler) => handler.args === undefined),
      `${settingsFile} must contain only the two package-manager Supaschema hook commands`
    );
    const preToolUse = settings.hooks?.PreToolUse ?? [];
    const postToolUse = settings.hooks?.PostToolUse ?? [];
    assert(
      preToolUse.length === 1 &&
        preToolUse[0]?.matcher === claudeEditToolMatcher &&
        postToolUse.length === 1 &&
        postToolUse[0]?.matcher === claudeEditToolMatcher,
      `${settingsFile} product hooks must use ${claudeEditToolMatcher}`
    );
    assert(
      !(
        settingsText.includes("bash-policy-checks.mjs") ||
        settingsText.includes("general-guard.mjs")
      ),
      `${settingsFile} must not register the repository Bash policy`
    );
  }
}

function assertAgentBundleHookLabels(root) {
  for (const packageManager of ["npm", "pnpm", "yarn", "bun"]) {
    for (const [runtime, path] of [
      ["Claude", `agent-bundle/claude/settings.${packageManager}.json`],
      ["Codex", `agent-bundle/codex/hooks.${packageManager}.json`],
    ]) {
      assertLabeledCommandHandlers(
        readJson(path, root),
        `${runtime} ${packageManager} agent-bundle hook config`
      );
    }
  }
}

export function check(root = ROOT) {
  const sourceRepoAgentRuntimeFiles = [
    ".claude/settings.json",
    "scripts/agent-hooks/command-evidence.mjs",
    "scripts/agent-hooks/edit-targets.mjs",
    "scripts/agent-hooks/hook-entrypoint.mjs",
    "scripts/agent-hooks/hook-output.mjs",
    "scripts/agent-hooks/postgres-ddl.mjs",
    "scripts/agent-hooks/response-claims.mjs",
    "scripts/agent-hooks/response-evidence.mjs",
    "scripts/agent-hooks/runner.mjs",
    "scripts/agent-hooks/session-lifecycle.mjs",
    "scripts/agent-hooks/shell-command.mjs",
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

  for (const lifecycleEntrypoint of sessionLifecycleEntrypoints) {
    const entrypointText = readText(lifecycleEntrypoint, root);
    assert(
      importsNamedBinding(
        entrypointText,
        lifecycleEntrypoint,
        "../../scripts/agent-hooks/session-lifecycle.mjs",
        "runSessionLifecycleEvent"
      ),
      `${lifecycleEntrypoint} must delegate directly to the session lifecycle owner`
    );
    assert(
      !importsNamedBinding(
        entrypointText,
        lifecycleEntrypoint,
        "../../scripts/agent-hooks/runner.mjs",
        "runAgentHookEvent"
      ),
      `${lifecycleEntrypoint} must not import the non-lifecycle hook runner`
    );
  }

  for (const hook of [
    ...claudeHookFiles,
    ...sourceRepoClaudeContextHooks,
    ...codexMirrorHookPaths,
    ...sourceRepoCodexContextHooks,
  ]) {
    assert(exists(hook, root), `missing hook ${hook}`);
  }
  for (const hook of removedHookPaths) {
    assert(!exists(hook, root), `${hook} must not exist; remove the stale hook entrypoint`);
  }
  const claudeSettings = readJson(".claude/settings.json", root);
  assertClaudeSettings(claudeSettings, root);
  assertConsumerClaudeSettings(root);
  for (const runtimeOwner of sourceRepoHookRuntimeOwners) {
    assert(
      !readText(runtimeOwner, root).includes("CODEX_PROJECT_DIR"),
      `${runtimeOwner} must derive runtime and project ownership from its entrypoint, not CODEX_PROJECT_DIR`
    );
  }

  const codexConfig = readJson(".codex/hooks.json", root);
  assertCodexConfig(codexConfig, root);
  assertAgentBundleHookLabels(root);
  for (const eventName of ["PreToolUse", "PostToolUse"]) {
    const entries = codexConfig.hooks?.[eventName];
    assert(Array.isArray(entries), `.codex/hooks.json missing ${eventName} entries`);
    for (const entry of entries) {
      assert(
        typeof entry.matcher === "string" && entry.matcher.length > 0,
        `.codex/hooks.json ${eventName} entries must use explicit matchers`
      );
    }
  }
  const codexPostToolUseText = JSON.stringify(codexConfig.hooks?.PostToolUse ?? []);
  assert(
    codexPostToolUseText.includes("sync-llm-on-claude-surface-change.mjs"),
    ".codex/hooks.json must run sync:llm from PostToolUse"
  );
  assert(
    Array.isArray(codexConfig.hooks?.Stop) &&
      Array.isArray(codexConfig.hooks?.SubagentStop) &&
      Array.isArray(codexConfig.hooks?.SessionEnd),
    ".codex/hooks.json must register Stop, SubagentStop, and SessionEnd lifecycle hooks"
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
