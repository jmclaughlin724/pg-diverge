import fs from "node:fs";
import {
  commandArgs,
  commandName,
  commandSegmentObjects,
} from "../../.claude/hooks/guards/bash-policy-checks.mjs";
import { codeAtlasQueryEvidence } from "./atlas.mjs";
import {
  responseReportsFailure,
  shellCommandNotFound,
  toolSucceeded,
} from "./response-evidence.mjs";
import { addEvidence } from "./state.mjs";

const shellToolNames = new Set(["Bash", "exec_command", "functions.exec_command"]);

export function recordToolEvidence(payload, state) {
  const command = shellCommand(payload);
  const atlasEvidence = codeAtlasQueryEvidence(normalizeShellPayload(payload, command));
  if (!(command || atlasEvidence)) {
    return {};
  }
  const toolSuccess = toolSucceeded(payload);
  if (toolSuccess === undefined) {
    return {};
  }
  if (atlasEvidence) {
    addEvidence(state, {
      ...atlasEvidence,
      outcome: toolSuccess ? "success" : "failure",
      summary: `Code Atlas query ${toolSuccess ? "succeeded" : "failed"}`,
    });
  }
  if (!command) {
    return {};
  }
  if (!toolSuccess && shellCommandNotFound(payload)) {
    addEvidence(state, {
      incident: "shell-command-not-found",
      kind: "tool-incident",
      outcome: "failure",
      summary: "shell reported command not found",
    });
  }
  const domains = classifyCommandDomains(command);
  if (domains.length === 0) {
    return {};
  }
  const success = commandEvidenceSucceeded(toolSuccess, domains, payload);
  addEvidence(state, {
    command,
    domains,
    kind: success ? "verified-command" : "failed-command",
    outcome: success ? "success" : "failure",
    summary: success ? "verification command succeeded" : "verification command failed",
  });
  return {};
}

export function transcriptEvidence(payload) {
  const file = typeof payload?.transcript_path === "string" ? payload.transcript_path : "";
  if (!file) {
    return [];
  }
  try {
    const entries = fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((entry) => entry && typeof entry === "object");
    return [
      ...entries.flatMap(transcriptToolResultEvidence),
      ...transcriptFunctionCallEvidence(entries),
    ];
  } catch {
    return [];
  }
}

function transcriptToolResultEvidence(entry) {
  if (entry?.type !== "tool_result") {
    return [];
  }
  const command = transcriptCommand(entry);
  const domains = classifyCommandDomains(command);
  if (!(command && domains.length > 0)) {
    return [];
  }
  const toolSuccess = transcriptToolSucceeded(entry);
  if (toolSuccess === undefined) {
    return [];
  }
  const success = commandEvidenceSucceeded(toolSuccess, domains, entry);
  return [
    {
      at: transcriptTimestamp(entry),
      command,
      domains,
      kind: success ? "verified-command" : "failed-command",
      outcome: success ? "success" : "failure",
      summary: String(entry.tool_name ?? "tool_result"),
    },
  ];
}

function transcriptFunctionCallEvidence(entries) {
  const calls = new Map();
  const evidence = [];
  for (const entry of entries) {
    const payload = entry?.payload;
    if (payload?.type === "function_call" && typeof payload.call_id === "string") {
      calls.set(payload.call_id, payload);
      continue;
    }
    if (payload?.type !== "function_call_output" || typeof payload.call_id !== "string") {
      continue;
    }
    const call = calls.get(payload.call_id);
    const command = transcriptFunctionCommand(call);
    const domains = classifyCommandDomains(command);
    if (!(command && domains.length > 0)) {
      continue;
    }
    const toolSuccess = toolSucceeded({ tool_response: payload.output });
    if (toolSuccess === undefined) {
      continue;
    }
    const success = commandEvidenceSucceeded(toolSuccess, domains, {
      tool_response: payload.output,
    });
    evidence.push({
      at: transcriptTimestamp(entry),
      command,
      domains,
      kind: success ? "verified-command" : "failed-command",
      outcome: success ? "success" : "failure",
      summary: String(call?.name ?? "function_call"),
    });
  }
  return evidence;
}

function transcriptToolSucceeded(entry) {
  const nested = toolSucceeded(entry);
  if (nested !== undefined) {
    return nested;
  }
  return entry?.status === "success" ? true : undefined;
}

export function unresolvedFailures(evidence) {
  return evidence
    .filter(isActionableFailure)
    .filter((failure) => !failureHasLaterSuccess(failure, evidence));
}

export function failureLabels(failures) {
  return [...new Set(failures.map(failureLabel))];
}

function transcriptCommand(entry) {
  return commandInput(entry?.tool_input);
}

function transcriptFunctionCommand(call) {
  if (!call || typeof call !== "object") {
    return "";
  }
  const name = typeof call.name === "string" ? call.name : "";
  if (!shellToolNames.has(name)) {
    return "";
  }
  return commandInput(jsonObject(call.arguments));
}

function shellCommand(payload) {
  const name = typeof payload?.tool_name === "string" ? payload.tool_name : "";
  return shellToolNames.has(name) ? commandInput(payload?.tool_input) : "";
}

function commandInput(input) {
  if (typeof input?.command === "string") {
    return input.command;
  }
  return typeof input?.cmd === "string" ? input.cmd : "";
}

function normalizeShellPayload(payload, command) {
  if (!command) {
    return payload;
  }
  const input =
    payload?.tool_input &&
    typeof payload.tool_input === "object" &&
    !Array.isArray(payload.tool_input)
      ? payload.tool_input
      : {};
  return {
    ...payload,
    tool_input: { ...input, command },
    tool_name: "Bash",
  };
}

