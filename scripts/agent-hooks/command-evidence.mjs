import fs from "node:fs";
import path from "node:path";
import { toolSucceeded } from "./response-evidence.mjs";
import {
  executableName,
  parseShellCommand,
  parseStaticArguments,
  staticWordValue,
} from "./shell-command.mjs";
import { addEvidence } from "./state.mjs";

export function recordToolEvidence(payload, state, options = {}) {
  const command = shellCommand(payload);
  if (!command) {
    return {};
  }
  const observedOutcome = toolSucceeded(payload);
  const toolSuccess =
    observedOutcome ??
    (payload?.hook_event_name === "PostToolUse" && options.runtime === "claude" ? true : undefined);
  if (toolSuccess === undefined) {
    return {};
  }
  const outcome = toolSuccess ? "success" : "failure";
  const domains = classifyCommandOutcomeDomains(command, outcome, options);
  for (const domain of domains) {
    addEvidence(state, { domain, outcome });
  }
  return {};
}

export function classifyCommandDomains(command, options = {}) {
  return classifyCommandOutcomeDomains(command, "success", options);
}

export function classifyCommandOutcomeDomains(command, outcome, options = {}) {
  const result = classifyShellSource(command, {
    depth: 0,
    mode: "evidence",
    outcome: outcome === "failure" ? "failure" : "success",
    root: options.root ?? process.cwd(),
    scripts: packageScripts(options.root ?? process.cwd()),
    visitedScripts: new Set(),
  });
  return [...result.domains].sort();
}

function shellCommand(payload) {
  if (payload?.tool_name !== "Bash") {
    return "";
  }
  const input = payload?.tool_input ?? {};
  if (typeof input.command === "string") {
    return input.command;
  }
  if (typeof input.cmd === "string") {
    return input.cmd;
  }
  return "";
}

function classifyShellSource(source, context) {
  if (context.depth > 12) {
    return emptyClassification();
  }
  const analysis = parseShellCommand(source);
  if (analysis.errors.length > 0) {
    return emptyClassification();
  }
  if (context.mode === "cause") {
    return classifyFailureCauseScript(analysis.script, context);
  }
  return context.outcome === "failure"
    ? classifyFailureEvidenceScript(analysis.script, context)
    : classifySuccessEvidenceScript(analysis.script, context);
}

function classifySuccessEvidenceScript(script, context) {
  const node = singleOutcomeNode(script);
  return node ? classifySuccessEvidenceNode(node, context) : emptyClassification();
}

function classifySuccessEvidenceNode(node, context) {
  if (node?.type === "Command") {
    return classifyCommandNode(node, context);
  }
  if (node?.type !== "AndOr") {
    return emptyClassification();
  }
  const commands = node.commands ?? [];
  if (commands.length === 1) {
    return classifySuccessEvidenceNode(commands[0], context);
  }
  if (!hasOnlyOperator(node, "&&")) {
    return emptyClassification();
  }
  return combineClassifications(
    commands.map((command) => classifySuccessEvidenceNode(command, context))
  );
}

function classifyFailureEvidenceScript(script, context) {
  const node = singleOutcomeNode(script);
  return node ? classifyFailureEvidenceNode(node, context) : emptyClassification();
}

function classifyFailureEvidenceNode(node, context) {
  if (node?.type === "Command") {
    return classifyCommandNode(node, context);
  }
  if (node?.type !== "AndOr") {
    return emptyClassification();
  }
  const commands = node.commands ?? [];
  if (commands.length === 1) {
    return classifyFailureEvidenceNode(commands[0], context);
  }
  if (hasOnlyOperator(node, "||")) {
    return combineClassifications(
      commands.map((command) => classifyFailureEvidenceNode(command, context))
    );
  }
  if (!hasOnlyOperator(node, "&&")) {
    return emptyClassification();
  }
  const possibleCauses = combineClassifications(
    commands.map((command) => classifyFailureCauseNode(command, context))
  );
  return possibleCauses.complete && possibleCauses.domains.size === 1
    ? possibleCauses
    : emptyClassification();
}

function classifyFailureCauseScript(script, context) {
  const node = singleOutcomeNode(script);
  return node ? classifyFailureCauseNode(node, context) : emptyClassification();
}

function classifyFailureCauseNode(node, context) {
  if (node?.type === "Command") {
    return classifyCommandNode(node, { ...context, mode: "cause" });
  }
  if (node?.type !== "AndOr") {
    return emptyClassification();
  }
  const commands = node.commands ?? [];
  if (commands.length === 1) {
    return classifyFailureCauseNode(commands[0], context);
  }
  if (!(hasOnlyOperator(node, "&&") || hasOnlyOperator(node, "||"))) {
    return emptyClassification();
  }
  return combineClassifications(
    commands.map((command) => classifyFailureCauseNode(command, context))
  );
}

function singleOutcomeNode(script) {
  const statements = script?.commands ?? [];
  if (statements.length !== 1) {
    return;
  }
  const statement = statements[0];
  if (
    statement?.type !== "Statement" ||
    statement.background ||
    (statement.redirects ?? []).length > 0
  ) {
    return;
  }
  return statement.command;
}

function hasOnlyOperator(node, expected) {
  const commands = node.commands ?? [];
  const operators = node.operators ?? [];
  return (
    commands.length > 1 &&
    operators.length === commands.length - 1 &&
    operators.every((operator) => operator === expected)
  );
}

