#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ROUTING_PATH = path.join(ROOT, "scripts", "skills", "skill-routing.json");
const LEDGER_PATH = path.join(ROOT, ".tmp", "skills", "loaded.json");
const leadingSkillSigilPattern = /^[$@]/;

const command = process.argv[2] ?? "match";
const payload = readStdinJson();

if (command === "clear") {
  fs.rmSync(path.dirname(LEDGER_PATH), { recursive: true, force: true });
  process.exit(0);
}

if (command === "record") {
  const skill = skillFromPayload(payload);
  if (skill) {
    const loaded = new Set(readLedger());
    loaded.add(skill);
    writeLedger([...loaded].sort());
  }
  process.exit(0);
}

const matched = matchedSkills(payload);
if (command === "inject") {
  if (matched.length > 0) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: `Relevant repo skills: ${matched.map((item) => item.skill).join(", ")}`,
        },
      })
    );
  }
  process.exit(0);
}

if (command === "gate") {
  const config = JSON.parse(fs.readFileSync(ROUTING_PATH, "utf8"));
  const mode = process.env.SKILL_GATE_MODE ?? config.mode ?? "warn";
  const loaded = new Set(readLedger());
  const missing = matched.filter((item) => !loaded.has(item.skill));
  if (mode === "off" || missing.length === 0) {
    process.exit(0);
  }
  // Only file-editing tools are blocked; reads of governed paths stay advisory so
  // navigating source never hard-stops.
  const editingTools = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
  if (mode === "enforce" && editingTools.has(payload?.tool_name)) {
    // Deny once: deliver each required skill's brief into context and credit the
    // session ledger so the immediate re-run of the same edit finds it loaded and
    // proceeds (Rule 12). The SessionStart hook clears the ledger each session.
    const updated = new Set(loaded);
    for (const item of missing) {
      updated.add(item.skill);
    }
    writeLedger([...updated].sort());
    const briefs = missing.map((item) => skillBrief(item.skill, item.reason)).join("\n\n---\n\n");
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: `Required repo skill not yet loaded for this edit: ${missing
            .map((item) => item.skill)
            .join(
              ", "
            )}. Its guidance is delivered below and the gate is now satisfied for this session — re-run the same tool call to proceed.\n\n${briefs}`,
        },
      })
    );
    process.exit(0);
  }
  process.stdout.write(
    JSON.stringify({
      systemMessage: `Skill routing (${mode}): load ${missing
        .map((item) => item.skill)
        .join(", ")} before editing. ${missing.map((item) => item.reason).join(" ")}`,
    })
  );
  process.exit(0);
}

process.stdout.write(`${JSON.stringify({ matched }, null, 2)}\n`);

function matchedSkills(input) {
  const config = JSON.parse(fs.readFileSync(ROUTING_PATH, "utf8"));
  const paths = payloadPaths(input);
  const out = [];
  for (const rule of config.rules ?? []) {
    if (
      (rule.whenPathGlob ?? []).some((glob) =>
        paths.some((candidate) => globMatches(glob, candidate))
      )
    ) {
      out.push({ skill: rule.skill, reason: rule.reason });
    }
  }
  return uniqueBySkill(out);
}

function payloadPaths(input) {
  const values = [];
  const toolInput = input?.tool_input ?? {};
  for (const key of ["file_path", "path", "notebook_path"]) {
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
    for (const prefix of [
      "*** Add File: ",
      "*** Update File: ",
      "*** Delete File: ",
      "*** Move to: ",
    ]) {
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

function skillBrief(skill, reason) {
  const skillFile = path.join(ROOT, ".claude", "skills", skill, "SKILL.md");
  let body = "(SKILL.md not found)";
  try {
    body = fs.readFileSync(skillFile, "utf8");
  } catch {
    // Missing SKILL.md still yields an actionable denial via the reason line.
  }
  return `# Required skill: ${skill}\nWhy this path is gated: ${reason}\n\n${body}`;
}

function repoRelative(value) {
  const normalized = value.split(path.sep).join("/");
  if (!path.isAbsolute(value)) {
    return normalized;
  }
  return path.relative(ROOT, value).split(path.sep).join("/");
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
  return value.replace(leadingSkillSigilPattern, "");
}

function readLedger() {
  try {
    return JSON.parse(fs.readFileSync(LEDGER_PATH, "utf8"));
  } catch {
    return [];
  }
}

function writeLedger(values) {
  fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
  fs.writeFileSync(LEDGER_PATH, `${JSON.stringify(values, null, 2)}\n`);
}

function readStdinJson() {
  try {
    const raw = fs.readFileSync(0, "utf8");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
