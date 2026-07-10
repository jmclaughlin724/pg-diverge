#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderCodexAgent, renderCodexRule } from "./codex-rules.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const claudeProjectDir = shellParameter("CLAUDE_PROJECT_DIR");
const codexProjectDir = shellParameter("CODEX_PROJECT_DIR:-$PWD");
const codexCommandTools = ["Bash"];
const codexEditTools = ["apply_patch"];
const codexPreToolContextTools = [
  ...codexCommandTools,
  ...codexEditTools,
  ["mcp__", [".", "*"].join("")].join(""),
];
const codexPostToolContextTools = [
  ...codexCommandTools,
  ...codexEditTools,
  ["mcp__", [".", "*"].join("")].join(""),
];
const codexCommandToolMatcher = codexToolMatcher(codexCommandTools);
const codexEditToolMatcher = codexToolMatcher(codexEditTools);
const codexMutationToolMatcher = codexToolMatcher([...codexCommandTools, ...codexEditTools]);
const codexPreToolContextMatcher = codexToolMatcher(codexPreToolContextTools);
const codexPostToolContextMatcher = codexToolMatcher(codexPostToolContextTools);

export const agentSurfaceManifest = {
  agents: {
    sourceRoot: ".claude/agents",
    targetRoot: ".codex/agents",
  },
  hooks: {
    preserveFiles: ["general-guard.mjs"],
    sourceRoot: ".claude/hooks",
    targetRoot: ".codex/hooks",
  },
  publicSkills: {
    sourceRoot: ".claude/skills/supaschema",
    targetRoot: "skills/supaschema",
  },
  agentBundle: {
    targetRoot: "agent-bundle",
  },
  rules: {
    sourceRoot: ".claude/rules",
    targetRoot: ".codex/rules",
  },
  skills: {
    sourceRoot: ".claude/skills",
    targetRoots: [".agents/skills"],
  },
};

export function runCli(argv = process.argv.slice(2), root = ROOT) {
  const args = new Set(argv);
  const unknown = argv.filter((arg) => arg !== "--check");
  if (unknown.length > 0) {
    process.stderr.write(`Unknown sync:llm argument(s): ${unknown.join(", ")}\n`);
    process.exit(2);
  }

  if (args.has("--check")) {
    const errors = checkAgentSurfaces({ root });
    if (errors.length > 0) {
      process.stderr.write(`${errors.join("\n")}\n`);
      process.exit(1);
    }
    process.stdout.write("SYNC_LLM_CHECK_OK\n");
    return;
  }

  const result = syncAgentSurfaces({ root });
  process.stdout.write(
    `SYNC_LLM_OK skills=${result.skills} skillTargets=${result.skillTargets} publicSkills=${result.publicSkills} agents=${result.agents} hooks=${result.hooks} codexHookConfig=${result.codexHookConfig} rules=${result.rules} agentBundle=${result.agentBundle}\n`
  );
}

export function syncAgentSurfaces({ root = ROOT } = {}) {
  const skillResult = syncSkills(root);
  const publicSkillResult = syncPublicSkills(root);
  const hookResult = syncDirectoryMirror(root, agentSurfaceManifest.hooks);
  const codexHookConfigResult = syncCodexHookConfig(root);
  const agentResult = syncCodexAgents(root);
  const ruleResult = syncCodexRules(root);
  const agentBundleResult = syncAgentBundle(root);

  return {
    agentBundle: agentBundleResult.files,
    agents: agentResult.files,
    codexHookConfig: codexHookConfigResult.files,
    hooks: hookResult.files,
    publicSkills: publicSkillResult.files,
    rules: ruleResult.files,
    skillTargets: skillResult.targets,
    skills: skillResult.files,
  };
}

export function checkAgentSurfaces({ root = ROOT } = {}) {
  const errors = [];
  checkSkills(root, errors);
  checkPublicSkills(root, errors);
  checkDirectoryMirror(root, agentSurfaceManifest.hooks, errors);
  checkCodexHookConfig(root, errors);
  checkCodexAgents(root, errors);
  checkCodexRules(root, errors);
  checkAgentBundle(root, errors);
  return errors;
}

