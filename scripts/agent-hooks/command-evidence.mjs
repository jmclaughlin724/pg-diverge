import fs from "node:fs";
import {
  commandArgs,
  commandName,
  commandSegmentObjects,
} from "../../.claude/hooks/guards/bash-policy-checks.mjs";
import { codeAtlasQueryEvidence } from "./atlas.mjs";
import { responseReportsFailure, toolSucceeded } from "./response-evidence.mjs";
import { addEvidence } from "./state.mjs";
import { isCommandTool, toolCommand, toolName } from "./tool-payload.mjs";

export function recordToolEvidence(payload, state) {
  const name = toolName(payload);
  const command = toolCommand(payload);
  const atlasEvidence = codeAtlasQueryEvidence(payload);
  if (!((isCommandTool(name) && command) || atlasEvidence)) {
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
      summary: toolSuccess ? "Code Atlas query succeeded" : "Code Atlas query failed",
    });
  }
  if (!(isCommandTool(name) && command)) {
    return {};
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
    return fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((entry) => entry?.type === "tool_result" && entry?.status === "success")
      .flatMap((entry) => {
        const command = transcriptCommand(entry);
        const domains = classifyCommandDomains(command);
        if (!(command && domains.length > 0)) {
          return [];
        }
        const success = commandEvidenceSucceeded(true, domains, entry);
        return [
          {
            command,
            domains,
            kind: success ? "verified-command" : "failed-command",
            outcome: success ? "success" : "failure",
            summary: String(entry.tool_name ?? "tool_result"),
          },
        ];
      });
  } catch {
    return [];
  }
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
  if (typeof entry?.tool_input?.command === "string") {
    return entry.tool_input.command;
  }
  if (typeof entry?.tool_input?.cmd === "string") {
    return entry.tool_input.cmd;
  }
  return "";
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
  const unwrapped = name === "npx" || name === "pnpx";
  const toolName = unwrapped ? (args[0] ?? "") : name;
  const toolArgs = unwrapped ? args.slice(1) : args;
  if (["vitest", "jest", "mocha", "node"].includes(toolName)) {
    addToolDomains(domains, toolName, toolArgs);
  }
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
