import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const root = process.cwd();
const originalStateDir = process.env.STATE_DIR;
const governedToolMatcher =
  "Agent|Bash|Edit|Glob|Grep|MultiEdit|NotebookEdit|Read|Task|WebFetch|WebSearch|Write|apply_patch";

afterEach(() => {
  if (originalStateDir === undefined) {
    delete process.env.STATE_DIR;
  } else {
    process.env.STATE_DIR = originalStateDir;
  }
});

describe("registered hook topology", () => {
  it("registers only the retained Claude events and exact matchers", async () => {
    const settings = JSON.parse(await readFile(join(root, ".claude/settings.json"), "utf8"));

    expect(Object.keys(settings.hooks).sort()).toEqual(
      [
        "PostToolUse",
        "PostToolUseFailure",
        "PreToolUse",
        "SessionEnd",
        "SessionStart",
        "Stop",
        "SubagentStart",
        "SubagentStop",
        "TaskCompleted",
        "UserPromptSubmit",
      ].sort()
    );
    expect(settings.hooks.WorktreeCreate).toBeUndefined();
    expect(matcherFor(settings, "PreToolUse", "context-pre-tool-use.mjs")).toBe(
      governedToolMatcher
    );
    expect(matcherFor(settings, "PostToolUse", "context-post-tool-use.mjs")).toBe(
      "Bash|Read|Skill"
    );
    expect(matcherFor(settings, "PostToolUseFailure", "context-post-tool-use-failure.mjs")).toBe(
      "Bash"
    );
    expect(matcherFor(settings, "PreToolUse", "generated-migration-edit")).toBe(
      "Write|Edit|MultiEdit|apply_patch"
    );
    expect(matcherFor(settings, "PostToolUse", "hook schema-write")).toBe(
      "Write|Edit|MultiEdit|apply_patch"
    );
    expect(matcherFor(settings, "PostToolUse", "sync-llm-on-claude-surface-change.mjs")).toBe(
      "Write|Edit|MultiEdit|apply_patch"
    );
    expect(JSON.stringify(settings.hooks.TaskCompleted)).toContain("context-task-completed.mjs");
    expect(JSON.stringify(settings.hooks.PostToolUseFailure)).not.toContain("sync-llm");
    expect(JSON.stringify(settings.hooks.Stop)).not.toContain("sync-llm");
  });

  it("keeps Codex context hooks but omits Claude-only failure and completion events", async () => {
    const config = JSON.parse(await readFile(join(root, ".codex/hooks.json"), "utf8"));

    expect(Object.keys(config.hooks).sort()).toEqual(
      [
        "PostToolUse",
        "PreToolUse",
        "SessionEnd",
        "SessionStart",
        "Stop",
        "SubagentStart",
        "SubagentStop",
        "UserPromptSubmit",
      ].sort()
    );
    expect(config.hooks.PostToolUseFailure).toBeUndefined();
    expect(config.hooks.TaskCompleted).toBeUndefined();
    expect(config.hooks.WorktreeCreate).toBeUndefined();
    expect(matcherFor(config, "PreToolUse", "context-pre-tool-use.mjs")).toBe(governedToolMatcher);
    expect(matcherFor(config, "PostToolUse", "context-post-tool-use.mjs")).toBe("Bash|Read|Skill");
    expect(matcherFor(config, "PreToolUse", "generated-migration-edit")).toBe("apply_patch");
    expect(matcherFor(config, "PostToolUse", "hook schema-write")).toBe("apply_patch");
    expect(matcherFor(config, "PostToolUse", "sync-llm-on-claude-surface-change.mjs")).toBe(
      "apply_patch"
    );
    expect(JSON.stringify(config)).not.toContain("CODEX_PROJECT_DIR");
    expect(JSON.stringify(config)).toContain("git rev-parse --show-toplevel");
  });

  it("keeps every consumer template to exactly the two product hooks", async () => {
    for (const packageManager of ["npm", "pnpm", "yarn", "bun"]) {
      const claude = JSON.parse(
        await readFile(join(root, `agent-bundle/claude/settings.${packageManager}.json`), "utf8")
      );
      const codex = JSON.parse(
        await readFile(join(root, `agent-bundle/codex/hooks.${packageManager}.json`), "utf8")
      );

      expect(hookHandlers(claude)).toHaveLength(2);
      expect(Object.keys(claude.hooks).sort()).toEqual(["PostToolUse", "PreToolUse"]);
      expect(matcherFor(claude, "PreToolUse", "generated-migration-edit")).toBe(
        "Write|Edit|MultiEdit|apply_patch"
      );
      expect(matcherFor(claude, "PostToolUse", "schema-write")).toBe(
        "Write|Edit|MultiEdit|apply_patch"
      );
      expect(JSON.stringify(claude)).not.toContain("context-");
      expect(JSON.stringify(claude)).not.toContain("sync-llm");

      expect(hookHandlers(codex)).toHaveLength(2);
      expect(Object.keys(codex.hooks).sort()).toEqual(["PostToolUse", "PreToolUse"]);
      expect(matcherFor(codex, "PreToolUse", "generated-migration-edit")).toBe("apply_patch");
      expect(matcherFor(codex, "PostToolUse", "schema-write")).toBe("apply_patch");
      expect(JSON.stringify(codex)).not.toContain("context-");
      expect(JSON.stringify(codex)).not.toContain("sync-llm");
    }
  });

  it("has no check-only surface sync command", async () => {
    const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    const generator = await readFile(join(root, "scripts/skills/sync-llm.mjs"), "utf8");

    expect(manifest.scripts["sync:llm:check"]).toBeUndefined();
    expect(manifest.scripts["guard:agent"]).toContain("npm run sync:llm");
    expect(generator).not.toContain("SYNC_LLM_CHECK_OK");
    expect(generator).not.toContain('"--check"');
  });
});