function syncSkills(root) {
  const { sourceRoot, targetRoots } = agentSurfaceManifest.skills;
  let files = 0;
  let targets = 0;

  for (const targetRoot of targetRoots) {
    const result = syncDirectoryMirror(root, { sourceRoot, targetRoot });
    files = result.files;
    targets += 1;
  }

  return { files, targets };
}

function syncPublicSkills(root) {
  return syncDirectoryMirror(root, agentSurfaceManifest.publicSkills);
}

function syncAgentBundle(root) {
  const targetRootPath = path.join(root, agentSurfaceManifest.agentBundle.targetRoot);
  const files = agentBundleFiles(root);
  syncTextFiles(targetRootPath, files);
  return { files: files.size };
}

function syncCodexHookConfig(root) {
  const target = path.join(root, ".codex/hooks.json");
  writeFileIfChanged(target, jsonText(renderSourceCodexHooks(root)));
  return { files: 1 };
}

function checkCodexHookConfig(root, errors) {
  let expected;
  try {
    expected = jsonText(renderSourceCodexHooks(root));
  } catch (error) {
    errors.push(
      error instanceof Error ? `Codex hook config input invalid: ${error.message}` : String(error)
    );
    return;
  }

  const target = path.join(root, ".codex/hooks.json");
  if (!fs.existsSync(target)) {
    errors.push("missing generated Codex hook config .codex/hooks.json");
    return;
  }
  const actual = fs.readFileSync(target, "utf8");
  if (actual !== expected) {
    errors.push("generated Codex hook config drifted: .codex/hooks.json");
  }
}

function checkAgentBundle(root, errors) {
  const targetRootPath = path.join(root, agentSurfaceManifest.agentBundle.targetRoot);
  if (!fs.existsSync(targetRootPath)) {
    errors.push(`missing raw agent bundle dir ${agentSurfaceManifest.agentBundle.targetRoot}`);
    return;
  }
  const expected = safeAgentBundleFiles(root, errors);
  if (expected.size === 0) {
    return;
  }
  const actualFiles = listFiles(targetRootPath);
  pushFileSetErrors(
    { targetRoot: agentSurfaceManifest.agentBundle.targetRoot },
    [...expected.keys()],
    actualFiles,
    errors
  );
  for (const [file, expectedText] of expected) {
    if (!actualFiles.includes(file)) {
      continue;
    }
    const actualText = fs.readFileSync(path.join(targetRootPath, file), "utf8");
    if (actualText !== expectedText) {
      errors.push(`raw agent bundle drifted: ${file}`);
    }
  }
}

function safeAgentBundleFiles(root, errors) {
  try {
    return agentBundleFiles(root);
  } catch (error) {
    errors.push(
      error instanceof Error ? `raw agent bundle input missing: ${error.message}` : String(error)
    );
    return new Map();
  }
}

function agentBundleFiles(root) {
  const sourceCodexHooks = renderSourceCodexHooks(root);
  const files = new Map([
    ["INSTALL.md", fs.readFileSync(path.join(root, "agent-bundle", "INSTALL.md"), "utf8")],
    [
      "agents/prompts/supaschema-install.md",
      fs.readFileSync(path.join(root, ".agents/prompts/supaschema-install.md"), "utf8"),
    ],
    [
      "agents/skills/supaschema/SKILL.md",
      fs.readFileSync(path.join(root, ".agents/skills/supaschema/SKILL.md"), "utf8"),
    ],
    [
      "claude/hooks/guards/bash-policy-checks.mjs",
      fs.readFileSync(path.join(root, ".claude/hooks/guards/bash-policy-checks.mjs"), "utf8"),
    ],
    [
      "claude/hooks/sync-llm-on-claude-surface-change.mjs",
      fs.readFileSync(
        path.join(root, ".claude/hooks/sync-llm-on-claude-surface-change.mjs"),
        "utf8"
      ),
    ],
    [
      "claude/rules/supaschema.md",
      fs.readFileSync(path.join(root, ".claude/rules/supaschema.md"), "utf8"),
    ],
    [
      "claude/skills/supaschema/SKILL.md",
      fs.readFileSync(path.join(root, ".claude/skills/supaschema/SKILL.md"), "utf8"),
    ],
    [
      "codex/hooks/general-guard.mjs",
      fs.readFileSync(path.join(root, ".codex/hooks/general-guard.mjs"), "utf8"),
    ],
    [
      "codex/hooks/guards/bash-policy-checks.mjs",
      fs.readFileSync(path.join(root, ".codex/hooks/guards/bash-policy-checks.mjs"), "utf8"),
    ],
    [
      "codex/hooks/sync-llm-on-claude-surface-change.mjs",
      fs.readFileSync(
        path.join(root, ".codex/hooks/sync-llm-on-claude-surface-change.mjs"),
        "utf8"
      ),
    ],
    [
      "codex/rules/supaschema.rules",
      fs.readFileSync(path.join(root, ".codex/rules/supaschema.rules"), "utf8"),
    ],
  ]);

  for (const packageManager of ["npm", "pnpm", "yarn", "bun"]) {
    const runner = localRunnerForPackageManager(packageManager);
    const claudeSettings = claudeHookConfig(runner);
    const codexHooks = materializeCodexRunner(consumerCodexHooks(sourceCodexHooks), runner);
    files.set(`claude/settings.${packageManager}.json`, jsonText(claudeSettings));
    files.set(`codex/hooks.${packageManager}.json`, jsonText(codexHooks));
  }

  return files;
}

