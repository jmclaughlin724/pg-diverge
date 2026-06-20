#!/usr/bin/env node
import path from "node:path";
import { assert, exists, gitTrackedFiles, ok, readText } from "./lib/guard-utils.js";

const canonicalPolicyRoots = ["AGENTS.md", ".claude/rules", ".claude/skills"];
const trackedFiles = new Set(gitTrackedFiles());

const agents = readText("AGENTS.md");
const rule01 = readText(".claude/rules/01-operating-rules.md");
const rule07 = readText(".claude/rules/07-ast-over-regex.md");
const rule20 = readText(".claude/rules/20-anti-patterns.md");
const elegant = trackedFiles.has(".claude/skills/elegant/SKILL.md")
  ? readText(".claude/skills/elegant/SKILL.md")
  : "";

assertIncludesAll(agents, "AGENTS.md", "Repo-Wide Change Discipline", [
  "smallest correct end state",
  "not the smallest patch",
  "DEFAULT TO `$elegant` for every task and action",
  "MUST NOT create or keep backwards compatibility behavior or paths",
  "export-only compatibility files",
  "comments in code or scripts",
  "redundant or convenience entry points",
  "regex",
  "Use AST only for structural analysis",
  "Treat external-contract conflicts as STOP conditions; solve them in the canonical owner",
  "canonical owner",
  "single entry point",
  "duplicate owners",
  "wrappers",
  "aliases",
  "shims",
  "DTOs",
  "facades",
  "copied enum tuples",
  "casts",
  "local view-models",
  "allowlist exceptions",
  "Typed UI prop containers",
  "evidence and a worklist",
  "narrow check",
  "narrow owner",
  "narrow implementation step",
  "copied across multiple owners or entry points",
]);

assertIncludesAll(rule01, "Rule 01", "AGENTS-owned enforcement gate", [
  "AGENTS.md",
  "Repo-Wide Change Discipline",
  "DEFAULT TO `$elegant` for every task and action",
  "backwards compatibility behavior or paths",
  "export-only compatibility files",
  "shims",
  "comments in code or scripts",
  "redundant or convenience entry points",
  "regex",
  "Use AST only for structural analysis",
  "Treat external-contract conflicts as STOP conditions",
  "solve them in the canonical owner",
  "scripts/guards/check-canonical-surfaces.mjs",
  "STOP gate",
  "backwards-compatibility shims",
  "avoidable duplicate owners",
  "multiple entry points",
  "DTOs",
  "facades",
  "copied enum tuples",
  "cast-based contract patches",
  "local view-models",
  "allowlist exceptions",
  "scripts/guards/check-agent-policy-standardization.mjs",
]);

assertIncludesAll(rule07, "Rule 07", "regex remediation sequence", [
  "ast-grep",
  "TypeScript AST",
  "canonical scanner, parser, or model helpers",
  "zero regex nodes remain",
]);

assertIncludesAll(rule20, "Rule 20", "minimal-patch anti-pattern index", [
  "Minimal-patch bias",
  "backwards compatibility behavior or paths",
  "duplicate owners",
  "wrappers",
  "aliases",
  "shims",
  "DTOs",
  "facades",
  "copied enum tuples",
  "casts that patch missing contracts",
  "local view-models",
  "allowlist exceptions",
  "export-only compatibility files",
  "re-export shims",
  "alias modules",
  "compatibility layers",
  "comments in code or scripts",
  "convenience entry points",
  "Regex instead of AST/parser APIs",
  "scripts/guards/check-canonical-surfaces.mjs",
  "multiple entry points",
  "consolidation is larger",
  "Typed UI prop containers",
]);

if (elegant) {
  assertIncludesAll(elegant, "elegant skill", "canonical execution lens", [
    "one canonical owner per concept",
    "DTOs",
    "facades",
    "copied enum tuples",
    "casts that patch missing contracts",
    "local view-models",
    "allowlist exceptions",
    "Typed UI prop containers",
    "Do not patch around missing contracts",
  ]);
}

assert(!exists(".claude/rules/00-supaschema.md"), "remove compatibility-only Rule 00 pointer");
assert(!exists(".codex/rules/00-supaschema.rules"), "remove generated Rule 00 pointer mirror");

