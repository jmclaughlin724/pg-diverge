import fs from "node:fs";
import path from "node:path";
import { toolSucceeded } from "./response-evidence.mjs";
import {
  executableName,
  parseShellCommand,
  parseStaticArguments,
  staticWordValue,
} from "./shell-command.mjs";
import { discoverSkills } from "./skill-frontmatter.mjs";
import { pathMatches, payloadPaths, unique, uniqueByName } from "./skill-paths.mjs";
import { currentTurnState } from "./state.mjs";

export function updatePromptSkills(payload, state, options = {}) {
  const inventory = discoverSkills(options.root, options.runtime);
  const matched = scorePrompt(promptText(payload), inventory);
  const turn = currentTurnState(state);
  const pendingMatches = [];
  for (const skill of matched) {
    if (state.loadedSkills[skill.name]) {
      continue;
    }
    pendingMatches.push(skill);
    turn.pendingSkills[skill.name] = { at: now(), trigger: skill.trigger };
  }
  if (pendingMatches.length === 0) {
    return {};
  }
  return {
    contextParts: [
      [
        "Required repository skill invocation:",
        ...pendingMatches.map(formatRequiredSkill),
        "Before taking task actions, invoke each listed skill through the Skill tool or read its SKILL.md completely when that tool is unavailable.",
      ].join("\n"),
    ],
  };
}

export function updateFileTriggeredSkills(payload, state, options = {}) {
  const inventory = discoverSkills(options.root, options.runtime);
  const targets = payloadPaths(payload, options.root);
  if (targets.length === 0) {
    return {};
  }
  const turn = currentTurnState(state);
  const matched = inventory.flatMap((skill) => {
    if (state.loadedSkills[skill.name]) {
      return [];
    }
    const signals = [];
    for (const candidate of targets) {
      for (const trigger of skill.fileTriggers) {
        if (pathMatches(trigger, candidate)) {
          signals.push({ candidate, trigger });
        }
      }
    }
    return signals.length > 0 ? [{ ...skill, matchSignals: signals }] : [];
  });
  for (const skill of matched) {
    turn.pendingSkills[skill.name] ??= { at: now(), trigger: "file-trigger" };
  }
  return matched.length > 0
    ? {
        contextParts: [
          [
            "Required repository skill invocation for this tool target:",
            ...matched.map(formatRequiredToolSkill),
            "Before further task actions, invoke each listed skill through the Skill tool or read its SKILL.md completely when that tool is unavailable.",
          ].join("\n"),
        ],
      }
    : {};
}

export function recordObservableSkillLoad(payload, state, options = {}) {
  const inventory = discoverSkills(options.root, options.runtime);
  const loaded = observedLoadedSkills(payload, inventory, options.root);
  const turn = currentTurnState(state);
  const at = now();
  for (const name of loaded) {
    if (state.loadedSkills[name] && !turn.pendingSkills[name]) {
      continue;
    }
    state.loadedSkills[name] = at;
    delete turn.pendingSkills[name];
  }
  return {};
}

export function unresolvedPending(state) {
  return Object.entries(currentTurnState(state).pendingSkills)
    .filter(([name]) => !state.loadedSkills[name])
    .map(([name, value]) => ({
      name,
      path: "",
      reason: reasonForTrigger(value?.trigger),
      trigger: value?.trigger,
    }));
}

export function pendingSkillMessage(state) {
  const pending = unresolvedPending(state);
  if (pending.length === 0) {
    return "";
  }
  return [
    "Load the required repository skill before continuing:",
    ...pending.map((item) => `- ${item.name}: ${item.reason}`),
  ].join("\n");
}

export function observedLoadedSkills(payload, inventoryOrRoot, rootMaybe) {
  const inventory = Array.isArray(inventoryOrRoot)
    ? inventoryOrRoot
    : discoverSkills(inventoryOrRoot, "claude");
  const root = Array.isArray(inventoryOrRoot) ? rootMaybe : inventoryOrRoot;
  if (!eligiblePostToolUse(payload)) {
    return [];
  }
  const requests = observableSkillLoadRequests(payload, inventory, root);
  if (payload?.tool_name === "Skill") {
    return requests.map((request) => request.name);
  }
  const delivered = structuredToolText(payload?.tool_response);
  if (delivered === undefined) {
    return [];
  }
  const expected = requests.map((request) => fs.readFileSync(request.path, "utf8")).join("");
  return expected.length > 0 && delivered === expected
    ? requests.map((request) => request.name)
    : [];
}

export function isObservableLoad(payload, root, runtime = "claude") {
  return observableSkillLoadRequests(payload, discoverSkills(root, runtime), root).length > 0;
}

export function promptText(payload) {
  const values = [payload?.prompt];
  if (payload?.tool_name === "Agent" || payload?.tool_name === "Task") {
    values.push(payload?.tool_input?.prompt, payload?.tool_input?.description);
  }
  return values.filter((item) => typeof item === "string").join("\n");
}

function observableSkillLoadRequests(payload, inventory, root) {
  const byName = new Map(inventory.map((skill) => [skill.name, skill]));
  const byPath = new Map(inventory.map((skill) => [path.resolve(skill.path), skill]));
  const toolName = typeof payload?.tool_name === "string" ? payload.tool_name : "";
  if (toolName === "Skill") {
    return skillToolLoadRequest(payload, byName);
  }
  if (toolName === "Read") {
    return readToolLoadRequest(payload, byPath, root);
  }
  return toolName === "Bash" ? bashToolLoadRequests(payload, byPath, root) : [];
}

function skillToolLoadRequest(payload, byName) {
  const value = payload?.tool_input?.skill;
  const name = typeof value === "string" ? cleanSkillToken(value) : "";
  const skill = byName.get(name);
  return skill ? [{ name: skill.name, path: path.resolve(skill.path) }] : [];
}