function shellParameter(expression) {
  return ["$", "{", expression, "}"].join("");
}

function codexToolMatcher(tools) {
  return tools.map(codexMatcherSegment).join("|");
}

function codexMatcherSegment(tool) {
  const wildcardSuffix = [".", "*"].join("");
  if (tool.endsWith(wildcardSuffix)) {
    return `${escapeCodexMatcherLiteral(tool.slice(0, -wildcardSuffix.length))}.*`;
  }
  return escapeCodexMatcherLiteral(tool);
}

function escapeCodexMatcherLiteral(value) {
  const special = "\\^$+?.()|[]{}";
  let out = "";
  for (const char of value) {
    out += special.includes(char) ? `\\${char}` : char;
  }
  return out;
}

function claudeHookConfig(runner) {
  return {
    hooks: {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [
            {
              type: "command",
              command: `node "${claudeProjectDir}/.claude/hooks/guards/bash-policy-checks.mjs"`,
              timeout: 10,
            },
          ],
        },
        {
          matcher: "Bash|Write|Edit|MultiEdit|apply_patch",
          hooks: [
            {
              type: "command",
              command: runner.command,
              args: [...runner.args, "hook", "generated-migration-edit", "--runtime", "claude"],
              timeout: 10,
            },
          ],
        },
      ],
      PostToolUse: [
        {
          matcher: "Bash|Write|Edit|MultiEdit|apply_patch",
          hooks: [
            {
              type: "command",
              command: runner.command,
              args: [...runner.args, "hook", "schema-write"],
              timeout: 130,
            },
          ],
        },
        {
          matcher: "Write|Edit|MultiEdit|apply_patch",
          hooks: [
            {
              type: "command",
              command: `node "${claudeProjectDir}/.claude/hooks/sync-llm-on-claude-surface-change.mjs"`,
              timeout: 130,
            },
          ],
        },
      ],
    },
  };
}

export function renderSourceCodexHooks(root = ROOT) {
  assertClaudeHookSource(root);
  return {
    hooks: {
      SessionStart: [
        {
          matcher: "startup|resume|clear|compact",
          hooks: [
            codexHookCommand(
              ".codex/hooks/context-session-start.mjs",
              10,
              "Loading supaschema agent context"
            ),
          ],
        },
      ],
      UserPromptSubmit: [
        {
          hooks: [
            codexHookCommand(
              ".codex/hooks/context-user-prompt-submit.mjs",
              10,
              "Checking prompt-scoped supaschema context"
            ),
          ],
        },
      ],
      PreToolUse: [
        {
          matcher: codexPreToolContextMatcher,
          hooks: [
            codexHookCommand(
              ".codex/hooks/context-pre-tool-use.mjs",
              10,
              "Checking required supaschema context"
            ),
          ],
        },
        {
          matcher: codexMutationToolMatcher,
          hooks: [
            codexHookCommand(
              ".codex/hooks/supaschema-source-hook.mjs",
              10,
              "Checking supaschema generated-migration policy",
              "hook generated-migration-edit --runtime codex"
            ),
          ],
        },
      ],
      PostToolUse: [
        {
          matcher: codexPostToolContextMatcher,
          hooks: [
            codexHookCommand(
              ".codex/hooks/context-post-tool-use.mjs",
              10,
              "Recording supaschema hook evidence"
            ),
          ],
        },
        {
          matcher: codexMutationToolMatcher,
          hooks: [
            codexHookCommand(
              ".codex/hooks/supaschema-source-hook.mjs",
              130,
              "Running supaschema auto-diff on schema change",
              "hook schema-write"
            ),
          ],
        },
        {
          matcher: codexEditToolMatcher,
          hooks: [
            codexHookCommand(
              ".codex/hooks/sync-llm-on-claude-surface-change.mjs",
              130,
              "Syncing supaschema Claude agent surfaces"
            ),
          ],
        },
      ],
      SubagentStart: [
        {
          hooks: [
            codexHookCommand(
              ".codex/hooks/context-subagent-start.mjs",
              10,
              "Loading supaschema subagent context"
            ),
          ],
        },
      ],
    },
  };
}