const rulePointerViolations = activeRuleFiles().flatMap((rel) =>
  compatibilityPointerViolations(rel, readText(rel))
);
assert(
  rulePointerViolations.length === 0,
  `rule surfaces must not keep compatibility-only pointers:\n${rulePointerViolations.join("\n")}`
);

const violations = [];
for (const rel of activePolicyFiles()) {
  violations.push(...patchMinimizingViolations(rel, readText(rel)));
}

assert(
  violations.length === 0,
  `active policy surfaces must not reintroduce patch-minimizing default guidance:\n${violations.join("\n")}`
);

ok("AGENT_POLICY_STANDARDIZATION_OK");

function activePolicyFiles() {
  return trackedPolicyFiles(canonicalPolicyRoots);
}

function activeRuleFiles() {
  return trackedPolicyFiles([".claude/rules", ".codex/rules"]);
}

function trackedPolicyFiles(roots) {
  return [...trackedFiles]
    .filter((file) => roots.some((root) => file === root || file.startsWith(`${root}/`)))
    .filter((file) => exists(file) && isPolicyFile(path.basename(file)))
    .sort();
}

function isPolicyFile(name) {
  return [".md", ".rules", ".py", ".toml", ".yaml", ".yml"].some((ext) => name.endsWith(ext));
}

function assertIncludesAll(text, owner, invariant, snippets) {
  const lowered = text.toLowerCase();
  for (const snippet of snippets) {
    assert(
      lowered.includes(snippet.toLowerCase()),
      `${owner} must enforce ${invariant}: missing "${snippet}"`
    );
  }
}

function patchMinimizingViolations(rel, text) {
  const exactForbidden = [
    "smallest safe change",
    "smallest safe consolidation",
    "small, verifiable changes",
    "small, verifiable steps",
    "explicitly requires backwards compatibility",
    "explicitly asks for backwards compatibility",
    "compatibility-constrained",
    "compatible portion of the elegant workflow",
    "compatibility-preserving path",
    "compatibility-preserving option",
    "compatibility constraint:",
    "compatibility stubs",
    "compatibility stub",
    "unless explicitly required",
    "or report the blocker",
  ];
  const smallnessTerms = ["smallest", "narrowest", "minimal", "minimum"];
  const patchTerms = ["patch", "change", "fix", "root-cause", "root cause", "consolidation"];
  const positiveGuidanceTerms = [
    "make",
    "choose",
    "execute",
    "apply",
    "write",
    "use",
    "default",
    "goal",
    "target",
    "prefer",
    "should",
    "must",
  ];
  const allowedNegativeContexts = [
    "smallest correct end state",
    "not the smallest patch",
    "not a compatibility patch",
    "do not",
    "must not",
    "stop if",
    "anti-pattern",
    "prohibited",
    "forbidden",
    "without shrinking",
    "narrow verification only to prove",
    "minimal-patch bias",
    "because consolidation is larger",
    "larger than patching around",
    "narrowest command that proves",
    "narrowest checks that prove",
    "narrowest meaningful checks",
    "narrowest meaningful proof",
    "changed code execute",
  ];

  const found = [];
  const lowered = text.toLowerCase();
  for (const phrase of exactForbidden) {
    if (lowered.includes(phrase)) {
      found.push(`${rel}: contains "${phrase}"`);
    }
  }

  text.split("\n").forEach((rawLine, index) => {
    const line = rawLine.toLowerCase().replaceAll("\r", "").replaceAll("`", "");
    if (!line.trim()) {
      return;
    }
    if (allowedNegativeContexts.some((phrase) => line.includes(phrase))) {
      return;
    }
    const hasSmallness = smallnessTerms.some((term) => line.includes(term));
    const hasPatchTarget = patchTerms.some((term) => line.includes(term));
    const hasPositiveGuidance = positiveGuidanceTerms.some((term) => line.includes(term));
    if (hasSmallness && hasPatchTarget && hasPositiveGuidance) {
      found.push(`${rel}:${index + 1}: patch-minimizing positive guidance: ${rawLine.trim()}`);
    }
  });

  return found;
}

function compatibilityPointerViolations(rel, text) {
  const forbidden = [
    "compatibility pointer",
    "rule-citation compatibility",
    "exists only to preserve",
  ];
  const lowered = text.toLowerCase();
  return forbidden
    .filter((phrase) => lowered.includes(phrase))
    .map((phrase) => `${rel}: contains "${phrase}"`);
}
