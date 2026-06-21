import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkAgentSurfaces,
  renderSourceCodexHooks,
  syncAgentSurfaces,
} from "../../scripts/skills/sync-llm.mjs";

const root = resolve(import.meta.dirname, "../..");
const claudeProjectDir = ["$", "{", "CLAUDE_PROJECT_DIR", "}"].join("");
const codexProjectDir = ["$", "{", "CODEX_PROJECT_DIR:-$PWD", "}"].join("");
const editToolMatcher = [
  "^",
  "(",
  "apply_patch",
  "|",
  "functions\\\\.apply_patch",
  "|",
  "Edit",
  "|",
  "Write",
  "|",
  "edit_file",
  ")",
  "$",
].join("");

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

function claudeHookSourceFiles(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    "AGENTS.md": "# Agents\n",
    "CLAUDE.md": "@AGENTS.md\n",
    ".claude/rules/12-skill-loading-enforcement.md": [
      'mechanism-only correctness answers decision: "block" $elegant verification disposition',
      "Source and inventory reads MUST NOT become verification evidence",
      "process.exitCode = 2",
      "",
    ].join("\n"),
    ".claude/settings.json": `${JSON.stringify(claudeHookSettings())}\n`,
    "scripts/agent-hooks/response-shape.mjs": [
      "mechanismClaimWithoutArchitecture mechanism-claim-without-architecture",
      "architecture/end-state disposition verification disposition",
      "",
    ].join("\n"),
    "scripts/agent-hooks/command-evidence.mjs": "domains.length === 0\n",
    "scripts/agent-hooks/response-evidence.mjs":
      "exitCodeFromExecutionStatus isExecutionStatusLabel\n",
    "scripts/agent-hooks/runner.mjs":
      "function responseShape() { return { block: detectorResult.contextParts.join('\\n') }; }\n",
    ...overrides,
  };
}

function claudeHookSettings() {
  return {
    hooks: {
      PermissionDenied: [
        {
          hooks: [claudeNodeHook(".claude/hooks/context-permission-denied.mjs")],
        },
      ],
      PostToolBatch: [
        {
          hooks: [claudeNodeHook(".claude/hooks/sync-llm-on-claude-surface-change.mjs")],
        },
      ],
      PostToolUse: [
        {
          hooks: [claudeNodeHook(".claude/hooks/context-post-tool-use.mjs")],
        },
        {
          hooks: [claudeSupaschemaHook("schema-write")],
        },
      ],
      PreToolUse: [
        {
          hooks: [claudeNodeHook(".claude/hooks/context-pre-tool-use.mjs")],
        },
        {
          hooks: [claudeSupaschemaHook("generated-migration-edit")],
        },
      ],
      SessionEnd: [
        {
          hooks: [claudeNodeHook(".claude/hooks/context-session-end.mjs")],
        },
      ],
      SessionStart: [
        {
          hooks: [claudeNodeHook(".claude/hooks/context-session-start.mjs")],
        },
      ],
      Stop: [
        {
          hooks: [claudeNodeHook(".claude/hooks/context-stop.mjs")],
        },
      ],
      SubagentStart: [
        {
          hooks: [claudeNodeHook(".claude/hooks/context-subagent-start.mjs")],
        },
      ],
      SubagentStop: [
        {
          hooks: [claudeNodeHook(".claude/hooks/context-subagent-stop.mjs")],
        },
      ],
      UserPromptSubmit: [
        {
          hooks: [claudeNodeHook(".claude/hooks/context-user-prompt-submit.mjs")],
        },
      ],
    },
  };
}

function claudeNodeHook(relativePath: string) {
  return {
    args: [`${claudeProjectDir}/${relativePath}`],
    command: "node",
    type: "command",
  };
}

