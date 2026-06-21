#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, exists, gitTrackedFiles, ok, ROOT, readText } from "../lib/guard-utils.js";

const canonicalPolicyRoots = ["AGENTS.md", ".claude/rules", ".claude/skills"];

function isPolicyFile(name) {
  return [".md", ".rules", ".py", ".toml", ".yaml", ".yml"].some((ext) => name.endsWith(ext));
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

export function check(root = ROOT) {
  const trackedFiles = new Set(gitTrackedFiles(root));

  assert(
    !exists(".claude/rules/00-supaschema.md", root),
    "remove compatibility-only Rule 00 pointer"
  );
  assert(
    !exists(".codex/rules/00-supaschema.rules", root),
    "remove generated Rule 00 pointer mirror"
  );

  function trackedPolicyFiles(roots) {
    return [...trackedFiles]
      .filter((file) =>
        roots.some((policyRoot) => file === policyRoot || file.startsWith(`${policyRoot}/`))
      )
      .filter((file) => exists(file, root) && isPolicyFile(path.basename(file)))
      .sort();
  }
  const activePolicyFiles = () => trackedPolicyFiles(canonicalPolicyRoots);
  const activeRuleFiles = () => trackedPolicyFiles([".claude/rules", ".codex/rules"]);

  const rulePointerViolations = activeRuleFiles().flatMap((rel) =>
    compatibilityPointerViolations(rel, readText(rel, root))
  );
  assert(
    rulePointerViolations.length === 0,
    `rule surfaces must not keep compatibility-only pointers:\n${rulePointerViolations.join("\n")}`
  );

  const violations = [];
  for (const rel of activePolicyFiles()) {
    violations.push(...patchMinimizingViolations(rel, readText(rel, root)));
  }

  assert(
    violations.length === 0,
    `active policy surfaces must not reintroduce patch-minimizing default guidance:\n${violations.join("\n")}`
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  check();
  ok("AGENT_POLICY_STANDARDIZATION_OK");
}