function codexHookCommand(relativePath, timeout, statusMessage, args = "") {
  const command = `node "${codexProjectDir}/${relativePath}"${args ? ` ${args}` : ""}`;
  return {
    type: "command",
    command,
    timeout,
    statusMessage,
  };
}

function assertClaudeHookSource(root) {
  const settingsPath = path.join(root, ".claude/settings.json");
  if (!fs.existsSync(settingsPath)) {
    return;
  }
  assertClaudeEntrypoint(root);
  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  const hooks = settings?.hooks;
  if (!hooks || typeof hooks !== "object") {
    throw new Error(".claude/settings.json missing hooks");
  }

  for (const [eventName, relativePath] of [
    ["SessionStart", ".claude/hooks/context-session-start.mjs"],
    ["UserPromptSubmit", ".claude/hooks/context-user-prompt-submit.mjs"],
    ["PreToolUse", ".claude/hooks/context-pre-tool-use.mjs"],
    ["PostToolUse", ".claude/hooks/context-post-tool-use.mjs"],
    ["SubagentStart", ".claude/hooks/context-subagent-start.mjs"],
  ]) {
    assertClaudeNodeHook(hooks, eventName, relativePath);
  }

  assertSourceClaudeBashPreToolUseTopology(hooks);
  assertClaudeCommand(hooks, "PreToolUse", "generated-migration-edit");
  assertClaudeCommand(hooks, "PostToolUse", "schema-write");
  assertClaudeNodeHook(hooks, "PostToolUse", ".claude/hooks/sync-llm-on-claude-surface-change.mjs");
}

function assertSourceClaudeBashPreToolUseTopology(hooks) {
  const entries = hooks.PreToolUse;
  if (!Array.isArray(entries)) {
    throw new Error(".claude/settings.json missing PreToolUse hooks");
  }
  const bashHandlers = entries
    .filter((entry) => claudeMatcherMentionsTool(entry?.matcher, "Bash"))
    .flatMap(hookHandlersFromValue);
  const handlerText = bashHandlers.map(claudeHandlerText).join("\n");
  const contextPath = `${claudeProjectDir}/.claude/hooks/context-pre-tool-use.mjs`;
  if (!handlerText.includes(contextPath)) {
    throw new Error(
      ".claude/settings.json Bash PreToolUse must resolve through .claude/hooks/context-pre-tool-use.mjs"
    );
  }
  if (handlerText.includes(".claude/hooks/guards/bash-policy-checks.mjs")) {
    throw new Error(
      ".claude/settings.json must not register a direct source Claude Bash guard; context-pre-tool-use.mjs dispatches Bash safety"
    );
  }
}

function claudeMatcherMentionsTool(matcher, toolName) {
  if (typeof matcher !== "string" || matcher.length === 0) {
    return true;
  }
  return matcher.split("|").includes(toolName);
}

function claudeHandlerText(handler) {
  return [handler.command, ...(Array.isArray(handler.args) ? handler.args : [])].join(" ");
}

function assertClaudeEntrypoint(root) {
  const claudePath = path.join(root, "CLAUDE.md");
  if (!fs.existsSync(claudePath)) {
    throw new Error("CLAUDE.md must exist when .claude/settings.json enables Claude hooks");
  }
  const text = fs.readFileSync(claudePath, "utf8");
  if (text.trim() !== "@AGENTS.md") {
    throw new Error("CLAUDE.md must import @AGENTS.md so Claude receives the repo contract");
  }
}

