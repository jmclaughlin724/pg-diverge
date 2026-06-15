#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const routingPath = path.join(root, "scripts", "skills", "skill-routing.json");
const defaultLedgerDir = path.join(root, ".tmp", "skill-gate");
const editTools = new Set([
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "Write",
  "apply_patch",
  "edit_file",
]);
const patchPrefixes = ["*** Add File: ", "*** Update File: ", "*** Delete File: ", "*** Move to: "];

export function runSkillHook({ command = "match", runtime = "claude" } = {}) {
  const payload = readStdinJson();
  try {
    const output = handleSkillHook(command, payload, runtime);
    if (output !== undefined) {
      process.stdout.write(`${JSON.stringify(output)}\n`);
    }
    process.exit(0);
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({
        systemMessage: `supaschema skill hook error (fail-open): ${errorMessage(error)}`,
      })}\n`
    );
    process.exit(0);
  }
}

export function handleSkillHook(command, payload, runtime = "claude") {
  if (command === "clear" || command === "init") {
    clearLedger(payload);
    return;
  }

  if (command === "record") {
    recordSkill(payload, runtime);
    return;
  }

  const config = readRoutingConfig();
  const matched = matchedSkills(payload, config);

  if (command === "inject") {
    return injectOutput(payload, runtime, matched);
  }

  if (command === "gate" || command === "subagent") {
    return gateOutput(payload, runtime, config, matched);
  }

  return { matched };
}

function injectOutput(payload, runtime, matched) {
  if (matched.length === 0) {
    return;
  }
  creditSkills(payload, matched);
  return {
    hookSpecificOutput: {
      additionalContext: matched.map((item) => skillBrief(runtime, item)).join("\n\n---\n\n"),
      hookEventName: "UserPromptSubmit",
    },
  };
}

function gateOutput(payload, runtime, config, matched) {
  const mode = process.env.SKILL_GATE_MODE ?? config.mode ?? "warn";
  const loaded = new Set(readLedger(payload));
  const enforcing = matched.filter((item) => item.enforce && !item.promptOnly);
  const missing = enforcing.filter((item) => !loaded.has(item.skill));

  if (mode === "off" || missing.length === 0) {
    return;
  }

  if (mode === "enforce" && editTools.has(toolName(payload))) {
    creditSkills(payload, missing);
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: `Required repo skill not yet loaded for this edit: ${missing
          .map((item) => item.skill)
          .join(
            ", "
          )}. Guidance is delivered below and the gate is now satisfied for this session. Re-run the same tool call to proceed.\n\n${missing
          .map((item) => skillBrief(runtime, item))
          .join("\n\n---\n\n")}`,
      },
    };
  }

  return {
    systemMessage: `Skill routing (${mode}): load ${missing
      .map((item) => item.skill)
      .join(", ")} before editing. ${missing.map((item) => item.reason).join(" ")}`,
  };
}

function matchedSkills(payload, config) {
  const paths = payloadPaths(payload);
  const prompt = promptText(payload);
  const bash = bashText(payload);
  const out = [];

  for (const rule of config.rules ?? []) {
    const pathGlobs = [...strings(rule.whenPathGlob), ...strings(rule.whenToolEdits)];
    const pathMatched = pathGlobs.some((glob) =>
      paths.some((candidate) => globMatches(glob, candidate))
    );
    const bashMatched = strings(rule.whenBashMatches).some((term) => bash.includes(term));
    const promptMatched = strings(rule.whenPromptMatches).some((term) => prompt.includes(term));
    if (!(pathMatched || bashMatched || promptMatched)) {
      continue;
    }
    out.push({
      enforce: rule.enforce !== false,
      promptOnly: promptMatched && !(pathMatched || bashMatched),
      reason:
        typeof rule.reason === "string" ? rule.reason : "Path is governed by repo skill routing.",
      refs: strings(rule.refs),
      skill: String(rule.skill ?? ""),
    });
  }

  return uniqueBySkill(out.filter((item) => item.skill.length > 0));
}

function payloadPaths(input) {
  const values = [];
  const toolInput = input?.tool_input ?? {};
  for (const key of ["file_path", "notebook_path", "path"]) {
    if (typeof toolInput[key] === "string") {
      values.push(repoRelative(toolInput[key]));
    }
  }
  const patch = toolInput.command ?? toolInput.patch ?? toolInput.input;
  if (typeof patch === "string") {
    values.push(...patchPaths(patch));
  }
  return values.filter(Boolean);
}

function patchPaths(text) {
  const out = [];
  for (const line of text.split("\n")) {
    for (const prefix of patchPrefixes) {
      if (line.startsWith(prefix)) {
        out.push(repoRelative(line.slice(prefix.length).trim()));
      }
    }
  }
  return out;
}

function globMatches(glob, candidate) {
  if (glob.endsWith("/**")) {
    return candidate.startsWith(glob.slice(0, -3));
  }
  return candidate === glob;
}

function promptText(payload) {
  return strings([
    payload?.prompt,
    payload?.message,
    payload?.user_prompt,
    payload?.tool_input?.prompt,
    payload?.tool_input?.description,
  ]).join("\n");
}

function bashText(payload) {
  const input = payload?.tool_input ?? {};
  return strings([input.command, input.cmd]).join("\n");
}

function toolName(payload) {
  return typeof payload?.tool_name === "string" ? payload.tool_name : "";
}

function recordSkill(payload, runtime) {
  const skill = skillFromPayload(payload);
  if (!(skill && skillExists(runtime, skill))) {
    return;
  }
  const loaded = new Set(readLedger(payload));
  loaded.add(skill);
  writeLedger(payload, [...loaded].sort());
}

function creditSkills(payload, items) {
  const loaded = new Set(readLedger(payload));
  for (const item of items) {
    loaded.add(item.skill);
  }
  writeLedger(payload, [...loaded].sort());
}

function skillBrief(runtime, item) {
  const skillDir = runtimeSkillDir(runtime, item.skill);
  const chunks = [`# Required skill: ${item.skill}`, `Why this path is gated: ${item.reason}`];
  chunks.push(readText(path.join(skillDir, "SKILL.md")) ?? "(SKILL.md not found)");
  for (const ref of item.refs) {
    const refPath = path.resolve(skillDir, ref);
    if (!isInside(skillDir, refPath)) {
      chunks.push(`## ${ref}\nSkipped: reference is outside the skill directory.`);
      continue;
    }
    chunks.push(`## ${ref}\n${readText(refPath) ?? "(reference not found)"}`);
  }
  return chunks.join("\n\n");
}

