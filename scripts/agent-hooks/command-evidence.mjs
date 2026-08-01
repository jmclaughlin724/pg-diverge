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
  const domains = classifyCommandDomains(command, options);
  for (const domain of domains) {
    addEvidence(state, { domain, outcome: toolSuccess ? "success" : "failure" });
  }
  return {};
}

export function classifyCommandDomains(command, options = {}) {
  const domains = new Set();
  classifyShellSource(command, domains, {
    depth: 0,
    root: options.root ?? process.cwd(),
    scripts: packageScripts(options.root ?? process.cwd()),
    visitedScripts: new Set(),
  });
  return [...domains].sort();
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

function classifyShellSource(source, domains, context) {
  if (context.depth > 12) {
    return;
  }
  const analysis = parseShellCommand(source);
  if (analysis.errors.length > 0) {
    return;
  }
  for (const invocation of analysis.invocations) {
    const name = executableName(invocation.executable);
    const args = invocation.arguments.map(staticWordValue);
    if (!name || args.some((value) => value === null)) {
      continue;
    }
    classifyInvocation(name, args, domains, context);
  }
}

function classifyInvocation(name, args, domains, context) {
  if (name === "npm") {
    classifyNpm(args, domains, context);
    return;
  }
  if (name === "npx") {
    classifyPackageRunner(args, domains, context);
    return;
  }
  if (name === "gh") {
    classifyGithub(args, domains);
    return;
  }
  if (name === "node") {
    classifyNode(args, domains, context.root);
    return;
  }
  if (name === "uv") {
    classifyUv(args, domains, context);
    return;
  }
  classifyVerificationExecutable(name, args, domains);
}

function classifyNpm(args, domains, context) {
  const parsed = parseValues(args);
  const command = parsed.positionals[0] ?? "";
  if (command === "pack") {
    domains.add("package");
    return;
  }
  if (command === "test" || command === "t") {
    domains.add("test");
    classifyPackageScript("test", domains, context);
    return;
  }
  if (command === "run" || command === "run-script") {
    const script = parsed.positionals[1];
    if (script) {
      classifyPackageScript(script, domains, context);
    }
  }
}

function classifyPackageScript(name, domains, context) {
  if (context.visitedScripts.has(name)) {
    return;
  }
  const source = context.scripts[name];
  if (typeof source !== "string") {
    return;
  }
  context.visitedScripts.add(name);
  classifyShellSource(source, domains, { ...context, depth: context.depth + 1 });
}

function classifyPackageRunner(args, domains, context) {
  const parsed = parseValues(args, {
    call: { short: "c", type: "string" },
    package: { multiple: true, short: "p", type: "string" },
    userconfig: { type: "string" },
  });
  const name = executableName(parsed.positionals[0]);
  if (name) {
    classifyInvocation(name, parsed.positionals.slice(1), domains, context);
  }
}

function classifyNode(args, domains, root) {
  const parsed = parseValues(args, { test: { type: "boolean" } });
  if (parsed.values.test) {
    domains.add("test");
  }
  const script = parsed.positionals[0];
  if (!script) {
    return;
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
}

function classifyUv(args, domains, context) {
  if (args[0] !== "run") {
    return;
  }
  const parsed = parseValues(args.slice(1), {
    directory: { type: "string" },
    package: { type: "string" },
  });
  const name = executableName(parsed.positionals[0]);
  if (name) {
    classifyInvocation(name, parsed.positionals.slice(1), domains, context);
  }
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
  ["mint", "docs"],
]);

function classifyVerificationExecutable(name, args, domains) {
  if (helpOrVersion(args)) {
    return;
  }
  const simple = SIMPLE_VERIFICATION_DOMAINS.get(name);
  if (simple) {
    domains.add(simple);
    return;
  }
  if (name === "tsc") {
    domains.add(args.includes("--noEmit") ? "typecheck" : "build");
    return;
  }
  if (name === "ruff" && args[0] === "check") {
    domains.add("lint");
  }
}

function classifyGithub(args, domains) {
  if (args[0] === "pr" && (args[1] === "checks" || args[1] === "status")) {
    domains.add("github-checks");
    return;
  }
  if (args[0] === "run" && (args[1] === "list" || args[1] === "view" || args[1] === "watch")) {
    domains.add("github-checks");
    return;
  }
  if (args[0] !== "api") {
    return;
  }
  const endpoint = args.slice(1).find((value) => !value.startsWith("-"));
  if (!endpoint) {
    return;
  }
  let parsed;
  try {
    parsed = new URL(endpoint, "https://api.github.invalid");
  } catch {
    return;
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (
    segments.includes("actions") ||
    segments.includes("check-runs") ||
    segments.includes("commits")
  ) {
    domains.add("github-checks");
  }
}

function parseValues(args, options = {}) {
  const words = args.map((value, index) => ({ end: index, pos: index, text: value, value }));
  return parseStaticArguments(words, { options });
}

function helpOrVersion(args) {
  return args.some((value) => value === "--help" || value === "--version" || value === "-h");
}

function packageScripts(root) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    return manifest?.scripts && typeof manifest.scripts === "object" ? manifest.scripts : {};
  } catch {
    return {};
  }
}
