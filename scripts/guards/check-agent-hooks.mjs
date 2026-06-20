#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { assert, exists, gitTrackedFiles, ok, ROOT, readJson } from "./lib/guard-utils.js";

const claudeHooks = [
  ".claude/hooks/sync-llm-on-claude-surface-change.mjs",
  ".claude/hooks/supaschema-source-hook.mjs",
  ".claude/hooks/guards/bash-policy-checks.mjs",
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
const syncLlmText = fs.readFileSync(path.join(ROOT, "scripts/skills/sync-llm.mjs"), "utf8");
const syncHookText = fs.readFileSync(
  path.join(ROOT, ".claude/hooks/sync-llm-on-claude-surface-change.mjs"),
  "utf8"
);
const sourceRepoAgentRuntimeFiles = [
  ".claude/settings.json",
  "scripts/agent-hooks/atlas.mjs",
  "scripts/agent-hooks/detectors.mjs",
  "scripts/agent-hooks/payload.mjs",
  "scripts/agent-hooks/runner.mjs",
  "scripts/agent-hooks/skills.mjs",
  "scripts/agent-hooks/state.mjs",
];
const optimizerSkillFiles = [
  ".claude/skills/claude-optimizer/SKILL.md",
  ".claude/skills/codex-optimizer/SKILL.md",
];
const updateSkillFile = ".claude/skills/update/SKILL.md";
const updateSkillPlaybookFile = ".claude/skills/update/references/skill-playbook.md";
const localRuleFiles = [
  ".claude/rules/01-operating-rules.md",
  ".claude/rules/12-skill-loading-enforcement.md",
  ".claude/rules/13-npm-package-boundary.md",
  ".claude/rules/18-context-surface-sync.md",
  ".claude/rules/20-anti-patterns.md",
  ".claude/rules/21-github-process.md",
  ".claude/rules/22-agent-surface-sync-ownership.md",
];
const rootAgentsFile = "AGENTS.md";
const codexHooksReferenceFile = ".claude/skills/codex-optimizer/references/hooks.md";
const claudeHooksReferenceFile = ".claude/skills/claude-optimizer/references/hooks-reference.md";
const trackedFiles = new Set(gitTrackedFiles());
const hasAnyOptimizerSkill = optimizerSkillFiles.some(optionalLocalExists);
const hasOptimizerSkills = optimizerSkillFiles.every(optionalLocalExists);
const hasUpdateSkill = optionalLocalExists(updateSkillFile);
const hasUpdateSkillPlaybook = optionalLocalExists(updateSkillPlaybookFile);
assert(
  sourceRepoAgentRuntimeFiles.every(exists),
  `source-repo agent hook runtime is incomplete; missing ${sourceRepoAgentRuntimeFiles.filter((file) => !exists(file)).join(", ")}`
);
assert(
  !hasAnyOptimizerSkill || hasOptimizerSkills,
  `optimizer skill checkout is incomplete; missing ${optimizerSkillFiles.filter((file) => !exists(file)).join(", ")}`
);
const skillMatcherText = fs.readFileSync(path.join(ROOT, "scripts/agent-hooks/skills.mjs"), "utf8");
const hookRunnerText = fs.readFileSync(path.join(ROOT, "scripts/agent-hooks/runner.mjs"), "utf8");
const optimizerSkillTexts = hasOptimizerSkills
  ? optimizerSkillFiles.map((file) => [file, optionalLocalText(file)])
  : [];
const updateSkillText = hasUpdateSkill ? optionalLocalText(updateSkillFile) : "";
const updateSkillPlaybookText = hasUpdateSkillPlaybook
  ? optionalLocalText(updateSkillPlaybookFile)
  : "";
const rootAgentsText = exists(rootAgentsFile)
  ? fs.readFileSync(path.join(ROOT, rootAgentsFile), "utf8")
  : "";
const codexHooksReferenceText = optionalLocalExists(codexHooksReferenceFile)
  ? optionalLocalText(codexHooksReferenceFile)
  : "";
const claudeHooksReferenceText = optionalLocalExists(claudeHooksReferenceFile)
  ? optionalLocalText(claudeHooksReferenceFile)
  : "";
const localRuleTexts = new Map(
  localRuleFiles
    .filter(exists)
    .map((file) => [file, fs.readFileSync(path.join(ROOT, file), "utf8")])
);
const claudeSkillFiles = [...trackedFiles]
  .filter((file) => file.startsWith(".claude/skills/") && path.basename(file) === "SKILL.md")
  .filter(exists)
  .map((file) => path.join(ROOT, file));
const shellQuotedClaudeNodeCommands = [
  ['node "', "$CLAUDE_PROJECT_DIR", '"'].join(""),
  ['node "', "${", "CLAUDE_PROJECT_DIR", "}"].join(""),
];

for (const hook of [
  ...claudeHooks,
  ...sourceRepoClaudeContextHooks,
  ...codexMirrorHookPaths,
  ...sourceRepoCodexContextHooks,
]) {
  assert(exists(hook), `missing hook ${hook}`);
}
for (const hook of retiredWorkflowHookPaths) {
  assert(!exists(hook), `${hook} must not exist; use supaschema hook CLI commands directly`);
}
for (const file of [
  "scripts/github/ci-inbox-core.mjs",
  "scripts/github/ci-inbox.mjs",
  "scripts/github/report-ci-failure.mjs",
]) {
  assert(exists(file), `${file} must exist for repo-local CI failure inbox DX`);
}

const claudeSettings = readJson(".claude/settings.json");
const settingsText = JSON.stringify(claudeSettings);
const claudeHandlers = hookHandlers(claudeSettings);
for (const hook of [...claudeHooks, ...sourceRepoClaudeContextHooks]) {
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
  !settingsText.includes("/bin/supaschema.cjs"),
  ".claude/settings.json must not register bin/supaschema.cjs because clean source checkouts may not have dist"
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
for (const hook of [...claudeHooks, ...sourceRepoClaudeContextHooks].filter((item) =>
  item.endsWith(".mjs")
)) {
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
  assert(!exists(`.claude/hooks/${removedHook}`), `.claude/hooks/${removedHook} should not exist`);
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

const codexConfig = readJson(".codex/hooks.json");
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
  !(
    codexHooksJson.includes("scripts/github/ci-inbox.mjs") ||
    codexHooksJson.includes("Checking GitHub CI failure inbox")
  ),
  ".codex/hooks.json must not register a separate repo-local CI inbox PreToolUse hook"
);
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
const packageCodexHooksJson = JSON.stringify(readJson("agent-bundle/codex/hooks.npm.json"));
assert(
  packageCodexHooksJson.includes("general-guard.mjs") &&
    !packageCodexHooksJson.includes("scripts/github/ci-inbox.mjs") &&
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
  !codexHooksJson.includes("bin/supaschema.cjs"),
  ".codex/hooks.json must not register bin/supaschema.cjs because clean source checkouts may not have dist"
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
  hookRunnerText.includes("../github/ci-inbox-core.mjs") &&
    hookRunnerText.includes("[ciInbox, promptSkills]") &&
    hookRunnerText.includes("[ciInbox, responseShape]"),
  "scripts/agent-hooks/runner.mjs must surface GitHub CI failure inbox context through existing Claude hook events"
);
assert(
  hookRunnerText.includes("../../.claude/hooks/guards/bash-policy-checks.mjs") &&
    hookRunnerText.includes("evaluateBashPolicy") &&
    hookRunnerText.includes("function bashSafety") &&
    hookRunnerText.includes("function commandCiInbox") &&
    hookRunnerText.includes("commandToolNames") &&
    !hookRunnerText.includes(".codex/hooks/general-guard.mjs"),
  "scripts/agent-hooks/runner.mjs must own source-repo Codex PreToolUse Bash safety and command-scoped CI inbox dispatch"
);
assert(
  hookRunnerText.includes("function responseShape") &&
    hookRunnerText.includes("block: detectorResult.contextParts.join") &&
    !hookRunnerText.includes('context.runtime === "codex" && detectorResult.contextParts'),
  "scripts/agent-hooks/runner.mjs must block response-shape corrections for both Claude and Codex Stop hooks"
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
for (const [file, text] of optimizerSkillTexts) {
  assert(
    text.includes("22-agent-surface-sync-ownership.md") &&
      text.includes(".codex/hooks.json") &&
      text.includes("npm run sync:llm:check") &&
      text.includes("Required source-repo runtime") &&
      text.includes("package output") &&
      text.includes(".codex/hooks/context-pre-tool-use.mjs") &&
      text.includes(".codex/hooks/general-guard.mjs") &&
      text.includes("scripts/agent-hooks/**") &&
      text.includes("tests/github-ci-inbox.test.ts"),
    `${file} must enforce Rule 22 sync ownership, Codex hook generation, source/consumer hook topology, tracked source runtime, and package validation`
  );
}
if (hasUpdateSkill || hasUpdateSkillPlaybook) {
  assert(
    hasUpdateSkill && hasUpdateSkillPlaybook,
    "update skill and its playbook must exist together"
  );
  assert(
    updateSkillText.includes("## Enforcement Closure") &&
      updateSkillText.includes("enforcement closure ledger") &&
      updateSkillText.includes("Rule: the `.claude/rules/**` owner") &&
      updateSkillText.includes(
        "Hook, context, rule, sync, and package-template changes MUST include both Claude and Codex disposition"
      ),
    "update skill must require an enforcement closure ledger and cross-runtime disposition"
  );
  assert(
    updateSkillPlaybookText.includes(
      "Every HIGH/MEDIUM finding needs an enforcement closure ledger"
    ) &&
      updateSkillPlaybookText.includes("runtime/hook path, guard, test, CI or validation script") &&
      updateSkillPlaybookText.includes(
        "Hook, context, sync, and generated-registration changes require direct proof"
      ) &&
      updateSkillPlaybookText.includes(
        "Package-template changes also require `npm run guard:public-surface`, `npm run check:package`, and `npm pack --dry-run --json`"
      ),
    "update playbook must require enforcement closure, direct runtime proof, and package-template validation"
  );
}
assert(
  rootAgentsText.includes("enforcement closure ledger") &&
    rootAgentsText.includes("docs-only or skill-only") &&
    rootAgentsText.includes("explicit Claude/Codex disposition"),
  "AGENTS.md must require an enforcement closure ledger for hook/context/rule/sync/generated/package-template changes"
);
const rule01Text = localRuleTexts.get(".claude/rules/01-operating-rules.md");
if (rule01Text) {
  assert(
    rule01Text.includes("docs-only or skill-only") &&
      rule01Text.includes("enforcement closure ledger") &&
      rule01Text.includes("explicit Claude/Codex disposition") &&
      rule01Text.includes("hook/context/rule/sync/package-template behavior changes"),
    "Rule 01 must block docs-only enforcement closure and require the AGENTS enforcement closure ledger"
  );
}
const rule13Text = localRuleTexts.get(".claude/rules/13-npm-package-boundary.md");
if (rule13Text) {
  assert(
    rule13Text.includes(
      "Command-scoped CI inbox context MUST dispatch inside `scripts/agent-hooks/runner.mjs`"
    ) &&
      rule13Text.includes("not as a separate source `.codex/hooks.json` `PreToolUse` command") &&
      rule13Text.includes(
        "Consumer Codex hook templates MUST keep `.codex/hooks/general-guard.mjs`"
      ),
    "Rule 13 must document source CI inbox dispatch through the shared runner and consumer general-guard preservation"
  );
}
if (codexHooksReferenceText) {
  assert(
    codexHooksReferenceText.includes(
      "Direct runtime proof is required for hook behavior changes"
    ) &&
      codexHooksReferenceText.includes("npm pack --dry-run --json") &&
      codexHooksReferenceText.includes("consumer templates keep `.codex/hooks/general-guard.mjs`"),
    "codex-optimizer hooks reference must require runtime proof, package checks, and consumer guard preservation"
  );
}
if (claudeHooksReferenceText) {
  assert(
    claudeHooksReferenceText.includes("supaschema shared hook closeout") &&
      claudeHooksReferenceText.includes("verify both runtime contracts") &&
      claudeHooksReferenceText.includes("npm run sync:llm:check") &&
      claudeHooksReferenceText.includes("npm pack --dry-run --json"),
    "claude-optimizer hooks reference must require shared hook closeout across Claude, Codex, and package templates"
  );
}
const codexOptimizerText = optimizerSkillTexts.find(([file]) =>
  file.includes("codex-optimizer")
)?.[1];
if (codexOptimizerText) {
  assert(
    codexOptimizerText.includes(
      "Codex hook topology changes MUST update the full enforcement chain"
    ) &&
      codexOptimizerText.includes("build a topology proof before closeout") &&
      codexOptimizerText.includes("Direct runtime proof is required for hook behavior changes") &&
      codexOptimizerText.includes("consumer templates keep `.codex/hooks/general-guard.mjs`"),
    "codex-optimizer must require topology proof, runtime proof, and consumer guard preservation"
  );
}
const claudeOptimizerText = optimizerSkillTexts.find(([file]) =>
  file.includes("claude-optimizer")
)?.[1];
if (claudeOptimizerText) {
  assert(
    claudeOptimizerText.includes(
      "Claude hook, rule, and config changes that affect shared behavior MUST close the full enforcement chain"
    ) &&
      claudeOptimizerText.includes("verify both output contracts") &&
      claudeOptimizerText.includes(
        "For hook behavior changes, execute the actual hook entrypoint"
      ) &&
      claudeOptimizerText.includes("Claude and Codex runtime behavior has explicit disposition"),
    "claude-optimizer must require cross-runtime enforcement closure and direct hook output proof"
  );
}
const rule12Text = localRuleTexts.get(".claude/rules/12-skill-loading-enforcement.md");
if (rule12Text) {
  assert(
    rule12Text.includes("successful `github-checks` evidence") &&
      rule12Text.includes("failed `gh pr view --json statusCheckRollup`") &&
      rule12Text.includes("same command or `github-checks` domain") &&
      rule12Text.includes("failed `statusCheckRollup` evidence remains unresolved") &&
      rule12Text.includes("MUST match exactly one `PreToolUse` hook command") &&
      rule12Text.includes("command-scoped CI failure inbox context") &&
      rule12Text.includes("Source and inventory reads") &&
      rule12Text.includes("MUST NOT become verification evidence") &&
      rule12Text.includes("process.exitCode = 2"),
    "Rule 12 must document GitHub check evidence, failed statusCheckRollup evidence, source-read evidence exclusion, same-domain resolution, and single source-repo Codex PreToolUse dispatch"
  );
}
const rule18Text = localRuleTexts.get(".claude/rules/18-context-surface-sync.md");
if (rule18Text) {
  assert(
    rule18Text.includes("one generated `PreToolUse` hook command") &&
      rule18Text.includes("dispatch them inside `scripts/agent-hooks/runner.mjs`") &&
      rule18Text.includes("standalone `.codex/hooks/general-guard.mjs` Bash safety hook"),
    "Rule 18 must document source-repo Codex single-hook dispatch and consumer standalone Bash guard topology"
  );
}
const rule21Text = localRuleTexts.get(".claude/rules/21-github-process.md");
if (rule21Text) {
  assert(
    rule21Text.includes("<!-- supaschema:ci-failure-report -->") &&
      rule21Text.includes(
        "gh pr view --json number,headRefName,headRefOid,url,statusCheckRollup"
      ) &&
      rule21Text.includes("Rule 12 owns the Stop-time response-evidence gate") &&
      rule21Text.includes("Do not resolve it by deleting the marker comment") &&
      rule21Text.includes("shared agent hook runner") &&
      rule21Text.includes("CI inbox runner/helper/context"),
    "Rule 21 must document CI inbox marker comments, live statusCheckRollup fallback, and GitHub check evidence resolution"
  );
}
const rule20Text = localRuleTexts.get(".claude/rules/20-anti-patterns.md");
if (rule20Text) {
  assert(
    rule20Text.includes("Claiming GitHub, CI, PR, branch, or checks are green") &&
      rule20Text.includes("Hiding source-repo runtime") &&
      rule20Text.includes("Hand-authoring `.codex/hooks.json`") &&
      rule20Text.includes("docs-only or skill-only") &&
      rule20Text.includes("CI inbox context through `scripts/agent-hooks/runner.mjs`"),
    "Rule 20 must list GitHub green-claim, hidden source-runtime, generated Codex hook, and docs-only enforcement anti-patterns"
  );
}
const rule22Text = localRuleTexts.get(".claude/rules/22-agent-surface-sync-ownership.md");
if (rule22Text) {
  assert(
    rule22Text.includes("MUST register exactly one `PreToolUse` hook command") &&
      rule22Text.includes("MUST NOT also register `.codex/hooks/general-guard.mjs`") &&
      rule22Text.includes("MUST keep `.codex/hooks/general-guard.mjs`") &&
      rule22Text.includes("`.gitignore` MUST NOT ignore required source-repo runtime") &&
      rule22Text.includes("Required source-repo hook runtime"),
    "Rule 22 must document source-repo Codex single-hook topology, tracked source runtime, and consumer guard preservation"
  );
}
assert(
  syncLlmText.includes("consumerCodexHooks") &&
    syncLlmText.includes("ensureConsumerCodexGeneralGuard") &&
    syncLlmText.includes("scripts/github/ci-inbox.mjs") &&
    !JSON.stringify(readJson("agent-bundle/codex/hooks.npm.json")).includes(
      "scripts/github/ci-inbox.mjs"
    ) &&
    !JSON.stringify(readJson("agent-bundle/codex/hooks.npm.json")).includes("context-") &&
    !JSON.stringify(readJson("agent-bundle/codex/hooks.npm.json")).includes(
      "supaschema-source-hook.mjs"
    ) &&
    !JSON.stringify(readJson("agent-bundle/codex/hooks.npm.json")).includes("scripts/agent-hooks"),
  "sync:llm must strip repo-local CI inbox and context enforcement hooks from packaged Codex hook templates"
);
const evidenceGateText = fs.readFileSync(
  path.join(ROOT, "scripts/agent-hooks/detectors.mjs"),
  "utf8"
);
assert(
  evidenceGateText.includes("isSubagentInvocation"),
  "scripts/agent-hooks/detectors.mjs response-evidence gate must downgrade to advisory inside subagents"
);
assert(
  evidenceGateText.includes("mechanismClaimWithoutArchitecture") &&
    evidenceGateText.includes("mechanism-claim-without-architecture") &&
    evidenceGateText.includes("architecture/end-state disposition") &&
    evidenceGateText.includes("verification disposition"),
  "scripts/agent-hooks/detectors.mjs must block mechanism-only correctness answers until architecture/end-state and verification dispositions are present"
);
assert(
  evidenceGateText.includes("domains.length === 0") &&
    evidenceGateText.includes("exitCodeFromExecutionStatus") &&
    evidenceGateText.includes("isExecutionStatusLabel") &&
    !evidenceGateText.includes("textMentionsExit"),
  "scripts/agent-hooks/detectors.mjs must exclude source/inventory reads from verification evidence and parse only execution-status exit lines"
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

function codexPreToolUseCommandsFor(config, toolName) {
  const entries = Array.isArray(config.hooks?.PreToolUse) ? config.hooks.PreToolUse : [];
  const commands = [];
  for (const entry of entries) {
    if (!matcherMentionsTool(entry?.matcher, toolName)) {
      continue;
    }
    for (const handler of hookHandlers(entry)) {
      commands.push(handler.command);
    }
  }
  return commands;
}

function matcherMentionsTool(matcher, toolName) {
  if (typeof matcher !== "string") {
    return false;
  }
  const parsedEscapedToolName = toolName.split(".").join("\\.");
  const serializedEscapedToolName = toolName.split(".").join("\\\\.");
  return (
    matcher.includes(toolName) ||
    matcher.includes(parsedEscapedToolName) ||
    matcher.includes(serializedEscapedToolName)
  );
}

function optionalLocalExists(file) {
  return trackedFiles.has(file) && exists(file);
}

function optionalLocalText(file) {
  return optionalLocalExists(file) ? fs.readFileSync(path.join(ROOT, file), "utf8") : "";
}