describe("actual context hook entrypoints", () => {
  it.each([".claude", ".codex"])(
    "allows Git but blocks positive Bash safety matches through %s",
    async (runtimeRoot) => {
      const stateDir = await mkdtemp(join(tmpdir(), "supa-hook-runtime-state-"));
      const hook = join(root, runtimeRoot, "hooks", "context-pre-tool-use.mjs");
      const env = { ...process.env, STATE_DIR: stateDir };

      const git = await runHook(
        hook,
        {
          hook_event_name: "PreToolUse",
          session_id: `${runtimeRoot}-git`,
          tool_input: { command: "git reset --hard HEAD" },
          tool_name: "Bash",
        },
        env
      );
      expect(git.code).toBe(0);
      expect(hookOutput(git.stdout).hookSpecificOutput?.permissionDecision).toBeUndefined();

      const unsafe = await runHook(
        hook,
        {
          hook_event_name: "PreToolUse",
          session_id: `${runtimeRoot}-secret`,
          tool_input: { command: "cat .env" },
          tool_name: "Bash",
        },
        env
      );
      expect(unsafe.code).toBe(0);
      expect(hookOutput(unsafe.stdout).hookSpecificOutput).toMatchObject({
        permissionDecision: "deny",
        permissionDecisionReason: expect.stringContaining("secret-bearing file"),
      });
    }
  );

  it("makes malformed input visible without denying the event", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "supa-hook-malformed-"));
    const result = await runRawHook(
      join(root, ".claude/hooks/context-pre-tool-use.mjs"),
      "{not-json",
      { ...process.env, STATE_DIR: stateDir }
    );

    expect(result.code).toBe(0);
    const output = hookOutput(result.stdout);
    expect(output.systemMessage).toContain("check crashed; no policy decision was made");
    expect(output.hookSpecificOutput?.permissionDecision).toBeUndefined();
  });

  it("runs silent SessionStart and SessionEnd lifecycle entrypoints", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "supa-hook-lifecycle-"));
    const env = { ...process.env, STATE_DIR: stateDir };
    const common = {
      cwd: root,
      permission_mode: "default",
      session_id: "entrypoint-lifecycle",
      transcript_path: null,
    };

    const start = await runHook(
      join(root, ".claude/hooks/context-session-start.mjs"),
      { ...common, hook_event_name: "SessionStart", source: "startup" },
      env
    );
    expect(start).toMatchObject({ code: 0, stderr: "", stdout: "" });
    expect(
      (await readFile(join(stateDir, "ZW50cnlwb2ludC1saWZlY3ljbGU.json"), "utf8")).toString()
    ).toContain('"sessionId": "entrypoint-lifecycle"');

    const end = await runHook(
      join(root, ".claude/hooks/context-session-end.mjs"),
      { ...common, hook_event_name: "SessionEnd", reason: "clear" },
      env
    );
    expect(end).toMatchObject({ code: 0, stderr: "", stdout: "" });
    await expect(
      readFile(join(stateDir, "ZW50cnlwb2ludC1saWZlY3ljbGU.json"))
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});

