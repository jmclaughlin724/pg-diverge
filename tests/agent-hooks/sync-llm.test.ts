import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { bundleDocsFiles } from "../../scripts/skills/bundle-docs.mjs";
import {
  checkAgentSurfaces,
  publicSkillNames,
  renderSourceCodexHooks,
  syncAgentSurfaces,
} from "../../scripts/skills/sync-llm.mjs";

const root = resolve(import.meta.dirname, "../..");
const claudeProjectDir = ["$", "{", "CLAUDE_PROJECT_DIR", "}"].join("");
const codexProjectDir = ["$(", "git rev-parse --show-toplevel", ")"].join("");
const editToolMatcher = "apply_patch";
const syncHookSource = readFileSync(
  join(root, ".claude/hooks/sync-llm-on-claude-surface-change.mjs"),
  "utf8"
);
const curatedSkillSources = {
  ".claude/skills/supaschema-maintain/references/commands.md": "maintain commands\n",
  ".claude/skills/supaschema-maintain/SKILL.md": "maintain skill\n",
  ".claude/skills/supaschema-migrate/references/commands.md": "migrate commands\n",
  ".claude/skills/supaschema-migrate/SKILL.md": "migrate skill\n",
};

function tempSurface(files: Record<string, string | Uint8Array>): string {
  const root = mkdtempSync(join(tmpdir(), "supa-sync-llm-"));
  const sourceFiles = {
    ...curatedSkillSources,
    ...(Object.keys(files).some((file) => file.startsWith("docs/"))
      ? {}
      : { "docs/getting-started.mdx": "# Getting started\n" }),
    ...files,
  };
  for (const [file, source] of Object.entries(sourceFiles)) {
    mkdirSync(join(root, dirname(file)), { recursive: true });
    writeFileSync(join(root, file), source);
  }
  return root;
}

function read(root: string, file: string): string {
  return readFileSync(join(root, file), "utf8");
}

function withoutCodexProjectDir(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(([name]) => name !== "CODEX_PROJECT_DIR")
  );
}

