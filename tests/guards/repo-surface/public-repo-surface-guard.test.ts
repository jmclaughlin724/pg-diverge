import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { check } from "../../../scripts/guards/repo-surface/check-public-repo-surface.mjs";
import { tempGuardRepo } from "../../guard-fixture.js";

describe("public repo surface guard", () => {
  it("allows ignored private local skills to remain on disk", () => {
    const root = tempGuardRepo({
      ".gitignore": ".agents/skills/*\n",
      ".agents/skills/elegant/SKILL.md": "# elegant\n",
    });
    expect(() => check(root)).not.toThrow();
  });

  it("allows reviewed source-repo hook runtime surfaces", () => {
    const root = tempGuardRepo({
      ".claude/settings.json": "{}\n",
      ".claude/hooks/context-pre-tool-use.mjs": "export {};\n",
      ".claude/hooks/supaschema-source-hook.mjs": "export {};\n",
      ".claude/rules/22-agent-surface-sync-ownership.md": "# Rule 22\n",
      ".codex/hooks/context-pre-tool-use.mjs": "export {};\n",
      ".codex/hooks/supaschema-source-hook.mjs": "export {};\n",
      ".codex/rules/22-agent-surface-sync-ownership.rules": "# Rule 22\n",
      "scripts/agent-hooks/runner.mjs": "export {};\n",
    });
    expect(() => check(root)).not.toThrow();
  });

  it("blocks unignored private local skills before they can be staged", () => {
    const root = tempGuardRepo({
      ".agents/skills/elegant/SKILL.md": "# elegant\n",
    });
    expect(() => check(root)).toThrow("unignored local files that could be staged");
  });

  it("blocks tracked private local skills with an untrack-only repair", () => {
    const root = tempGuardRepo({
      ".agents/skills/elegant/SKILL.md": "# elegant\n",
    });
    execFileSync("git", ["add", ".agents/skills/elegant/SKILL.md"], {
      cwd: root,
      stdio: "ignore",
    });
    expect(() => check(root)).toThrow("tracked public GitHub exposure");
  });
});