function classifyCommandNode(node, context) {
  if ((node.redirects ?? []).length > 0) {
    return emptyClassification();
  }
  const name = executableName(staticWordValue(node.name));
  const args = (node.suffix ?? []).map(staticWordValue);
  if (!name || args.some((value) => value === null)) {
    return emptyClassification();
  }
  return classifyInvocation(name, args, context);
}

function classifyInvocation(name, args, context) {
  if (helpOrVersion(args)) {
    return emptyClassification();
  }
  if (name === "npm") {
    return classifyNpm(args, context);
  }
  if (name === "npx") {
    return classifyPackageRunner(args, context);
  }
  if (name === "gh") {
    return classifyGithub(args);
  }
  if (name === "node") {
    return classifyNode(args, context.root);
  }
  if (name === "uv") {
    return classifyUv(args, context);
  }
  return classifyVerificationExecutable(name, args);
}

function classifyNpm(args, context) {
  const parsed = parseValues(args);
  const command = parsed.positionals[0] ?? "";
  if (command === "pack") {
    return knownClassification("package");
  }
  if (command === "test" || command === "t") {
    const direct = knownClassification("test");
    if (context.outcome === "success" && context.mode === "evidence") {
      return combineClassifications([direct, classifyPackageScript("test", context)], true);
    }
    return direct;
  }
  if (command === "run" || command === "run-script") {
    const script = parsed.positionals[1];
    if (script) {
      return classifyPackageScript(script, context);
    }
  }
  return emptyClassification();
}

function classifyPackageScript(name, context) {
  if (context.visitedScripts.has(name)) {
    return emptyClassification();
  }
  const source = context.scripts[name];
  if (typeof source !== "string") {
    return emptyClassification();
  }
  context.visitedScripts.add(name);
  try {
    return classifyShellSource(source, { ...context, depth: context.depth + 1 });
  } finally {
    context.visitedScripts.delete(name);
  }
}

function classifyPackageRunner(args, context) {
  const parsed = parseValues(args, {
    call: { short: "c", type: "string" },
    package: { multiple: true, short: "p", type: "string" },
    userconfig: { type: "string" },
  });
  const name = executableName(parsed.positionals[0]);
  if (name) {
    return classifyInvocation(name, parsed.positionals.slice(1), context);
  }
  return emptyClassification();
}

function classifyNode(args, root) {
  const domains = new Set();
  const parsed = parseValues(args, { test: { type: "boolean" } });
  if (parsed.values.test) {
    domains.add("test");
  }
  const script = parsed.positionals[0];
  if (!script) {
    return classification(domains, domains.size > 0);
  }
  const resolved = path.resolve(root, script);
  const relative = path.relative(root, resolved).split(path.sep).join("/");
  if (relative.startsWith("scripts/guards/")) {
    domains.add("guard");
  }
  if (relative === "scripts/lint.mjs") {
    domains.add("lint");
  }
  if (relative.startsWith("scripts/docs-lint/")) {
    domains.add("docs");
  }
  if (relative === "scripts/skills/sync-llm.mjs") {
    domains.add("sync");
  }
  if (resolved.split(path.sep).includes("vitest")) {
    domains.add("test");
  }
  return classification(domains, domains.size > 0);
}

function classifyUv(args, context) {
  if (args[0] !== "run") {
    return emptyClassification();
  }
  const parsed = parseValues(args.slice(1), {
    directory: { type: "string" },
    package: { type: "string" },
  });
  const name = executableName(parsed.positionals[0]);
  if (name) {
    return classifyInvocation(name, parsed.positionals.slice(1), context);
  }
  return emptyClassification();
}

const SIMPLE_VERIFICATION_DOMAINS = new Map([
  ["vitest", "test"],
  ["jest", "test"],
  ["mocha", "test"],
  ["pytest", "test"],
  ["mypy", "typecheck"],
  ["biome", "lint"],
  ["ultracite", "lint"],
  ["publint", "package"],
  ["attw", "package"],
  ["blume", "docs"],
]);

function classifyVerificationExecutable(name, args) {
  const simple = SIMPLE_VERIFICATION_DOMAINS.get(name);
  if (simple) {
    return knownClassification(simple);
  }
  if (name === "tsc") {
    return knownClassification(args.includes("--noEmit") ? "typecheck" : "build");
  }
  if (name === "ruff" && args[0] === "check") {
    return knownClassification("lint");
  }
  return emptyClassification();
}

function classifyGithub(args) {
  if (args[0] === "pr" && args[1] === "checks") {
    return knownClassification("github-checks");
  }
  if (args[0] === "run" && args[1] === "watch") {
    const parsed = parseValues(args.slice(2), {
      "exit-status": { type: "boolean" },
    });
    if (parsed.values["exit-status"] === true) {
      return knownClassification("github-checks");
    }
  }
  return emptyClassification();
}

function emptyClassification() {
  return classification(new Set(), false);
}

function knownClassification(...domains) {
  return classification(new Set(domains), true);
}

function classification(domains, complete) {
  return { complete, domains };
}

function combineClassifications(items, complete = items.every((item) => item.complete)) {
  const domains = new Set();
  for (const item of items) {
    for (const domain of item.domains) {
      domains.add(domain);
    }
  }
  return classification(domains, complete);
}

function parseValues(args, options = {}) {
  const words = args.map((value, index) => ({ end: index, pos: index, text: value, value }));
  return parseStaticArguments(words, { options });
}

function helpOrVersion(args) {
  for (const value of args) {
    if (value === "--help" || value === "--version" || value === "-h") {
      return true;
    }
  }
  return false;
}

function packageScripts(root) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    return manifest?.scripts && typeof manifest.scripts === "object" ? manifest.scripts : {};
  } catch {
    return {};
  }
}