function claudeHookSourceFiles(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    ".claude/rules/12-skill-loading-enforcement.md": [
      "Source and inventory reads MUST NOT become verification evidence",
      "process.exitCode = 2",
      "",
    ].join("\n"),
    ".claude/settings.json": `${JSON.stringify(claudeHookSettings())}\n`,
    "AGENTS.md": "# Agents\n",
    "CLAUDE.md": "@AGENTS.md\n",
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
      PostToolUse: [
        {
          hooks: [claudeNodeHook(".claude/hooks/context-post-tool-use.mjs")],
        },
        {
          hooks: [claudeSupaschemaHook("schema-write")],
        },
        {
          hooks: [claudeNodeHook(".claude/hooks/sync-llm-on-claude-surface-change.mjs")],
        },
      ],
      PostToolUseFailure: [
        {
          hooks: [claudeNodeHook(".claude/hooks/context-post-tool-use-failure.mjs")],
        },
        {
          hooks: [claudeNodeHook(".claude/hooks/sync-llm-on-claude-surface-change.mjs")],
        },
      ],
      PreToolUse: [
        {
          hooks: [claudeNodeHook(".claude/hooks/context-pre-tool-use.mjs")],
          matcher: ".*",
        },
        {
          hooks: [claudeSupaschemaHook("generated-migration-edit")],
          matcher: "Write|Edit|MultiEdit|apply_patch",
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
      SubagentStart: [
        {
          hooks: [claudeNodeHook(".claude/hooks/context-subagent-start.mjs")],
        },
      ],
      WorktreeCreate: [
        {
          hooks: [claudeNodeHook(".claude/hooks/context-worktree-create.mjs")],
        },
      ],
      Stop: [
        {
          hooks: [claudeNodeHook(".claude/hooks/context-stop.mjs")],
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
    statusMessage: `Running ${relativePath}`,
    type: "command",
  };
}

function claudeSupaschemaHook(command: string) {
  return {
    args: [`${claudeProjectDir}/.claude/hooks/supaschema-source-hook.mjs`, "hook", command],
    command: "node",
    statusMessage: `Running supaschema hook ${command}`,
    type: "command",
  };
}

describe("sync:llm", () => {
  it("builds a sorted byte-exact MDX bundle and excludes non-MDX sources", () => {
    const nestedBytes = Buffer.from([0x23, 0x20, 0x41, 0x0d, 0x0a, 0x00, 0xff]);
    const root = tempSurface({
      "docs/a/first.mdx": nestedBytes,
      "docs/docs.json": "{}\n",
      "docs/image.svg": "<svg />\n",
      "docs/z-last.mdx": "# Z\n",
    });

    const files = bundleDocsFiles(root);

    expect(files.get("docs/a/first.mdx")).toEqual(nestedBytes);
    expect(files.get("docs/z-last.mdx")).toEqual(Buffer.from("# Z\n"));
    expect(files.has("docs/docs.json")).toBe(false);
    expect(files.has("docs/image.svg")).toBe(false);
    expect(files.get("docs/index.md")?.toString("utf8")).toBe(
      [
        "# Supaschema Documentation",
        "",
        "- [agent-bundle/docs/a/first.mdx](https://supaschema.com/docs/a/first)",
        "- [agent-bundle/docs/z-last.mdx](https://supaschema.com/docs/z-last)",
        "",
      ].join("\n")
    );
  });

  it("mirrors private Claude surfaces locally and keeps public skills narrow", {
    timeout: 15_000,
  }, () => {
    const root = tempSurface({
      ".agents/prompts/supaschema-install.md": "# Install\n",
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
      ".claude/hooks/context-worktree-create.mjs": "process.stderr.write('blocked');\n",
      ".claude/hooks/guards/bash-policy-checks.mjs": "export {};\n",
      ".claude/hooks/supaschema-source-hook.mjs": "export {};\n",
      ".claude/hooks/sync-llm-on-claude-surface-change.mjs": "process.stdout.write('{}');\n",
      ".claude/rules/21-source-control.md": [
        "---",
        "description: Source control process.",
        "---",
        "",
        "# Rule 21",
        "",
        "Protected pull requests are required for main.",
        "",
      ].join("\n"),
      ".claude/rules/supaschema.md": "# Supaschema rule\n",
      ".claude/skills/elegant/SKILL.md": "# elegant\n",
      ".claude/skills/supaschema/SKILL.md": "# supaschema\n",
      ".codex/agents/stale.toml": 'name = "stale"\n',
      ".codex/hooks.json": `${JSON.stringify({
        hooks: {
          PostToolUse: [
            {
              hooks: [
                {
                  command: `node "${codexProjectDir}/.codex/hooks/context-post-tool-use.mjs"`,
                  type: "command",
                },
              ],
              matcher: "Bash",
            },
            {
              hooks: [
                {
                  command: `node "${codexProjectDir}/.codex/hooks/supaschema-source-hook.mjs" hook schema-write`,
                  type: "command",
                },
              ],
              matcher: editToolMatcher,
            },
            {
              hooks: [
                {
                  command: `node "${codexProjectDir}/.codex/hooks/sync-llm-on-claude-surface-change.mjs"`,
                  type: "command",
                },
              ],
              matcher: editToolMatcher,
            },
          ],
          PreToolUse: [
            {
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
              matcher: "Bash",
            },
            {
              hooks: [
                {
                  command: `node "${codexProjectDir}/.codex/hooks/supaschema-source-hook.mjs" hook generated-migration-edit --runtime codex`,
                  type: "command",
                },
              ],
              matcher: editToolMatcher,
            },
          ],
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
        },
      })}\n`,
      ".codex/hooks/general-guard.mjs": "process.stdout.write('native');\n",
      ".codex/hooks/stale.mjs": "process.stdout.write('stale');\n",
      ".codex/rules/stale.rules": "# stale\n",
      "agent-bundle/INSTALL.md": "# Agent bundle install\n",
      "agent-bundle/claude/hooks/sync-llm-on-claude-surface-change.mjs": "stale\n",
      "agent-bundle/codex/hooks/sync-llm-on-claude-surface-change.mjs": "stale\n",
      "skills/README.md": "# Public skills\n",
      "skills/stale/SKILL.md": "# stale\n",
    });

    const result = syncAgentSurfaces({ root });

    expect(result).toMatchObject({
      agentBundle: 25,
      agents: 1,
      codexHookConfig: 1,
      hooks: 5,
      publicSkills: 5,
      rules: 2,
      skills: 6,
      skillTargets: 1,
    });
    expect(read(root, ".codex/rules/21-source-control.rules")).toContain(
      "Canonical rule owner: .claude/rules/21-source-control.md"
    );
    expect(read(root, ".codex/rules/21-source-control.rules")).not.toContain(
      "Protected pull requests are required for main."
    );
    expect(read(root, ".codex/agents/ci-debugger.toml")).toContain(
      'sandbox_mode = "workspace-write"'
    );
    expect(read(root, ".codex/hooks/context-pre-tool-use.mjs")).toBe(
      "process.stdout.write('pre');\n"
    );
    expect(read(root, ".codex/hooks/context-worktree-create.mjs")).toBe(
      "process.stderr.write('blocked');\n"
    );
    expect(existsSync(join(root, ".codex/hooks/general-guard.mjs"))).toBe(false);
    expect(read(root, "agent-bundle/codex/hooks.npm.json")).not.toContain("general-guard.mjs");
    expect(read(root, "agent-bundle/codex/hooks.npm.json")).not.toContain("bash-policy-checks.mjs");
    expect(read(root, "agent-bundle/codex/hooks.npm.json")).toContain(
      "npm exec -- supaschema hook generated-migration-edit --runtime codex"
    );
    expect(read(root, "agent-bundle/codex/hooks.npm.json")).toContain(
      "npm exec -- supaschema hook schema-write"
    );
    expect(read(root, "agent-bundle/claude/settings.bun.json")).toContain(
      '"command": "./node_modules/.bin/supaschema hook schema-write"'
    );
    expect(read(root, "agent-bundle/claude/settings.npm.json")).toContain(
      '"statusMessage": "Running supaschema auto-diff on schema change"'
    );
    expect(read(root, "agent-bundle/claude/settings.npm.json")).not.toContain(
      "bash-policy-checks.mjs"
    );
    expect(read(root, "agent-bundle/codex/hooks.bun.json")).toContain(
      "./node_modules/.bin/supaschema hook generated-migration-edit --runtime codex"
    );
    expect(read(root, "agent-bundle/codex/hooks.bun.json")).not.toContain(
      "bunx --no-install supaschema"
    );
    expect(read(root, "agent-bundle/codex/hooks.npm.json")).not.toContain("/bin/");
    expect(read(root, "agent-bundle/codex/hooks.npm.json")).not.toContain(
      "supaschema-source-hook.mjs"
    );
    expect(read(root, "agent-bundle/codex/hooks.npm.json")).not.toContain("context-");
    expect(read(root, "agent-bundle/codex/hooks.npm.json")).not.toContain("scripts/agent-hooks");
    expect(read(root, "agent-bundle/codex/hooks.npm.json")).not.toContain(
      "sync-llm-on-claude-surface-change.mjs"
    );
    expect(read(root, "agent-bundle/claude/settings.npm.json")).not.toContain(
      "sync-llm-on-claude-surface-change.mjs"
    );
    expect(
      existsSync(join(root, "agent-bundle/claude/hooks/sync-llm-on-claude-surface-change.mjs"))
    ).toBe(false);
    expect(existsSync(join(root, "agent-bundle/claude/hooks/guards/bash-policy-checks.mjs"))).toBe(
      false
    );
    expect(
      existsSync(join(root, "agent-bundle/codex/hooks/sync-llm-on-claude-surface-change.mjs"))
    ).toBe(false);
    expect(existsSync(join(root, "agent-bundle/codex/hooks/general-guard.mjs"))).toBe(false);
    expect(existsSync(join(root, "agent-bundle/codex/hooks/guards/bash-policy-checks.mjs"))).toBe(
      false
    );
    expect(read(root, ".codex/hooks.json")).toContain("context-session-start.mjs");
    expect(read(root, ".codex/hooks.json")).toContain("context-session-end.mjs");
    expect(read(root, ".codex/hooks.json")).toContain("context-pre-tool-use.mjs");
    expect(read(root, ".codex/hooks.json")).not.toContain("WorktreeCreate");
    expect(read(root, ".codex/hooks.json")).not.toContain("general-guard.mjs");
    expect(read(root, ".codex/hooks.json")).toContain("context-stop.mjs");
    expect(read(root, ".codex/hooks.json")).toContain("sync-llm-on-claude-surface-change.mjs");
    expect(read(root, ".codex/hooks.json")).toContain("$(git rev-parse --show-toplevel)");
    expect(read(root, ".codex/hooks.json")).toContain('"commandWindows"');
    expect(read(root, ".codex/hooks.json")).toContain(
      `for /f \\"delims=\\" %S in ('git rev-parse --show-toplevel') do @node`
    );
    expect(read(root, ".codex/hooks.json")).not.toContain("CODEX_PROJECT_DIR");
    expect(read(root, ".agents/skills/elegant/SKILL.md")).toBe("# elegant\n");
    expect(read(root, "skills/supaschema/SKILL.md")).toBe("# supaschema\n");
    expect(read(root, "skills/supaschema-migrate/references/commands.md")).toBe(
      "migrate commands\n"
    );
    expect(read(root, "agent-bundle/claude/skills/supaschema-maintain/SKILL.md")).toBe(
      "maintain skill\n"
    );
    expect(JSON.parse(read(root, "agent-bundle/skills-manifest.json"))).toEqual({
      skills: publicSkillNames,
    });
    expect(read(root, "skills/README.md")).toBe("# Public skills\n");
    expect(existsSync(join(root, "skills/elegant/SKILL.md"))).toBe(false);
    expect(existsSync(join(root, ".codex/skills"))).toBe(false);
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
      ".codex/agents/stale.toml": 'name = "stale"\n',
      ".codex/hooks.json": `${JSON.stringify({ hooks: {} })}\n`,
      ".codex/hooks/general-guard.mjs": "process.stdout.write('native');\n",
      "agent-bundle/INSTALL.md": "# Agent bundle install\n",
    });

    const result = syncAgentSurfaces({ root });

    expect(result.agents).toBe(0);
    expect(existsSync(join(root, ".codex/agents/stale.toml"))).toBe(false);
    expect(existsSync(join(root, ".codex/hooks/general-guard.mjs"))).toBe(false);
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
        hooks: [claudeNodeHook(".claude/hooks/guards/bash-policy-checks.mjs")],
        matcher: "Bash",
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
      ".claude/hooks/sync-llm-on-claude-surface-change.mjs": syncHookSource,
      ".claude/rules/supaschema.md": "# Rule\n",
      ".claude/skills/supaschema/SKILL.md": "# Skill\n",
      ".codex/hooks/sync-llm-on-claude-surface-change.mjs": syncHookSource,
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
      [join(project, ".codex/hooks/sync-llm-on-claude-surface-change.mjs")],
      {
        encoding: "utf8",
        env: withoutCodexProjectDir(),
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
      ".claude/hooks/sync-llm-on-claude-surface-change.mjs": syncHookSource,
      ".claude/rules/supaschema.md": "# Rule\n",
      ".claude/skills/supaschema/SKILL.md": "# Skill\n",
      ".codex/hooks/sync-llm-on-claude-surface-change.mjs": syncHookSource,
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
      hook_event_name: "PostToolUse",
      tool_input: {
        command: [
          "*** Begin Patch",
          "*** Update File: .claude/rules/supaschema.md",
          "@@",
          "-# Rule",
          "+# Rule changed",
          "*** End Patch",
          "",
        ].join("\n"),
      },
      tool_name: "apply_patch",
    };

    const output = execFileSync(
      process.execPath,
      [join(project, ".codex/hooks/sync-llm-on-claude-surface-change.mjs")],
      {
        encoding: "utf8",
        env: withoutCodexProjectDir(),
        input: JSON.stringify(payload),
      }
    );

    expect(JSON.parse(output)).toMatchObject({
      hookSpecificOutput: {
        additionalContext: "SYNC_LLM_OK",
        hookEventName: "PostToolUse",
      },
    });
    expect(read(project, "sync-count.txt")).toBe("1");
  });

  it("syncs Codex surface drift from Stop and returns valid empty Stop JSON", () => {
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
      ".claude/hooks/sync-llm-on-claude-surface-change.mjs": syncHookSource,
      ".claude/rules/supaschema.md": "# Rule\n",
      ".claude/skills/supaschema/SKILL.md": "# Skill\n",
      ".codex/hooks/sync-llm-on-claude-surface-change.mjs": syncHookSource,
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
      session_id: "codex-sync-stop",
    };
    const env = withoutCodexProjectDir();
    const hook = join(project, ".codex/hooks/sync-llm-on-claude-surface-change.mjs");

    expect(
      execFileSync(process.execPath, [hook], {
        encoding: "utf8",
        env,
        input: JSON.stringify(payload),
      })
    ).toBe("{}\n");

    writeFileSync(join(project, ".claude/rules/supaschema.md"), "# Rule changed\n");

    expect(
      execFileSync(process.execPath, [hook], {
        encoding: "utf8",
        env,
        input: JSON.stringify(payload),
      })
    ).toBe("{}\n");
    expect(read(project, "sync-count.txt")).toBe("1");
  });
});
