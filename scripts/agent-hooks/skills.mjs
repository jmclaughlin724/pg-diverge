import fs from "node:fs";
import path from "node:path";

const defaultRoot = path.resolve(".");
const frontmatterLinePattern = /\r?\n/;
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
]);
const observableLoadTools = new Set(["Read", "Skill"]);
const patchPrefixes = ["*** Add File: ", "*** Update File: ", "*** Delete File: ", "*** Move to: "];
const quoteEdgePattern = /^["']|["']$/g;
const wordSplitPattern = /[^a-z0-9_.-]+/;

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
  state.lastPrompt = prompt;
  const matched = scorePrompt(prompt, discoverSkills(options.root, options.runtime));
  for (const skill of matched) {
    if (!state.invokedSkills[skill.name]) {
      state.pendingSkills[skill.name] = {
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
        "Deterministic skill loading required before governed work.",
        ...matched.map((skill) => `- Load ${skill.name}: ${skill.reason}`),
        "A slash command or inline token is only a request signal. The pending skill clears only after the Skill tool loads it or a SKILL.md file is read.",
      ].join("\n"),
    ],
  };
}

export function updateToolSkills(payload, state, options = {}) {
  const matched = scoreTool(payload, discoverSkills(options.root, options.runtime), options.root);
  for (const skill of matched) {
    if (!state.invokedSkills[skill.name]) {
      state.pendingSkills[skill.name] = {
        reason: skill.reason,
        source: "PreToolUse",
      };
    }
  }
  const pending = unresolvedPending(state);
  if (pending.length === 0 || !toolGateSet.has(toolName(payload)) || isObservableLoad(payload)) {
    return matched.length > 0
      ? {
          contextParts: matched.map(
            (skill) => `Skill ${skill.name} applies to this tool use: ${skill.reason}`
          ),
        }
      : {};
  }
  return {
    deny: [
      "Required skills are pending and have not been observably loaded.",
      ...pending.map((item) => `- ${item.name}: ${item.reason}`),
      "Load each skill with the Skill tool or read its SKILL.md file, then retry the blocked tool.",
    ].join("\n"),
  };
}

export function recordObservableSkillLoad(payload, state, options = {}) {
  const loaded = observedLoadedSkills(payload, options.root);
  for (const skill of loaded) {
    state.invokedSkills[skill] = {
      at: new Date().toISOString(),
      source: toolName(payload),
    };
    delete state.pendingSkills[skill];
  }
  return loaded.length > 0
    ? {
        contextParts: loaded.map((skill) => `Observed skill load: ${skill}`),
      }
    : {};
}

export function unresolvedPending(state) {
  return Object.entries(state.pendingSkills)
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
    const file = payload?.tool_input?.file_path ?? payload?.tool_input?.path;
    const skill = skillFromSkillPath(typeof file === "string" ? file : "", root);
    return skill ? [skill] : [];
  }
  return [];
}

export function isObservableLoad(payload) {
  return observableLoadTools.has(toolName(payload)) && observedLoadedSkills(payload).length > 0;
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
    const terms = [
      skill.name,
      ...skill.keywords,
      ...words(skill.description),
      ...words(skill.whenToUse),
    ].filter((term) => term.length >= 4);
    const hits = unique(terms).filter((term) => normalized.includes(term.toLowerCase()));
    if (normalized.startsWith(`/${skill.name}`) || normalized.includes(`$${skill.name}`)) {
      hits.push(skill.name);
    }
    if (hits.length > 0) {
      out.push({
        name: skill.name,
        reason: `matched prompt signal: ${unique(hits).slice(0, 4).join(", ")}`,
      });
    }
  }
  return uniqueByName(out).slice(0, 5);
}

function scoreTool(payload, skills, root = defaultRoot) {
  const paths = payloadPaths(payload, root);
  const command =
    typeof payload?.tool_input?.command === "string" ? payload.tool_input.command : "";
  const out = [];
  for (const skill of skills) {
    const pathHits = skill.fileTriggers.filter((trigger) =>
      paths.some((candidate) => pathMatches(trigger, candidate))
    );
    const keywordHits = skill.keywords.filter((keyword) =>
      command.toLowerCase().includes(keyword.toLowerCase())
    );
    if (pathHits.length > 0 || keywordHits.length > 0) {
      out.push({
        name: skill.name,
        reason: `matched tool signal: ${[...pathHits, ...keywordHits].slice(0, 4).join(", ")}`,
      });
    }
  }
  return uniqueByName(out).slice(0, 5);
}

function payloadPaths(payload, root = defaultRoot) {
  const input = payload?.tool_input ?? {};
  const out = [];
  for (const key of ["file_path", "notebook_path", "path"]) {
    if (typeof input[key] === "string") {
      out.push(repoRelative(input[key], root));
    }
  }
  const patch = input.command ?? input.patch ?? input.input;
  if (typeof patch === "string") {
    out.push(...patchPaths(patch, root));
  }
  return out.filter(Boolean);
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

function parseFrontmatter(text) {
  const lines = text.split(frontmatterLinePattern);
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

function words(value) {
  return String(value ?? "")
    .toLowerCase()
    .split(wordSplitPattern)
    .filter(Boolean);
}

function unquote(value) {
  return value.trim().replace(quoteEdgePattern, "");
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
