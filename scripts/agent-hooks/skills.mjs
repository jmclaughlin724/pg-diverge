import {
  commandArgs,
  commandName,
  commandSegmentObjects,
  isReadCommandName,
} from "../../.claude/hooks/guards/bash-policy-checks.mjs";
import { atlasAdvisoryTarget, isCodeAtlasQuery } from "./atlas.mjs";
import { discoverSkills } from "./skill-frontmatter.mjs";
import {
  pathMatches,
  payloadPaths,
  skillFromSkillPath,
  unique,
  uniqueByName,
} from "./skill-paths.mjs";
import { currentTurnState } from "./state.mjs";
import { isCommandTool, toolCommand, toolName } from "./tool-payload.mjs";

const toolGateSet = new Set([
  "Agent",
  "Bash",
  "Edit",
  "Glob",
  "Grep",
  "MultiEdit",
  "NotebookEdit",
  "Read",
  "Task",
  "WebFetch",
  "WebSearch",
  "Write",
  "apply_patch",
  "edit_file",
  "exec_command",
  "functions.apply_patch",
  "functions.exec_command",
]);
const lowSignalPromptTerms = new Set([
  "change",
  "check",
  "correct",
  "done",
  "fix",
  "implement",
  "issue",
  "plan",
  "task",
  "test",
  "that",
  "this",
  "update",
  "use",
  "verify",
  "with",
  "without",
  "work",
]);

export function updatePromptSkills(payload, state, options = {}) {
  const prompt = promptText(payload);
  const turn = currentTurnState(state);
  turn.lastPrompt = prompt;
  const matched = scorePrompt(prompt, discoverSkills(options.root, options.runtime));
  const pendingMatches = [];
  for (const skill of matched) {
    if (!state.invokedSkills[skill.name]) {
      pendingMatches.push(skill);
      turn.pendingSkills[skill.name] = {
        path: skill.path,
        reason: skill.reason,
        source: "UserPromptSubmit",
      };
    }
  }
  if (pendingMatches.length === 0) {
    return {};
  }
  return {
    contextParts: [
      [
        "Deterministic skill context is required before governed work.",
        ...pendingMatches.map((skill) => `- Load ${skill.name}: ${skill.reason}`),
        "Slash commands and inline skill tokens only request context; they do not load it.",
        observableLoadAction(pendingMatches),
      ].join("\n"),
    ],
  };
}

export function updateToolSkills(payload, state, options = {}) {
  const turn = currentTurnState(state);
  const matched = scoreTool(payload, discoverSkills(options.root, options.runtime), options.root);
  const newlyPending = [];
  for (const skill of matched) {
    if (!state.invokedSkills[skill.name]) {
      if (!turn.pendingSkills[skill.name]) {
        newlyPending.push(skill);
      }
      turn.pendingSkills[skill.name] = {
        path: skill.path,
        reason: skill.reason,
        source: "PreToolUse",
      };
    }
  }
  const pending = unresolvedPending(state);
  const contextParts = [
    ...newlyPending.map((skill) => `Skill ${skill.name} applies to this tool use: ${skill.reason}`),
    ...(pending.length > 0 ? atlasPreEditContext(payload, turn, options.root) : []),
  ];
  if (
    pending.length === 0 ||
    !toolGateSet.has(toolName(payload)) ||
    isObservableLoad(payload) ||
    isCodeAtlasQuery(payload)
  ) {
    return contextParts.length > 0 ? { contextParts } : {};
  }
  if (isSubagentInvocation(payload)) {
    return {
      contextParts: [
        ...contextParts,
        [
          "Skills pending from the parent task are not loaded in this subagent's isolated context:",
          ...pending.map((item) => `- ${item.name}: ${item.reason}`),
          observableLoadAction(pending),
          "If this subagent lacks a skill-loading tool, report findings for the orchestrator to apply in the main session. Subagent skill gating is advisory because PreToolUse fires inside subagents while SubagentStart cannot block and the subagent may lack the Skill/Read tools.",
        ].join("\n"),
      ],
    };
  }
  return {
    contextParts,
    deny: [
      "Required skills are pending, and this governed tool call was not an observable skill load.",
      ...pending.map((item) => `- ${item.name}: ${item.reason}`),
      observableLoadAction(pending),
      "Retry the blocked tool only after PostToolUse records the skill load.",
    ].join("\n"),
  };
}