describe("target-first stateless surface sync", () => {
  it("runs actual sync only after successful canonical edit events", async () => {
    const fixture = await surfaceSyncFixture();

    for (const payload of [
      {
        hook_event_name: "PostToolUse",
        tool_input: { command: "sed -n '1,20p' .claude/rules/12.md" },
        tool_name: "Bash",
      },
      {
        hook_event_name: "PostToolUse",
        tool_input: { file_path: ".codex/rules/12.rules" },
        tool_name: "Edit",
      },
      {
        hook_event_name: "PostToolUseFailure",
        tool_input: { command: canonicalPatch() },
        tool_name: "apply_patch",
      },
      { hook_event_name: "Stop", last_assistant_message: "done" },
    ]) {
      const result = await runHook(fixture.hook, { cwd: fixture.root, ...payload }, process.env);
      expect(result.code).toBe(0);
      expect(result.stdout).toBe("{}\n");
    }
    await expect(readFile(fixture.log, "utf8")).rejects.toMatchObject({ code: "ENOENT" });

    const canonical = await runHook(
      fixture.hook,
      {
        cwd: fixture.root,
        hook_event_name: "PostToolUse",
        tool_input: { command: canonicalPatch() },
        tool_name: "apply_patch",
      },
      process.env
    );
    expect(canonical).toMatchObject({ code: 0, stderr: "", stdout: "{}\n" });
    expect(await readFile(fixture.log, "utf8")).toBe("sync\n");
    await expect(
      readFile(join(fixture.root, ".tmp", "sync-llm-on-claude-surface-change.json"))
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("returns before reading package configuration for unrelated edits", async () => {
    const fixture = await surfaceSyncFixture({ packageSource: "{not-json" });
    const result = await runHook(
      fixture.hook,
      {
        cwd: fixture.root,
        hook_event_name: "PostToolUse",
        tool_input: { file_path: "src/cli.ts" },
        tool_name: "Edit",
      },
      process.env
    );

    expect(result).toMatchObject({ code: 0, stderr: "", stdout: "{}\n" });
    await expect(readFile(fixture.log, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });
});

function matcherFor(config: any, eventName: string, commandFragment: string): string | undefined {
  for (const entry of config.hooks?.[eventName] ?? []) {
    if (hookHandlers(entry).some((handler) => handlerText(handler).includes(commandFragment))) {
      return entry.matcher;
    }
  }
}

function hookHandlers(value: any): any[] {
  const handlers: any[] = [];
  const visit = (candidate: any) => {
    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        visit(item);
      }
      return;
    }
    if (!(candidate && typeof candidate === "object")) {
      return;
    }
    if (candidate.type === "command" && typeof candidate.command === "string") {
      handlers.push(candidate);
    }
    for (const item of Object.values(candidate)) {
      visit(item);
    }
  };
  visit(value);
  return handlers;
}

function handlerText(handler: any): string {
  return [handler.command, ...(Array.isArray(handler.args) ? handler.args : [])].join(" ");
}

function hookOutput(stdout: string): any {
  return stdout.trim() ? JSON.parse(stdout) : {};
}

function runHook(
  hook: string,
  payload: Record<string, unknown>,
  env: NodeJS.ProcessEnv
): { code: number; stderr: string; stdout: string } {
  return runRawHook(hook, JSON.stringify(payload), env);
}

function runRawHook(
  hook: string,
  input: string,
  env: NodeJS.ProcessEnv
): { code: number; stderr: string; stdout: string } {
  const result = spawnSync(process.execPath, [hook], {
    cwd: root,
    encoding: "utf8",
    env,
    input,
    timeout: 15_000,
  });
  if (result.error) {
    throw result.error;
  }
  return {
    code: result.status ?? 1,
    stderr: result.stderr,
    stdout: result.stdout,
  };
}

interface SurfaceFixture {
  hook: string;
  log: string;
  root: string;
}

async function surfaceSyncFixture(
  options: { packageSource?: string } = {}
): Promise<SurfaceFixture> {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "supa-surface-sync-"));
  const hook = join(fixtureRoot, ".codex", "hooks", "sync-llm-on-claude-surface-change.mjs");
  const log = join(fixtureRoot, "sync.log");
  const files = [
    [join(root, ".claude", "hooks", "sync-llm-on-claude-surface-change.mjs"), hook],
    [
      join(root, "scripts", "agent-hooks", "edit-targets.mjs"),
      join(fixtureRoot, "scripts", "agent-hooks", "edit-targets.mjs"),
    ],
    [
      join(root, "scripts", "skills", "agent-surface-manifest.mjs"),
      join(fixtureRoot, "scripts", "skills", "agent-surface-manifest.mjs"),
    ],
  ];
  for (const [source, target] of files) {
    await mkdir(dirname(target), { recursive: true });
    await copyFile(source, target);
  }
  await mkdir(join(fixtureRoot, ".claude", "rules"), { recursive: true });
  await writeFile(join(fixtureRoot, ".claude", "rules", "12.md"), "# Rule\n");
  await writeFile(
    join(fixtureRoot, "sync-marker.mjs"),
    'import { appendFileSync } from "node:fs";\nappendFileSync("sync.log", "sync\\n");\n'
  );
  await writeFile(
    join(fixtureRoot, "package.json"),
    options.packageSource ??
      `${JSON.stringify({ name: "supaschema", scripts: { "sync:llm": "node sync-marker.mjs" } })}\n`
  );
  return { hook, log, root: fixtureRoot };
}

function canonicalPatch(): string {
  return [
    "*** Begin Patch",
    "*** Update File: .claude/rules/12.md",
    "@@",
    "-# Rule",
    "+# Updated rule",
    "*** End Patch",
  ].join("\n");
}
