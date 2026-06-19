import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { checkAgentSurfaces, syncAgentSurfaces } from "../scripts/skills/sync-llm.mjs";

const root = resolve(import.meta.dirname, "..");
const codexProjectDir = ["$", "{", "CODEX_PROJECT_DIR:-$PWD", "}"].join("");

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
      ".agents/prompts/supaschema-install.md": "# Install\n",
      ".codex/hooks.json": `${JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [
                {
                  command: `node "${codexProjectDir}/.codex/hooks/general-guard.mjs"`,
                  type: "command",
                },
                {
                  command: `node "${codexProjectDir}/scripts/github/ci-inbox.mjs" --runtime codex --event PreToolUse`,
                  type: "command",
                },
              ],
            },
          ],
        },
      })}\n`,
      ".claude/hooks/context-pre-tool-use.mjs": "process.stdout.write('pre');\n",
      ".claude/hooks/general-guard.mjs": "process.stdout.write('guard');\n",
      ".claude/hooks/guards/bash-policy-checks.mjs": "export {};\n",
      ".claude/hooks/sync-llm-on-claude-surface-change.mjs": "process.stdout.write('{}');\n",
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
      ".claude/rules/supaschema.md": "# Supaschema rule\n",
      ".claude/skills/elegant/SKILL.md": "# elegant\n",
      ".claude/skills/supaschema/SKILL.md": "# supaschema\n",
      "agent-bundle/INSTALL.md": "# Agent bundle install\n",
      ".codex/agents/stale.toml": 'name = "stale"\n',
      ".codex/hooks/stale.mjs": "process.stdout.write('stale');\n",
      ".codex/rules/stale.rules": "# stale\n",
      "skills/stale/SKILL.md": "# stale\n",
    });

    const result = syncAgentSurfaces({ root });

    expect(result).toMatchObject({
      agents: 1,
      agentBundle: 19,
      hooks: 4,
      publicSkills: 1,
      rules: 2,
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
    expect(read(root, "agent-bundle/codex/hooks.npm.json")).toContain("general-guard.mjs");
    expect(read(root, "agent-bundle/codex/hooks.npm.json")).not.toContain("ci-inbox.mjs");
    expect(read(root, ".agents/skills/elegant/SKILL.md")).toBe("# elegant\n");
    expect(read(root, "skills/supaschema/SKILL.md")).toBe("# supaschema\n");
    expect(existsSync(join(root, "skills/elegant/SKILL.md"))).toBe(false);
    expect(existsSync(join(root, ".codex/rules/stale.rules"))).toBe(false);
    expect(checkAgentSurfaces({ root })).toEqual([]);
  });

  it("does not sync for read-only Bash commands that mention Claude surfaces", () => {
    const project = tempSurface({
      ".claude/agents/worker.md": [
        "---",
        "name: worker",
        "description: Worker.",
        "---",
        "",
        "# Worker",
        "",
      ].join("\n"),
      ".claude/hooks/sync-llm-on-claude-surface-change.mjs": "",
      ".claude/rules/supaschema.md": "# Rule\n",
      ".claude/skills/supaschema/SKILL.md": "# Skill\n",
      "package.json": `${JSON.stringify({
        name: "supaschema",
        scripts: { "sync:llm": 'node -e "process.exit(71)"' },
      })}\n`,
    });
    const payload = {
      cwd: project,
      hook_event_name: "PostToolUse",
      tool_input: { command: "sed -n '1,20p' .claude/rules/supaschema.md" },
      tool_name: "Bash",
    };

    const output = execFileSync(
      process.execPath,
      [join(root, ".claude/hooks/sync-llm-on-claude-surface-change.mjs")],
      {
        encoding: "utf8",
        env: { ...process.env, CODEX_PROJECT_DIR: project },
        input: JSON.stringify(payload),
      }
    );

    expect(output).toBe("{}\n");
  });
});