function runtimeSkillDir(runtime, skill) {
  const primary = path.join(root, runtime === "codex" ? ".codex" : ".claude", "skills", skill);
  if (fs.existsSync(primary)) {
    return primary;
  }
  return path.join(root, ".claude", "skills", skill);
}

function skillExists(runtime, skill) {
  return fs.existsSync(path.join(runtimeSkillDir(runtime, skill), "SKILL.md"));
}

function skillFromPayload(input) {
  const value =
    input?.tool_input?.skill ??
    input?.tool_input?.name ??
    input?.tool_input?.file_path ??
    input?.tool_response?.name;
  if (typeof value !== "string") {
    return;
  }
  const parts = value.split("/");
  const skillIndex = parts.lastIndexOf("skills");
  if (skillIndex !== -1 && parts[skillIndex + 1]) {
    return parts[skillIndex + 1];
  }
  if (value.startsWith("$") || value.startsWith("@")) {
    return value.slice(1);
  }
  return value;
}

function readRoutingConfig() {
  return JSON.parse(fs.readFileSync(routingPath, "utf8"));
}

function ledgerDir() {
  return process.env.SUPASCHEMA_SKILL_GATE_LEDGER_DIR ?? defaultLedgerDir;
}

function ledgerPath(payload) {
  const raw =
    payload?.session_id ??
    payload?.sessionId ??
    process.env.CLAUDE_SESSION_ID ??
    process.env.CODEX_SESSION_ID ??
    "default";
  const id = String(raw || "default");
  return path.join(ledgerDir(), `${Buffer.from(id).toString("base64url")}.json`);
}

function clearLedger(payload) {
  fs.rmSync(ledgerPath(payload), { force: true });
}

function readLedger(payload) {
  try {
    const parsed = JSON.parse(fs.readFileSync(ledgerPath(payload), "utf8"));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function writeLedger(payload, values) {
  const destination = ledgerPath(payload);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, `${JSON.stringify(values, null, 2)}\n`);
}

function repoRelative(value) {
  const normalized = value.split(path.sep).join("/");
  if (!path.isAbsolute(value)) {
    return normalized;
  }
  return path.relative(root, value).split(path.sep).join("/");
}

function uniqueBySkill(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item.skill)) {
      return false;
    }
    seen.add(item.skill);
    return true;
  });
}

function strings(value) {
  if (Array.isArray(value)) {
    return value.filter((item) => typeof item === "string");
  }
  return typeof value === "string" ? [value] : [];
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return;
  }
}

function isInside(dir, file) {
  const rel = path.relative(dir, file);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function readStdinJson() {
  try {
    const raw = fs.readFileSync(0, "utf8");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
