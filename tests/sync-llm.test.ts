import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkAgentSurfaces, syncAgentSurfaces } from "../scripts/skills/sync-llm.mjs";

function tempSurface(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "supa-sync-llm-"));
  for (const [file, source] of Object.entries(files)) {
    mkdirSync(join(root, dirname(file)), { recursive: true });
    writeFileSync(join(root, file), source);
  }
  return root;
}

function read(root: string, file: string): string {
  return readFileSync(join(root, file), "utf8");
}

describe("sync:llm", () => {
  it("mirrors private Claude surfaces locally and keeps public skills narrow", () => {
    const root = tempSurface({
      ".agents/skills/stale/SKILL.md": "# stale\n",
      ".claude/agents/ci-debugger.md": [
        "---",
        "name: ci-debugger",
        "description: Debug CI failures.",
        "tools: Read, Write",
        "---",
        "",
        "# CI Debugger",
        "",
        "Fix CI failures.",
        "",
      ].join("\n"),
      ".claude/hooks/context-pre-tool-use.mjs": "process.stdout.write('pre');\n",
      ".claude/rules/21-github-process.md": [
        "---",
        "description: GitHub process.",
        "---",
        "",
        "# Rule 21",
        "",
        "Direct fast-forward pushes to main are allowed by policy.",
        "",
      ].join("\n"),
      ".claude/skills/elegant/SKILL.md": "# elegant\n",
      ".claude/skills/supaschema/SKILL.md": "# supaschema\n",
      ".codex/agents/stale.toml": 'name = "stale"\n',
      ".codex/hooks/stale.mjs": "process.stdout.write('stale');\n",
      ".codex/rules/stale.rules": "# stale\n",
      "skills/stale/SKILL.md": "# stale\n",
    });

    const result = syncAgentSurfaces({ root });

    expect(result).toMatchObject({
      agents: 1,
      hooks: 1,
      publicSkills: 1,
      rules: 1,
      skillTargets: 1,
      skills: 2,
    });
    expect(read(root, ".codex/rules/21-github-process.rules")).toContain(
      "Direct fast-forward pushes to main are allowed by policy."
    );
    expect(read(root, ".codex/agents/ci-debugger.toml")).toContain(
      'sandbox_mode = "workspace-write"'
    );
    expect(read(root, ".codex/hooks/context-pre-tool-use.mjs")).toBe(
      "process.stdout.write('pre');\n"
    );
    expect(read(root, ".agents/skills/elegant/SKILL.md")).toBe("# elegant\n");
    expect(read(root, "skills/supaschema/SKILL.md")).toBe("# supaschema\n");
    expect(existsSync(join(root, "skills/elegant/SKILL.md"))).toBe(false);
    expect(existsSync(join(root, ".codex/rules/stale.rules"))).toBe(false);
    expect(checkAgentSurfaces({ root })).toEqual([]);
  });
});