function claudeSupaschemaHook(command: string) {
  return {
    args: [`${claudeProjectDir}/.claude/hooks/supaschema-source-hook.mjs`, "hook", command],
    command: "node",
    type: "command",
  };
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
          UserPromptSubmit: [
            {
              hooks: [
                {
                  command: `node "${codexProjectDir}/.codex/hooks/context-user-prompt-submit.mjs"`,
                  type: "command",
                },
              ],
            },
          ],
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [
                {
                  command: `node "${codexProjectDir}/.codex/hooks/context-pre-tool-use.mjs"`,
                  type: "command",
                },
                {
                  command: `node "${codexProjectDir}/.codex/hooks/general-guard.mjs"`,
                  type: "command",
                },
              ],
            },
            {
              matcher: editToolMatcher,
              hooks: [
                {
                  command: `node "${codexProjectDir}/.codex/hooks/supaschema-source-hook.mjs" hook generated-migration-edit --runtime codex`,
                  type: "command",
                },
              ],
            },
          ],
          PostToolUse: [
            {
              matcher: "Bash",
              hooks: [
                {
                  command: `node "${codexProjectDir}/.codex/hooks/context-post-tool-use.mjs"`,
                  type: "command",
                },
              ],
            },
            {
              matcher: editToolMatcher,
              hooks: [
                {
                  command: `node "${codexProjectDir}/.codex/hooks/supaschema-source-hook.mjs" hook schema-write`,
                  type: "command",
                },
              ],
            },
          ],
          Stop: [
            {
              hooks: [
                {
                  command: `node "${codexProjectDir}/.codex/hooks/context-stop.mjs"`,
                  type: "command",
                },
                {
                  command: `node "${codexProjectDir}/.codex/hooks/sync-llm-on-claude-surface-change.mjs"`,
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
      ".claude/hooks/supaschema-source-hook.mjs": "export {};\n",
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
      ".codex/hooks/general-guard.mjs": "process.stdout.write('native');\n",
      ".codex/hooks/stale.mjs": "process.stdout.write('stale');\n",
      ".codex/rules/stale.rules": "# stale\n",
      "skills/stale/SKILL.md": "# stale\n",
    });

    const result = syncAgentSurfaces({ root });

    expect(result).toMatchObject({
      agents: 1,
      agentBundle: 19,
      codexHookConfig: 1,
      hooks: 5,
      publicSkills: 1,
      rules: 2,
      skillTargets: 1,
      skills: 2,
    });
    expect(read(root, ".codex/rules/21-github-process.rules")).toContain(
      "Canonical rule owner: .claude/rules/21-github-process.md"
    );
    expect(read(root, ".codex/rules/21-github-process.rules")).not.toContain(
      "Direct fast-forward pushes to main are allowed by policy."
    );
    expect(read(root, ".codex/agents/ci-debugger.toml")).toContain(
      'sandbox_mode = "workspace-write"'
    );
    expect(read(root, ".codex/hooks/context-pre-tool-use.mjs")).toBe(
      "process.stdout.write('pre');\n"
    );
    expect(read(root, ".codex/hooks/general-guard.mjs")).toBe("process.stdout.write('native');\n");
    expect(read(root, "agent-bundle/codex/hooks.npm.json")).toContain("general-guard.mjs");
    expect(read(root, "agent-bundle/codex/hooks.npm.json")).toContain(
      "npm exec -- supaschema hook generated-migration-edit --runtime codex"
    );
    expect(read(root, "agent-bundle/codex/hooks.npm.json")).toContain(
      "npm exec -- supaschema hook schema-write"
    );
    expect(read(root, "agent-bundle/claude/settings.bun.json")).toContain(
      '"command": "./node_modules/.bin/supaschema"'
    );
    expect(read(root, "agent-bundle/codex/hooks.bun.json")).toContain(
      "./node_modules/.bin/supaschema hook generated-migration-edit --runtime codex"
    );
    expect(read(root, "agent-bundle/codex/hooks.bun.json")).not.toContain(
      "bunx --no-install supaschema"
    );
    expect(read(root, "agent-bundle/codex/hooks.npm.json")).not.toContain("bin/supaschema.cjs");
    expect(read(root, "agent-bundle/codex/hooks.npm.json")).not.toContain(
      "supaschema-source-hook.mjs"
    );
    expect(read(root, "agent-bundle/codex/hooks.npm.json")).not.toContain("context-");
    expect(read(root, "agent-bundle/codex/hooks.npm.json")).not.toContain("scripts/agent-hooks");
    expect(read(root, ".codex/hooks.json")).toContain("context-session-start.mjs");
    expect(read(root, ".codex/hooks.json")).toContain("context-pre-tool-use.mjs");
    expect(read(root, ".codex/hooks.json")).not.toContain("general-guard.mjs");
    expect(read(root, ".codex/hooks.json")).toContain("context-stop.mjs");
    expect(read(root, ".agents/skills/elegant/SKILL.md")).toBe("# elegant\n");
    expect(read(root, "skills/supaschema/SKILL.md")).toBe("# supaschema\n");
    expect(existsSync(join(root, "skills/elegant/SKILL.md"))).toBe(false);
    expect(existsSync(join(root, ".codex/rules/stale.rules"))).toBe(false);
    expect(checkAgentSurfaces({ root })).toEqual([]);
  });

  it("allows public clean checkouts without private Claude agents", () => {
    const root = tempSurface({
      ".agents/prompts/supaschema-install.md": "# Install\n",
      ".claude/hooks/guards/bash-policy-checks.mjs": "export {};\n",
      ".claude/hooks/supaschema-source-hook.mjs": "export {};\n",
      ".claude/hooks/sync-llm-on-claude-surface-change.mjs": "process.stdout.write('{}');\n",
      ".claude/rules/supaschema.md": "# Supaschema rule\n",
      ".claude/skills/supaschema/SKILL.md": "# supaschema\n",
      ".codex/hooks/general-guard.mjs": "process.stdout.write('native');\n",
      ".codex/hooks.json": `${JSON.stringify({ hooks: {} })}\n`,
      "agent-bundle/INSTALL.md": "# Agent bundle install\n",
      ".codex/agents/stale.toml": 'name = "stale"\n',
    });

    const result = syncAgentSurfaces({ root });

    expect(result.agents).toBe(0);
    expect(existsSync(join(root, ".codex/agents/stale.toml"))).toBe(false);
    expect(checkAgentSurfaces({ root })).toEqual([]);
  });

  it("blocks Codex hook rendering when present Claude hook registration is incomplete", () => {
    const root = tempSurface({
      ...claudeHookSourceFiles(),
      ".claude/settings.json": `${JSON.stringify({ hooks: { Stop: [] } })}\n`,
    });

    expect(() => renderSourceCodexHooks(root)).toThrow(
      ".claude/settings.json missing SessionStart hooks"
    );
  });

  it("blocks Codex hook rendering when source Claude registers duplicate Bash safety", () => {
    const settings = claudeHookSettings();
    settings.hooks.PreToolUse = [
      ...settings.hooks.PreToolUse,
      {
        matcher: "Bash",
        hooks: [claudeNodeHook(".claude/hooks/guards/bash-policy-checks.mjs")],
      },
    ];
    const root = tempSurface({
      ...claudeHookSourceFiles(),
      ".claude/settings.json": `${JSON.stringify(settings)}\n`,
    });

    expect(() => renderSourceCodexHooks(root)).toThrow(
      ".claude/settings.json must not register a direct source Claude Bash guard"
    );
  });

  it("blocks Codex hook rendering when Claude does not import the repo contract", () => {
    const root = tempSurface(claudeHookSourceFiles({ "CLAUDE.md": "# Claude\n" }));

    expect(() => renderSourceCodexHooks(root)).toThrow(
      "CLAUDE.md must import @AGENTS.md so Claude receives the repo contract"
    );
  });

  it("blocks Codex hook rendering when Claude response-shape enforcement drifts", () => {
    const root = tempSurface(
      claudeHookSourceFiles({
        "scripts/agent-hooks/response-shape.mjs": "mechanismClaimWithoutArchitecture\n",
      })
    );

    expect(() => renderSourceCodexHooks(root)).toThrow(
      "scripts/agent-hooks/response-shape.mjs must contain mechanism-claim-without-architecture"
    );
  });

  it("blocks Codex hook rendering when source-read evidence boundaries drift", () => {
    const root = tempSurface(
      claudeHookSourceFiles({
        "scripts/agent-hooks/command-evidence.mjs": "no domain guard here\n",
      })
    );

    expect(() => renderSourceCodexHooks(root)).toThrow(
      "scripts/agent-hooks/command-evidence.mjs must contain domains.length === 0"
    );
  });

  it("blocks Codex hook rendering when arbitrary output exit parsing returns", () => {
    const root = tempSurface(
      claudeHookSourceFiles({
        "scripts/agent-hooks/command-evidence.mjs": "domains.length === 0\ntextMentionsExit\n",
      })
    );

    expect(() => renderSourceCodexHooks(root)).toThrow(
      "scripts/agent-hooks/command-evidence.mjs must not contain textMentionsExit"
    );
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

  it("syncs for Codex apply_patch tool names that edit Claude surfaces", () => {
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
        scripts: {
          "sync:llm":
            "node -e \"const fs=require('node:fs');fs.appendFileSync('sync-count.txt','1')\"",
        },
      })}\n`,
    });
    const payload = {
      cwd: project,
      hook_event_name: "Stop",
      tool_input: {
        patch: [
          "*** Begin Patch",
          "*** Update File: .claude/rules/supaschema.md",
          "@@",
          "-# Rule",
          "+# Rule changed",
          "*** End Patch",
          "",
        ].join("\n"),
      },
      tool_name: "functions.apply_patch",
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
    expect(read(project, "sync-count.txt")).toBe("1");
  });

  it("syncs Codex trigger file drift from Stop payloads without edit targets", () => {
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
      ".codex/hooks.json": "{}\n",
      "package.json": `${JSON.stringify({
        name: "supaschema",
        scripts: {
          "sync:llm":
            "node -e \"const fs=require('node:fs');fs.appendFileSync('sync-count.txt','1')\"",
        },
      })}\n`,
    });
    const payload = {
      cwd: project,
      hook_event_name: "Stop",
      session_id: "codex-sync-digest",
    };
    const env = { ...process.env, CODEX_PROJECT_DIR: project };
    execFileSync(
      process.execPath,
      [join(root, ".claude/hooks/sync-llm-on-claude-surface-change.mjs")],
      {
        encoding: "utf8",
        env,
        input: JSON.stringify(payload),
      }
    );
    writeFileSync(join(project, ".codex/hooks.json"), '{"hooks":{"Stop":[]}}\n');

    const output = execFileSync(
      process.execPath,
      [join(root, ".claude/hooks/sync-llm-on-claude-surface-change.mjs")],
      {
        encoding: "utf8",
        env,
        input: JSON.stringify(payload),
      }
    );

    expect(output).toBe("{}\n");
    expect(read(project, "sync-count.txt")).toBe("1");
  });
});