function assertClaudeNodeHook(hooks, eventName, relativePath) {
  const handlers = hookHandlersForEvent(hooks, eventName);
  const expectedArg = `${claudeProjectDir}/${relativePath}`;
  if (
    !handlers.some(
      (handler) =>
        handler.command === "node" &&
        Array.isArray(handler.args) &&
        handler.args.includes(expectedArg)
    )
  ) {
    throw new Error(`.claude/settings.json must register ${relativePath} for ${eventName}`);
  }
}

function assertClaudeCommand(hooks, eventName, arg) {
  const handlers = hookHandlersForEvent(hooks, eventName);
  if (!handlers.some((handler) => Array.isArray(handler.args) && handler.args.includes(arg))) {
    throw new Error(`.claude/settings.json must register ${arg} for ${eventName}`);
  }
}

function hookHandlersForEvent(hooks, eventName) {
  const entries = hooks[eventName];
  if (!Array.isArray(entries)) {
    throw new Error(`.claude/settings.json missing ${eventName} hooks`);
  }
  return hookHandlersFromValue(entries);
}

function hookHandlersFromValue(value) {
  const handlers = [];
  const visit = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      return;
    }
    if (!isRecord(value)) {
      return;
    }
    if (value.type === "command" && typeof value.command === "string") {
      handlers.push(value);
    }
    for (const item of Object.values(value)) {
      visit(item);
    }
  };
  visit(value);
  return handlers;
}

function localRunnerForPackageManager(packageManager) {
  if (packageManager === "pnpm") {
    return {
      args: ["exec", "supaschema"],
      command: "pnpm",
      commandString: "pnpm exec supaschema",
    };
  }
  if (packageManager === "yarn") {
    return {
      args: ["exec", "supaschema"],
      command: "yarn",
      commandString: "yarn exec supaschema",
    };
  }
  if (packageManager === "bun") {
    return {
      args: [],
      command: "./node_modules/.bin/supaschema",
      commandString: "./node_modules/.bin/supaschema",
    };
  }
  return {
    args: ["exec", "--", "supaschema"],
    command: "npm",
    commandString: "npm exec -- supaschema",
  };
}

function materializeCodexRunner(value, runner) {
  if (Array.isArray(value)) {
    return value.map((item) => materializeCodexRunner(item, runner));
  }
  if (!isRecord(value)) {
    return value;
  }
  const next = {};
  for (const [key, item] of Object.entries(value)) {
    next[key] =
      key === "command" && typeof item === "string"
        ? materializeSupaschemaCommand(item, runner)
        : materializeCodexRunner(item, runner);
  }
  return next;
}

