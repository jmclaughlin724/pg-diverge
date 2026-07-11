import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { check } from "../../../scripts/guards/repo-surface/check-public-repo-surface.mjs";
import { tempGuardRepo } from "../fixture.js";

describe("public repo surface guard", () => {
  it("allows agent runtime skill targets without a public-surface catalog", () => {
    const root = tempGuardRepo({
      ".agents/skills/elegant/SKILL.md": "# elegant\n",
    });
    expect(() => check(root)).not.toThrow();
  });

  it("allows reviewed source-repo hook runtime surfaces", () => {
    const root = tempGuardRepo({
      ".claude/hooks/context-pre-tool-use.mjs": "export {};\n",
      ".claude/hooks/supaschema-source-hook.mjs": "export {};\n",
      ".claude/rules/22-agent-surface-sync-ownership.md": "# Rule 22\n",
      ".claude/settings.json": "{}\n",
      ".codex/hooks/context-pre-tool-use.mjs": "export {};\n",
      ".codex/hooks/supaschema-source-hook.mjs": "export {};\n",
      ".codex/rules/22-agent-surface-sync-ownership.rules": "# Rule 22\n",
      "scripts/agent-hooks/runner.mjs": "export {};\n",
    });
    expect(() => check(root)).not.toThrow();
  });

  it("blocks unignored private local paths before they can be staged", () => {
    const root = tempGuardRepo({
      "scripts/code-atlas/local.mjs": "export {};\n",
    });
    expect(() => check(root)).toThrow("unignored local files that could be staged");
  });

  it("blocks tracked private local paths with an untrack-only repair", () => {
    const root = tempGuardRepo({
      "scripts/code-atlas/local.mjs": "export {};\n",
    });
    execFileSync("git", ["add", "scripts/code-atlas/local.mjs"], {
      cwd: root,
      stdio: "ignore",
    });
    expect(() => check(root)).toThrow("tracked public GitHub exposure");
  });
});