export function recordObservableSkillLoad(payload, state, options = {}) {
  const loaded = observedLoadedSkills(payload, options.root);
  const turn = currentTurnState(state);
  for (const skill of loaded) {
    state.invokedSkills[skill] = {
      at: new Date().toISOString(),
      contextEpoch: state.contextEpoch,
      source: toolName(payload),
    };
    delete turn.pendingSkills[skill];
  }
  return loaded.length > 0
    ? {
        contextParts: loaded.map((skill) => `Observed skill load: ${skill}`),
      }
    : {};
}

export function unresolvedPending(state) {
  return Object.entries(currentTurnState(state).pendingSkills)
    .filter(([name]) => !state.invokedSkills[name])
    .map(([name, value]) => ({
      name,
      path: typeof value?.path === "string" ? value.path : "",
      reason: typeof value?.reason === "string" ? value.reason : "Skill is pending.",
    }));
}

export function observedLoadedSkills(payload, root) {
  const name = toolName(payload);
  if (name === "Skill") {
    const value =
      payload?.tool_input?.skill ??
      payload?.tool_input?.name ??
      payload?.tool_response?.skill ??
      payload?.tool_response?.name;
    return typeof value === "string" && value.length > 0 ? [cleanSkillToken(value)] : [];
  }
  if (name === "Read") {
    return skillsFromPayloadPaths(payload, root);
  }
  if (name.startsWith("mcp__")) {
    return skillsFromPayloadPaths(payload, root);
  }
  if (isCommandTool(name)) {
    return skillsFromCommand(payload, root);
  }
  return [];
}

export function isObservableLoad(payload) {
  return observedLoadedSkills(payload).length > 0;
}

export function isSubagentInvocation(payload) {
  return Boolean(payload?.agent_id ?? payload?.agentId);
}

export function promptText(payload) {
  return [
    payload?.prompt,
    payload?.message,
    payload?.user_prompt,
    payload?.tool_input?.prompt,
    payload?.tool_input?.description,
  ]
    .filter((item) => typeof item === "string")
    .join("\n");
}

function scorePrompt(prompt, skills) {
  const normalized = prompt.toLowerCase();
  const explicit = [];
  const keyword = [];
  for (const skill of skills) {
    const hits = [];
    const explicitMatch = promptNamesSkill(normalized, skill.name);
    if (explicitMatch) {
      hits.push(skill.name);
    }
    const keywordHits = matchingKeywords(normalized, skill.keywords);
    hits.push(...keywordHits);
    if (explicitMatch) {
      explicit.push(promptSkillMatch(skill, hits));
    } else if (keywordHits.length > 0) {
      keyword.push(promptSkillMatch(skill, keywordHits));
    }
  }
  const explicitMatches = uniqueByName(explicit);
  const explicitNames = new Set(explicitMatches.map((item) => item.name));
  const keywordMatches = uniqueByName(keyword).filter((item) => !explicitNames.has(item.name));
  return [...explicitMatches, ...keywordMatches.slice(0, Math.max(0, 5 - explicitMatches.length))];
}

function promptSkillMatch(skill, hits) {
  return {
    name: skill.name,
    path: skill.relativePath,
    reason: `matched prompt signal: ${unique(hits).slice(0, 4).join(", ")}`,
  };
}

function promptNamesSkill(prompt, name) {
  const normalizedName = name.toLowerCase();
  if (promptHasDelimitedTerm(prompt, `$${normalizedName}`)) {
    return true;
  }
  if (promptHasDelimitedTerm(prompt, `/${normalizedName}`)) {
    return true;
  }
  return (
    !lowSignalPromptTerms.has(normalizedName) && promptHasDelimitedTerm(prompt, normalizedName)
  );
}

function matchingKeywords(prompt, keywords) {
  return unique(
    keywords
      .map((keyword) => keyword.toLowerCase().trim())
      .filter((keyword) => keyword.length >= 3)
      .filter((keyword) => !lowSignalPromptTerms.has(keyword))
      .filter((keyword) => promptHasDelimitedTerm(prompt, keyword))
  );
}

function promptHasDelimitedTerm(prompt, term) {
  const normalizedTerm = term.toLowerCase().trim();
  if (!normalizedTerm) {
    return false;
  }
  let offset = 0;
  while (offset < prompt.length) {
    const index = prompt.indexOf(normalizedTerm, offset);
    if (index === -1) {
      return false;
    }
    const before = index === 0 ? "" : prompt[index - 1];
    const afterIndex = index + normalizedTerm.length;
    const after = afterIndex >= prompt.length ? "" : prompt[afterIndex];
    if (isTermBoundary(before) && isTermBoundary(after)) {
      return true;
    }
    offset = index + 1;
  }
  return false;
}