function materializeSupaschemaCommand(command, runner) {
  for (const prefix of [
    "npm exec -- supaschema",
    "pnpm exec supaschema",
    "yarn exec supaschema",
    "bunx --no-install supaschema",
    "./node_modules/.bin/supaschema",
    "npx --no-install supaschema",
  ]) {
    if (command.startsWith(prefix)) {
      return `${runner.commandString}${command.slice(prefix.length)}`;
    }
  }
  return command;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonText(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function consumerCodexHooks(config) {
  const next = structuredClone(config);
  const hooks = next?.hooks;
  if (!hooks || typeof hooks !== "object") {
    return next;
  }
  for (const [eventName, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries)) {
      continue;
    }
    const consumerEntries = entries
      .map(withoutRepoLocalCodexHooks)
      .filter((entry) => entry !== undefined);
    if (consumerEntries.length > 0) {
      hooks[eventName] = consumerEntries;
    } else {
      delete hooks[eventName];
    }
  }
  ensureConsumerCodexGeneralGuard(hooks);
  return next;
}

function ensureConsumerCodexGeneralGuard(hooks) {
  const entries = Array.isArray(hooks.PreToolUse) ? hooks.PreToolUse : [];
  const hasGuard = entries.some((entry) =>
    JSON.stringify(entry).includes(".codex/hooks/general-guard.mjs")
  );
  if (hasGuard) {
    return;
  }
  hooks.PreToolUse = [
    {
      matcher: codexCommandToolMatcher,
      hooks: [
        codexHookCommand(
          ".codex/hooks/general-guard.mjs",
          10,
          "Checking general Bash safety policy"
        ),
      ],
    },
    ...entries,
  ];
}

function withoutRepoLocalCodexHooks(entry) {
  if (!entry || typeof entry !== "object") {
    return entry;
  }
  if (isRepoLocalCodexHook(entry)) {
    return;
  }
  if (!Array.isArray(entry.hooks)) {
    return consumerCodexHookCommands(entry);
  }
  const hooks = entry.hooks
    .filter((hook) => !isRepoLocalCodexHook(hook))
    .map(consumerCodexHookCommands);
  return hooks.length > 0 ? consumerCodexHookCommands({ ...entry, hooks }) : undefined;
}

function isRepoLocalCodexHook(hook) {
  return (
    hook &&
    typeof hook === "object" &&
    typeof hook.command === "string" &&
    (hook.command.includes("/.codex/hooks/context-") ||
      hook.command.includes("scripts/agent-hooks/"))
  );
}

function consumerCodexHookCommands(entry) {
  if (!entry || typeof entry !== "object") {
    return entry;
  }
  if (typeof entry.command === "string") {
    return { ...entry, command: consumerSupaschemaCommand(entry.command) };
  }
  return entry;
}

function consumerSupaschemaCommand(command) {
  for (const sourcePrefix of [
    `node "${codexProjectDir}/.codex/hooks/supaschema-source-hook.mjs"`,
  ]) {
    if (command.startsWith(sourcePrefix)) {
      return `npm exec -- supaschema${command.slice(sourcePrefix.length)}`;
    }
  }
  return command;
}

function syncDirectoryMirror(root, surface) {
  const sourceRootPath = path.join(root, surface.sourceRoot);
  const targetRootPath = path.join(root, surface.targetRoot);
  assertDirectory(sourceRootPath, `missing source dir ${surface.sourceRoot}`);
  const sourceFiles = listFiles(sourceRootPath);
  const mirroredFiles = mirroredSourceFiles(surface, sourceFiles);
  syncCopiedFiles(sourceRootPath, targetRootPath, mirroredFiles);
  removeUnmanagedFiles(targetRootPath, expectedMirrorFiles(surface, mirroredFiles));
  return { files: sourceFiles.length };
}

function syncCodexAgents(root) {
  const { sourceRoot, targetRoot } = agentSurfaceManifest.agents;
  const sourceRootPath = path.join(root, sourceRoot);
  const targetRootPath = path.join(root, targetRoot);
  if (!fs.existsSync(sourceRootPath)) {
    syncTextFiles(targetRootPath, new Map());
    return { files: 0 };
  }

  const sourceFiles = listFiles(sourceRootPath);
  const renderedFiles = new Map();
  for (const file of sourceFiles) {
    assertMarkdownFile(sourceRoot, file, "agent");
    const sourcePath = path.join(sourceRootPath, file);
    renderedFiles.set(
      codexTargetPath(file, ".toml"),
      renderCodexAgent(fs.readFileSync(sourcePath, "utf8"), display(root, sourcePath))
    );
  }
  syncTextFiles(targetRootPath, renderedFiles);

  return { files: sourceFiles.length };
}

function syncCodexRules(root) {
  const { sourceRoot, targetRoot } = agentSurfaceManifest.rules;
  const sourceRootPath = path.join(root, sourceRoot);
  const targetRootPath = path.join(root, targetRoot);
  assertDirectory(sourceRootPath, `missing source rule dir ${sourceRoot}`);

  const sourceFiles = listFiles(sourceRootPath);
  const renderedFiles = new Map();
  for (const file of sourceFiles) {
    assertMarkdownFile(sourceRoot, file, "rule");
    const sourcePath = path.join(sourceRootPath, file);
    renderedFiles.set(
      codexTargetPath(file, ".rules"),
      renderCodexRule(fs.readFileSync(sourcePath, "utf8"), display(root, sourcePath))
    );
  }
  syncTextFiles(targetRootPath, renderedFiles);

  return { files: sourceFiles.length };
}

function checkSkills(root, errors) {
  const { sourceRoot, targetRoots } = agentSurfaceManifest.skills;
  for (const targetRoot of targetRoots) {
    checkDirectoryMirror(root, { sourceRoot, targetRoot }, errors);
  }
}

function checkPublicSkills(root, errors) {
  checkDirectoryMirror(root, agentSurfaceManifest.publicSkills, errors);
}

function checkDirectoryMirror(root, surface, errors) {
  const sourceRootPath = path.join(root, surface.sourceRoot);
  const targetRootPath = path.join(root, surface.targetRoot);
  if (!fs.existsSync(sourceRootPath)) {
    errors.push(`missing source dir ${surface.sourceRoot}`);
    return;
  }
  if (!fs.existsSync(targetRootPath)) {
    errors.push(`missing mirror dir ${surface.targetRoot}`);
    return;
  }

  const sourceFiles = listFiles(sourceRootPath);
  const mirroredFiles = mirroredSourceFiles(surface, sourceFiles);
  const targetFiles = listFiles(targetRootPath);
  pushFileSetErrors(surface, [...expectedMirrorFiles(surface, mirroredFiles)], targetFiles, errors);

  for (const file of mirroredFiles.filter((item) => targetFiles.includes(item))) {
    const sourceFile = path.join(sourceRootPath, file);
    const targetFile = path.join(targetRootPath, file);
    if (!fs.readFileSync(sourceFile).equals(fs.readFileSync(targetFile))) {
      errors.push(`mirror drifted for ${surface.targetRoot}: ${file}`);
    }
  }
}

function checkCodexAgents(root, errors) {
  const { sourceRoot, targetRoot } = agentSurfaceManifest.agents;
  const sourceRootPath = path.join(root, sourceRoot);
  if (!fs.existsSync(sourceRootPath)) {
    const targetFiles = listFiles(path.join(root, targetRoot));
    if (targetFiles.length > 0) {
      errors.push(`mirror ${targetRoot} has unmanaged files: ${targetFiles.join(", ")}`);
    }
    return;
  }
  checkRenderedMirror(
    root,
    { extension: ".toml", sourceRoot, targetRoot },
    renderCodexAgent,
    errors
  );
}

function checkCodexRules(root, errors) {
  const { sourceRoot, targetRoot } = agentSurfaceManifest.rules;
  checkRenderedMirror(
    root,
    { extension: ".rules", sourceRoot, targetRoot },
    renderCodexRule,
    errors
  );
}

function checkRenderedMirror(root, surface, render, errors) {
  const sourceRootPath = path.join(root, surface.sourceRoot);
  const targetRootPath = path.join(root, surface.targetRoot);
  if (!fs.existsSync(sourceRootPath)) {
    errors.push(`missing source dir ${surface.sourceRoot}`);
    return;
  }
  if (!fs.existsSync(targetRootPath)) {
    errors.push(`missing rendered mirror dir ${surface.targetRoot}`);
    return;
  }

  const sourceFiles = listFiles(sourceRootPath);
  for (const file of sourceFiles) {
    try {
      assertMarkdownFile(surface.sourceRoot, file, "source");
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  const expectedFiles = sourceFiles.map((file) => codexTargetPath(file, surface.extension));
  const targetFiles = listFiles(targetRootPath);
  pushFileSetErrors(surface, expectedFiles, targetFiles, errors);

  for (const file of sourceFiles) {
    const targetFile = codexTargetPath(file, surface.extension);
    if (!targetFiles.includes(targetFile)) {
      continue;
    }
    const sourcePath = path.join(sourceRootPath, file);
    const expected = render(fs.readFileSync(sourcePath, "utf8"), display(root, sourcePath));
    const actual = fs.readFileSync(path.join(targetRootPath, targetFile), "utf8");
    if (actual !== expected) {
      errors.push(`rendered mirror drifted for ${surface.targetRoot}: ${targetFile}`);
    }
  }
}

function pushFileSetErrors(surface, expectedFiles, actualFiles, errors) {
  const missing = expectedFiles.filter((file) => !actualFiles.includes(file));
  const extra = actualFiles.filter((file) => !expectedFiles.includes(file));
  if (missing.length > 0) {
    errors.push(`mirror ${surface.targetRoot} missing files: ${missing.join(", ")}`);
  }
  if (extra.length > 0) {
    errors.push(`mirror ${surface.targetRoot} has unmanaged files: ${extra.join(", ")}`);
  }
}

function expectedMirrorFiles(surface, sourceFiles) {
  return new Set([...sourceFiles, ...(surface.preserveFiles ?? [])]);
}

function mirroredSourceFiles(surface, sourceFiles) {
  const preserved = new Set(surface.preserveFiles ?? []);
  return sourceFiles.filter((file) => !preserved.has(file));
}

function assertDirectory(dir, message) {
  if (!fs.existsSync(dir)) {
    throw new Error(message);
  }
}

function assertMarkdownFile(root, file, kind) {
  if (!file.endsWith(".md")) {
    throw new Error(`${kind} mirror only supports Markdown sources under ${root}: ${file}`);
  }
}

function writeFileIfChanged(file, text) {
  const current = readExistingFile(file, "utf8");
  if (current === text) {
    return;
  }
  writeFileAtomic(file, text);
}

function syncCopiedFiles(sourceRootPath, targetRootPath, sourceFiles) {
  fs.mkdirSync(targetRootPath, { recursive: true });
  for (const file of sourceFiles) {
    copyFileIfChanged(path.join(sourceRootPath, file), path.join(targetRootPath, file));
  }
}

function syncTextFiles(targetRootPath, filesToText) {
  fs.mkdirSync(targetRootPath, { recursive: true });
  for (const [file, text] of filesToText) {
    writeFileIfChanged(path.join(targetRootPath, file), text);
  }
  removeUnmanagedFiles(targetRootPath, new Set(filesToText.keys()));
}

function copyFileIfChanged(sourceFile, targetFile) {
  const sourceBytes = fs.readFileSync(sourceFile);
  const currentBytes = readExistingFile(targetFile);
  if (currentBytes?.equals(sourceBytes)) {
    return;
  }
  writeFileAtomic(targetFile, sourceBytes);
}

function readExistingFile(file, encoding) {
  try {
    return encoding ? fs.readFileSync(file, encoding) : fs.readFileSync(file);
  } catch (error) {
    if (isNotFoundError(error)) {
      return;
    }
    throw error;
  }
}

function writeFileAtomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tempFile = createExclusiveTempFile(path.dirname(file), path.basename(file), content);
  try {
    fs.renameSync(tempFile, file);
  } catch (error) {
    fs.rmSync(tempFile, { force: true });
    throw error;
  }
}

function createExclusiveTempFile(dir, basename, content) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const tempFile = path.join(dir, `.${basename}.${process.pid}.${randomUUID()}.tmp`);
    try {
      fs.writeFileSync(tempFile, content, { flag: "wx" });
      return tempFile;
    } catch (error) {
      if (isAlreadyExistsError(error)) {
        continue;
      }
      throw error;
    }
  }
  throw new Error(`unable to create exclusive temp file for ${path.join(dir, basename)}`);
}

