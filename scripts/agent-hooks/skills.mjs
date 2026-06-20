import fs from "node:fs";
import path from "node:path";
import { atlasAdvisoryTarget, isCodeAtlasQuery } from "./atlas.mjs";
import { currentTurnState } from "./state.mjs";

const defaultRoot = path.resolve(".");
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
const patchPrefixes = ["*** Add File: ", "*** Update File: ", "*** Delete File: ", "*** Move to: "];
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

export function discoverSkills(root = defaultRoot, runtime = "claude") {
  const skillRoot = path.join(root, runtime === "codex" ? ".codex" : ".claude", "skills");
  const fallbackRoot = path.join(root, ".claude", "skills");
  const base = fs.existsSync(skillRoot) ? skillRoot : fallbackRoot;
  const out = [];
  for (const file of listSkillFiles(base)) {
    const source = fs.readFileSync(file, "utf8");
    const frontmatter = parseFrontmatter(source);
    const dir = path.dirname(file);
    const name = stringValue(frontmatter.name) || path.basename(dir);
    out.push({
      description: stringValue(frontmatter.description),
      fileTriggers: stringArray(frontmatter["metadata.file-triggers"]),
      keywords: stringArray(frontmatter["metadata.keywords"]),
      name,
      path: file,
      relativePath: path.relative(root, file).split(path.sep).join("/"),
      whenToUse: stringValue(frontmatter.when_to_use),
    });
  }
  return out;
}

export function updatePromptSkills(payload, state, options = {}) {
  const prompt = promptText(payload);
  const turn = currentTurnState(state);
  turn.lastPrompt = prompt;
  const matched = scorePrompt(prompt, discoverSkills(options.root, options.runtime));
  for (const skill of matched) {
    if (!state.invokedSkills[skill.name]) {
      turn.pendingSkills[skill.name] = {
        reason: skill.reason,
        source: "UserPromptSubmit",
      };
    }
  }
  if (matched.length === 0) {
    return {};
  }
  return {
    contextParts: [
      [
        "Deterministic skill loading requested before governed work.",
        ...matched.map((skill) => `- Load ${skill.name}: ${skill.reason}`),
        "A slash command or inline token is only a request signal. The next governed tool call may load the skill; otherwise the pending skill clears only after the Skill tool loads it or a SKILL.md file is read.",
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
          "Load them with the Skill tool or a SKILL.md read if available; otherwise report findings for the orchestrator to apply in the main session. Subagent skill gating is advisory because PreToolUse fires inside subagents while SubagentStart cannot block and the subagent may lack the Skill/Read tools.",
        ].join("\n"),
      ],
    };
  }
  return {
    contextParts,
    deny: [
      "Required skills are pending, and this governed tool call was not an observable skill load.",
      ...pending.map((item) => `- ${item.name}: ${item.reason}`),
      "Load each skill with the Skill tool, read its SKILL.md file, or run the relevant Code Atlas query, then retry the blocked tool.",
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
      reason: typeof value?.reason === "string" ? value.reason : "Skill is pending.",
    }));
}