function readToolLoadRequest(payload, byPath, root) {
  if (payload?.tool_input?.offset !== undefined || payload?.tool_input?.limit !== undefined) {
    return [];
  }
  const file = payload?.tool_input?.file_path;
  if (typeof file !== "string" || file.length === 0) {
    return [];
  }
  const skill = byPath.get(resolveCandidatePath(file, root));
  return skill ? [{ name: skill.name, path: path.resolve(skill.path) }] : [];
}

function bashToolLoadRequests(payload, byPath, root) {
  const command =
    typeof payload?.tool_input?.command === "string" ? payload.tool_input.command : "";
  const files = literalCatPaths(command);
  if (files.length === 0) {
    return [];
  }
  const requests = [];
  for (const file of files) {
    const skill = byPath.get(resolveCandidatePath(file, root));
    if (!skill) {
      return [];
    }
    requests.push({ name: skill.name, path: path.resolve(skill.path) });
  }
  return uniqueByName(requests);
}

function structuredToolText(value) {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    const parts = value.map(structuredToolText);
    return parts.every((part) => part !== undefined) ? parts.join("") : undefined;
  }
  if (!(value && typeof value === "object")) {
    return;
  }
  for (const field of ["stdout", "content", "text", "output"]) {
    if (Object.hasOwn(value, field)) {
      return structuredToolText(value[field]);
    }
  }
}

function eligiblePostToolUse(payload) {
  if (payload?.hook_event_name !== "PostToolUse") {
    return false;
  }
  const outcome = toolSucceeded(payload);
  return outcome !== false;
}

function literalCatPaths(command) {
  if (!command) {
    return [];
  }
  const analysis = parseShellCommand(command);
  if (analysis.errors.length > 0) {
    return [];
  }
  const statements = analysis.script?.commands ?? [];
  if (statements.length !== 1) {
    return [];
  }
  const statement = statements[0];
  const commandNode = statement?.command;
  if (
    statement?.type !== "Statement" ||
    statement.background ||
    (statement.redirects ?? []).length > 0 ||
    commandNode?.type !== "Command" ||
    (commandNode.redirects ?? []).length > 0 ||
    executableName(staticWordValue(commandNode.name)) !== "cat"
  ) {
    return [];
  }
  const commandArguments = commandNode.suffix ?? [];
  const parsed = parseStaticArguments(commandArguments);
  if (parsed.dynamicIndexes.size > 0 || parsed.tokens.some((token) => token.kind === "option")) {
    return [];
  }
  const files = [];
  for (const token of parsed.tokens) {
    if (token.kind !== "positional") {
      continue;
    }
    const value = staticWordValue(commandArguments[token.index]);
    if (value !== null) {
      files.push(value);
    }
  }
  return files;
}

function scorePrompt(prompt, skills) {
  const normalized = prompt.toLowerCase();
  const explicit = [];
  const keyword = [];
  for (const skill of skills) {
    const explicitToken = namedSkillToken(normalized, skill.name);
    if (explicitToken) {
      explicit.push({ ...skill, matchSignals: [explicitToken], trigger: "prompt-explicit" });
      continue;
    }
    const keywords = matchingKeywords(normalized, skill.keywords);
    if (keywords.length > 0) {
      keyword.push({ ...skill, matchSignals: keywords, trigger: "prompt-keyword" });
    }
  }
  const explicitMatches = uniqueByName(explicit);
  const explicitNames = new Set(explicitMatches.map((item) => item.name));
  const keywordMatches = uniqueByName(keyword).filter((item) => !explicitNames.has(item.name));
  return [...explicitMatches, ...keywordMatches.slice(0, Math.max(0, 5 - explicitMatches.length))];
}

function namedSkillToken(prompt, name) {
  const normalizedName = name.toLowerCase();
  for (const token of [`$${normalizedName}`, `/${normalizedName}`]) {
    if (promptHasDelimitedTerm(prompt, token)) {
      return token;
    }
  }
  return "";
}

function matchingKeywords(prompt, keywords) {
  return unique(
    keywords
      .map((keyword) => keyword.toLowerCase().trim())
      .filter((keyword) => keyword.length >= 3)
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

function reasonForTrigger(trigger) {
  if (trigger === "prompt-explicit") {
    return "the prompt explicitly named this skill";
  }
  if (trigger === "prompt-keyword") {
    return "the prompt matched a curated keyword";
  }
  if (trigger === "file-trigger") {
    return "the tool target matched a configured file trigger";
  }
  return "skill context is pending";
}

function formatRequiredSkill(skill) {
  const signal = skill.matchSignals.map((item) => `"${item}"`).join(", ");
  const matchReason =
    skill.trigger === "prompt-explicit"
      ? `the prompt explicitly names ${signal}`
      : `the prompt contains configured trigger ${signal}`;
  const scope = skill.whenToUse || skill.description || "the skill's declared workflow applies";
  return [
    `- ${skill.name}`,
    `  Why: ${matchReason}. ${scope}`,
    `  Load: ${skill.relativePath}`,
  ].join("\n");
}

function formatRequiredToolSkill(skill) {
  const signal = skill.matchSignals[0];
  const scope = skill.whenToUse || skill.description || "the skill's declared workflow applies";
  return [
    `- ${skill.name}`,
    `  Why: target "${signal.candidate}" matches configured file trigger "${signal.trigger}". ${scope}`,
    `  Load: ${skill.relativePath}`,
  ].join("\n");
}

function resolveCandidatePath(value, root) {
  return path.resolve(root, value);
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

function now() {
  return new Date().toISOString();
}