function scoreTool(payload, skills, root) {
  const paths = payloadPaths(payload, root);
  const out = [];
  for (const skill of skills) {
    const pathHits = skill.fileTriggers.filter((trigger) =>
      paths.some((candidate) => pathMatches(trigger, candidate))
    );
    if (pathHits.length > 0) {
      out.push({
        name: skill.name,
        path: skill.relativePath,
        reason: `matched file trigger: ${pathHits.slice(0, 4).join(", ")}`,
      });
    }
  }
  return uniqueByName(out).slice(0, 5);
}

function skillsFromPayloadPaths(payload, root) {
  return unique(
    payloadPaths(payload, root)
      .map((file) => skillFromSkillPath(file, root))
      .filter(Boolean)
  );
}

function skillsFromCommand(payload, root) {
  const command = toolCommand(payload);
  return unique(
    commandSkillPaths(command)
      .map((file) => skillFromSkillPath(file, root))
      .filter(Boolean)
  );
}

function commandSkillPaths(command) {
  const paths = [];
  const readerSegments = parsedCommandSegments(command.split("\\").join("/")).filter((segment) =>
    isReadCommandName(commandName(segment.words))
  );
  for (const segment of readerSegments) {
    for (const token of commandArgs(segment.words)) {
      appendSkillPaths(paths, token);
    }
  }
  return paths;
}

function parsedCommandSegments(command) {
  try {
    return commandSegmentObjects(command);
  } catch {
    return [];
  }
}

function expandSkillPathToken(value) {
  const normalized = value.split("\\").join("/");
  const open = normalized.indexOf("{");
  const close = open === -1 ? -1 : normalized.indexOf("}", open + 1);
  if (
    open === -1 ||
    close === -1 ||
    !normalized.slice(0, open).includes("/skills/") ||
    !normalized.slice(close + 1).endsWith("/SKILL.md")
  ) {
    return [normalized];
  }
  const prefix = normalized.slice(0, open);
  const suffix = normalized.slice(close + 1);
  const inner = normalized.slice(open + 1, close);
  return inner
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => `${prefix}${item}${suffix}`);
}

function appendSkillPaths(paths, token) {
  for (const expanded of expandSkillPathToken(token)) {
    if (expanded.includes("/skills/") && expanded.endsWith("/SKILL.md")) {
      paths.push(expanded);
    }
  }
}

function atlasPreEditContext(payload, turn, root) {
  if (
    !toolGateSet.has(toolName(payload)) ||
    isCodeAtlasQuery(payload) ||
    isObservableLoad(payload)
  ) {
    return [];
  }
  const target = atlasAdvisoryTarget(payload, root);
  if (!target || target.includes("/SKILL.md")) {
    return [];
  }
  const key = `pre-edit:${target}`;
  if (turn.atlasAdvisories[key]) {
    return [];
  }
  turn.atlasAdvisories[key] = true;
  return [
    `Code Atlas pre-edit evidence for ${target}: run \`npm run code-atlas:query -- pre-edit ${target} --json\` before broad edits; use \`trace-change\` for wider impact planning.`,
  ];
}

function observableLoadAction(items) {
  const paths = unique(items.map((item) => item.path).filter(Boolean));
  if (paths.length === 0) {
    return "Run an observable skill load now: use the Skill tool or read each required SKILL.md file before governed work.";
  }
  return `Run this observable skill load now: \`sed -n '1,220p' ${paths
    .map(shellQuote)
    .join(" ")}\`.`;
}

function shellQuote(value) {
  return `'${value.split("'").join("'\"'\"'")}'`;
}

function cleanSkillToken(value) {
  const cleaned = value.startsWith("$") || value.startsWith("@") ? value.slice(1) : value;
  return cleaned.split("/").filter(Boolean).at(-1) ?? cleaned;
}

function isTermBoundary(char) {
  return !(char && isAsciiLetterOrDigit(char));
}

function isAsciiLetterOrDigit(char) {
  const code = char.charCodeAt(0);
  return (code >= 48 && code <= 57) || (code >= 97 && code <= 122);
}