export function observedLoadedSkills(payload, root = defaultRoot) {
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

export function toolName(payload) {
  return typeof payload?.tool_name === "string" ? payload.tool_name : "";
}

function scorePrompt(prompt, skills) {
  const normalized = prompt.toLowerCase();
  const out = [];
  for (const skill of skills) {
    const hits = [];
    if (promptNamesSkill(normalized, skill.name)) {
      hits.push(skill.name);
    }
    hits.push(...matchingKeywords(normalized, skill.keywords));
    if (hits.length > 0) {
      out.push({
        name: skill.name,
        reason: `matched prompt signal: ${unique(hits).slice(0, 4).join(", ")}`,
      });
    }
  }
  return uniqueByName(out).slice(0, 5);
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

function scoreTool(payload, skills, root = defaultRoot) {
  const paths = payloadPaths(payload, root);
  const out = [];
  for (const skill of skills) {
    const pathHits = skill.fileTriggers.filter((trigger) =>
      paths.some((candidate) => pathMatches(trigger, candidate))
    );
    if (pathHits.length > 0) {
      out.push({
        name: skill.name,
        reason: `matched file trigger: ${pathHits.slice(0, 4).join(", ")}`,
      });
    }
  }
  return uniqueByName(out).slice(0, 5);
}

function payloadPaths(payload, root = defaultRoot) {
  const input = payload?.tool_input ?? {};
  const out = [];
  for (const key of ["file_path", "notebook_path", "path", "target", "uri"]) {
    if (typeof input[key] === "string") {
      out.push(repoRelative(input[key], root));
    }
  }
  const patch = input.command ?? input.patch ?? input.input;
  if (typeof patch === "string") {
    out.push(...patchPaths(patch, root));
  }
  out.push(...deepPathStrings(input, root));
  return unique(out.filter(Boolean));
}

function skillsFromPayloadPaths(payload, root) {
  return unique(
    payloadPaths(payload, root)
      .map((file) => skillFromSkillPath(file, root))
      .filter(Boolean)
  );
}

function skillsFromCommand(payload, root) {
  const command = commandText(payload);
  if (!commandReadsFiles(command)) {
    return [];
  }
  return unique(
    commandSkillPaths(command)
      .map((file) => skillFromSkillPath(file, root))
      .filter(Boolean)
  );
}

function commandText(payload) {
  const input = payload?.tool_input ?? {};
  if (typeof input.command === "string") {
    return input.command;
  }
  return typeof input.cmd === "string" ? input.cmd : "";
}

function commandReadsFiles(command) {
  const first = firstCommandToken(command);
  return ["bat", "cat", "head", "less", "more", "nl", "sed", "tail"].includes(first);
}

function commandSkillPaths(command) {
  const paths = [];
  for (const token of shellTokens(command)) {
    if (token.includes("/skills/") && token.endsWith("/SKILL.md")) {
      paths.push(token);
    }
  }
  return paths;
}

function firstCommandToken(command) {
  return shellTokens(command)[0] ?? "";
}

function shellTokens(command) {
  const tokens = [];
  let token = "";
  let quote = "";
  for (const char of command.trim()) {
    if (quote) {
      if (char === quote) {
        quote = "";
      } else {
        token += char;
      }
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (isWhitespace(char)) {
      if (token) {
        tokens.push(token);
        token = "";
      }
      continue;
    }
    token += char;
  }
  if (token) {
    tokens.push(token);
  }
  return tokens;
}

function patchPaths(text, root) {
  const out = [];
  for (const line of text.split("\n")) {
    for (const prefix of patchPrefixes) {
      if (line.startsWith(prefix)) {
        out.push(repoRelative(line.slice(prefix.length).trim(), root));
      }
    }
  }
  return out;
}

function skillFromSkillPath(value, root) {
  const normalized = repoRelative(value, root);
  const parts = normalized.split("/");
  const index = parts.lastIndexOf("skills");
  if (index === -1 || parts.at(-1) !== "SKILL.md") {
    return;
  }
  return parts[index + 1];
}

function deepPathStrings(value, root) {
  const out = [];
  const visit = (item, key = "") => {
    if (typeof item === "string") {
      if (key.includes("path") || key === "target" || key === "uri" || item.endsWith("SKILL.md")) {
        out.push(repoRelative(item, root));
      }
      return;
    }
    if (!item || typeof item !== "object") {
      return;
    }
    if (Array.isArray(item)) {
      for (const entry of item) {
        visit(entry, key);
      }
      return;
    }
    for (const [nextKey, nextValue] of Object.entries(item)) {
      visit(nextValue, nextKey.toLowerCase());
    }
  };
  visit(value);
  return out;
}

function repoRelative(value, root) {
  const normalized = value.split(path.sep).join("/");
  if (!path.isAbsolute(value)) {
    return normalized;
  }
  return path.relative(root, value).split(path.sep).join("/");
}

function pathMatches(trigger, candidate) {
  if (trigger.endsWith("/**")) {
    return candidate.startsWith(trigger.slice(0, -3));
  }
  return trigger === candidate;
}

function atlasPreEditContext(payload, turn, root = defaultRoot) {
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

function isCommandTool(name) {
  return ["Bash", "functions.exec_command", "exec_command"].includes(name);
}

function parseFrontmatter(text) {
  const lines = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  if (lines[0] !== "---") {
    return {};
  }
  const out = {};
  let current = "";
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line === "---") {
      return out;
    }
    current = readFrontmatterLine(line, current, out);
  }
  return out;
}

function readFrontmatterLine(line, current, out) {
  const trimmed = line.trim();
  if (trimmed.endsWith(":")) {
    return trimmed.slice(0, -1);
  }
  if (trimmed.startsWith("- ")) {
    const key = current.startsWith("metadata.") ? current : `metadata.${current}`;
    out[key] = [...(out[key] ?? []), unquote(trimmed.slice(2).trim())];
    return current;
  }
  const scalar = frontmatterScalar(trimmed);
  if (!scalar) {
    return current;
  }
  if (current === "metadata" && metadataListKey(scalar.key)) {
    const key = `metadata.${scalar.key}`;
    out[key] = scalar.value ? [scalar.value] : [];
    return key;
  }
  out[scalar.key] = scalar.value;
  return scalar.key;
}

function frontmatterScalar(trimmed) {
  const separator = trimmed.indexOf(":");
  if (separator === -1) {
    return;
  }
  return {
    key: trimmed.slice(0, separator).trim(),
    value: unquote(trimmed.slice(separator + 1).trim()),
  };
}

function metadataListKey(key) {
  return key === "keywords" || key === "file-triggers";
}

function listSkillFiles(root) {
  if (!fs.existsSync(root)) {
    return [];
  }
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name, "SKILL.md");
    if (entry.isDirectory() && fs.existsSync(file)) {
      out.push(file);
    }
  }
  return out.sort();
}

function unquote(value) {
  const trimmed = value.trim();
  const first = trimmed[0];
  const last = trimmed.at(-1);
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function stringValue(value) {
  return typeof value === "string" ? value : "";
}

function stringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
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

function isWhitespace(char) {
  return char === " " || char === "\n" || char === "\r" || char === "\t";
}

function unique(values) {
  return [...new Set(values)];
}

function uniqueByName(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item.name)) {
      return false;
    }
    seen.add(item.name);
    return true;
  });
}