function isNotFoundError(error) {
  return Boolean(error && typeof error === "object" && error.code === "ENOENT");
}

function isAlreadyExistsError(error) {
  return Boolean(error && typeof error === "object" && error.code === "EEXIST");
}

function removeUnmanagedFiles(targetRootPath, expectedFiles) {
  for (const file of listFiles(targetRootPath)) {
    if (!expectedFiles.has(file)) {
      fs.rmSync(path.join(targetRootPath, file), { force: true });
    }
  }
  pruneEmptyDirectories(targetRootPath);
  fs.mkdirSync(targetRootPath, { recursive: true });
}

function pruneEmptyDirectories(root) {
  if (!fs.existsSync(root)) {
    return;
  }

  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        visit(path.join(dir, entry.name));
      }
    }
    if (dir !== root && fs.readdirSync(dir).length === 0) {
      fs.rmdirSync(dir);
    }
  };
  visit(root);
}

function listFiles(root) {
  if (!fs.existsSync(root)) {
    return [];
  }
  const out = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
      } else if (entry.isFile()) {
        out.push(path.relative(root, absolute).split(path.sep).join("/"));
      }
    }
  };
  visit(root);
  return out.sort();
}

function codexTargetPath(file, extension) {
  return file.endsWith(".md") ? `${file.slice(0, -3)}${extension}` : `${file}${extension}`;
}

function display(root, file) {
  return path.relative(root, file).split(path.sep).join("/");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli();
}
