import { hookMatcherMatchesTool } from "../../lib/hook-matcher.mjs";
import { forEachNode, parseScript, ts } from "../lib/typescript-ast.js";

export const sessionLifecycleEntrypointsFor = (runtimeRoot) =>
  ["start", "end"].map((phase) => `${runtimeRoot}/hooks/context-session-${phase}.mjs`);

export const sessionLifecycleEntrypoints = [
  ...sessionLifecycleEntrypointsFor(".claude"),
  ...sessionLifecycleEntrypointsFor(".codex"),
];

export function hookHandlers(value) {
  const out = [];
  const visit = (candidate) => {
    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        visit(item);
      }
      return;
    }
    if (!(candidate && typeof candidate === "object")) {
      return;
    }
    if (typeof candidate.command === "string" && candidate.type === "command") {
      out.push(candidate);
    }
    for (const item of Object.values(candidate)) {
      visit(item);
    }
  };
  visit(value);
  return out;
}

export function codexPreToolUseCommandsFor(config, toolName) {
  const entries = Array.isArray(config.hooks?.PreToolUse) ? config.hooks.PreToolUse : [];
  const commands = [];
  for (const entry of entries) {
    if (!matcherMentionsTool(entry?.matcher, toolName)) {
      continue;
    }
    for (const handler of hookHandlers(entry)) {
      commands.push(handler.command);
    }
  }
  return commands;
}

export function claudePreToolUseCommandsFor(config, toolName) {
  const entries = Array.isArray(config.hooks?.PreToolUse) ? config.hooks.PreToolUse : [];
  const commands = [];
  for (const entry of entries) {
    if (!claudeMatcherMentionsTool(entry?.matcher, toolName)) {
      continue;
    }
    for (const handler of hookHandlers(entry)) {
      commands.push(handlerCommandText(handler));
    }
  }
  return commands;
}

export function claudeMatcherMentionsTool(matcher, toolName) {
  if (typeof matcher !== "string" || matcher.length === 0) {
    return true;
  }
  return hookMatcherMatchesTool(matcher, toolName);
}

export function matcherMentionsTool(matcher, toolName) {
  if (typeof matcher !== "string") {
    return false;
  }
  return hookMatcherMatchesTool(matcher, toolName);
}

export function handlerCommandText(handler) {
  return [handler.command, ...(Array.isArray(handler.args) ? handler.args : [])].join(" ");
}

export function runnerImportsEvaluateBashPolicy(text) {
  const source = parseScript(text, "scripts/agent-hooks/runner.mjs");
  let found = false;
  forEachNode(source, (node) => {
    if (!ts.isImportDeclaration(node)) {
      return;
    }
    if (node.moduleSpecifier?.text !== "../../.claude/hooks/guards/bash-policy-checks.mjs") {
      return;
    }
    const bindings = node.importClause?.namedBindings;
    if (!(bindings && ts.isNamedImports(bindings))) {
      return;
    }
    found ||= bindings.elements.some((element) => element.name.text === "evaluateBashPolicy");
  });
  return found;
}

export function importsNamedBinding(text, sourceName, moduleSpecifier, bindingName) {
  const source = parseScript(text, sourceName);
  let found = false;
  forEachNode(source, (node) => {
    if (!ts.isImportDeclaration(node) || node.moduleSpecifier?.text !== moduleSpecifier) {
      return;
    }
    const bindings = node.importClause?.namedBindings;
    if (!(bindings && ts.isNamedImports(bindings))) {
      return;
    }
    found ||= bindings.elements.some((element) => element.name.text === bindingName);
  });
  return found;
}

export function runnerDeclaresFunction(text, name) {
  const source = parseScript(text, "scripts/agent-hooks/runner.mjs");
  let found = false;
  forEachNode(source, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      found = true;
    }
  });
  return found;
}