function transcriptTimestamp(entry) {
  return typeof entry?.timestamp === "string" ? entry.timestamp : undefined;
}

function jsonObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return {};
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function commandEvidenceSucceeded(toolSuccess, domains, payload) {
  if (!toolSuccess) {
    return false;
  }
  if (domains.includes("github-checks") && responseReportsFailure(payload)) {
    return false;
  }
  return true;
}

function isActionableFailure(item) {
  return item.kind === "failed-command" && item.outcome === "failure";
}

function failureHasLaterSuccess(failure, evidence) {
  return evidence.some(
    (item) =>
      successfulCommandEvidence(item) && item.at > failure.at && sameEvidenceScope(failure, item)
  );
}

function sameEvidenceScope(failure, success) {
  const failureDomains = itemDomains(failure);
  const successDomains = itemDomains(success);
  if (failureDomains.length > 0 && successDomains.length > 0) {
    return failureDomains.some((domain) => successDomains.includes(domain));
  }
  return Boolean(failure.command && success.command && failure.command === success.command);
}

function itemDomains(item) {
  return Array.isArray(item?.domains)
    ? item.domains.filter((domain) => typeof domain === "string")
    : [];
}

function failureLabel(item) {
  const domains = itemDomains(item);
  if (domains.length > 0) {
    return domains.join("+");
  }
  return item.command ? `command:${item.command}` : "unknown";
}

function successfulCommandEvidence(item) {
  return (
    (item.kind === "verified-command" || item.kind === "successful-command") &&
    item.outcome !== "failure"
  );
}

function classifyCommandDomains(command) {
  const domains = new Set();
  let segments = [];
  try {
    segments = commandSegmentObjects(command);
  } catch {
    segments = [];
  }
  for (const segment of segments) {
    const tokens = segment.words ?? [];
    const name = commandName(tokens);
    const args = commandArgs(tokens);
    addSegmentDomains(domains, name, args);
  }
  return [...domains];
}

function addSegmentDomains(domains, name, args) {
  if (name === "gh") {
    addGithubDomains(domains, args);
    return;
  }
  if (name === "npm") {
    addNpmDomains(domains, args);
    return;
  }
  const unwrapped = unwrapPackageRunner(name, args);
  const toolName = unwrapped.name;
  const toolArgs = unwrapped.args;
  if (["vitest", "jest", "mocha", "node"].includes(toolName)) {
    addToolDomains(domains, toolName, toolArgs);
  }
}

function unwrapPackageRunner(name, args) {
  if (!(name === "npx" || name === "pnpx")) {
    return { args, name };
  }
  const valueOptions = new Set(["--call", "--package", "--userconfig", "-c", "-p"]);
  let index = 0;
  while (index < args.length) {
    const arg = args[index] ?? "";
    if (arg === "--") {
      index += 1;
      break;
    }
    if (!arg.startsWith("-") || arg === "-") {
      break;
    }
    index += 1;
    if (valueOptions.has(arg) && index < args.length) {
      index += 1;
    }
  }
  return { args: args.slice(index + 1), name: args[index] ?? "" };
}

function addGithubDomains(domains, args) {
  if (
    (args[0] === "pr" && ["checks", "status"].includes(args[1] ?? "")) ||
    (args[0] === "pr" &&
      args[1] === "view" &&
      args.some((arg) => arg.includes("statusCheckRollup"))) ||
    (args[0] === "run" && ["view", "watch", "list"].includes(args[1] ?? "")) ||
    (args[0] === "api" &&
      args.some(
        (arg) =>
          arg.includes("/actions/") || arg.includes("/check-runs") || arg.includes("/commits/")
      ))
  ) {
    domains.add("github-checks");
  }
}

function addNpmDomains(domains, args) {
  if (args[0] === "pack") {
    domains.add("package");
    return;
  }
  if (args[0] === "test") {
    domains.add("test");
    return;
  }
  if (args[0] !== "run") {
    return;
  }
  const script = args.find((arg, index) => index > 0 && !arg.startsWith("-")) ?? "";
  if (!script) {
    return;
  }
  if (script === "check") {
    domains.add("build");
    domains.add("lint");
    domains.add("test");
    domains.add("typecheck");
    return;
  }
  if (script === "guard" || script.startsWith("guard:")) {
    domains.add("guard");
  }
  if (script === "test" || script.includes("test") || script.includes("vitest")) {
    domains.add("test");
  }
  if (script.includes("typecheck")) {
    domains.add("typecheck");
  }
  if (script.includes("lint")) {
    domains.add("lint");
  }
  if (script.startsWith("docs:")) {
    domains.add("docs");
  }
  if (script.includes("package") || script.includes("pack")) {
    domains.add("package");
  }
  if (script.startsWith("sync:")) {
    domains.add("sync");
  }
  if (script === "build") {
    domains.add("build");
  }
  if (script.startsWith("code-atlas")) {
    domains.add("code-atlas");
  }
}

function addToolDomains(domains, name, args) {
  const versionProbe = args.some((arg) => arg === "--version" || arg === "--help");
  if (["vitest", "jest", "mocha"].includes(name) && !versionProbe) {
    domains.add("test");
  }
  if (name === "node" && args.some((arg) => arg.includes("vitest")) && !versionProbe) {
    domains.add("test");
  }
  if (name === "node" && args.some((arg) => arg.includes("scripts/guards/"))) {
    domains.add("guard");
  }
  if (name === "node" && args.some((arg) => arg.includes("scripts/skills/sync-llm.mjs"))) {
    domains.add("sync");
  }
}
