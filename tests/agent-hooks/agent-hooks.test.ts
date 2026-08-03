import { type ChildProcessWithoutNullStreams, spawn, spawnSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  stat,
  unlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
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
    expect(matcherFor(settings, "PreToolUse", "generated-artifact-edit")).toBe(
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
    expect(matcherFor(config, "PreToolUse", "generated-artifact-edit")).toBe("apply_patch");
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
      expect(matcherFor(claude, "PreToolUse", "generated-artifact-edit")).toBe(
        "Write|Edit|MultiEdit|apply_patch"
      );
      expect(matcherFor(claude, "PostToolUse", "schema-write")).toBe(
        "Write|Edit|MultiEdit|apply_patch"
      );
      expect(JSON.stringify(claude)).not.toContain("context-");
      expect(JSON.stringify(claude)).not.toContain("sync-llm");

      expect(hookHandlers(codex)).toHaveLength(2);
      expect(Object.keys(codex.hooks).sort()).toEqual(["PostToolUse", "PreToolUse"]);
      expect(matcherFor(codex, "PreToolUse", "generated-artifact-edit")).toBe("apply_patch");
      expect(matcherFor(codex, "PostToolUse", "schema-write")).toBe("apply_patch");
      expect(JSON.stringify(codex)).not.toContain("context-");
      expect(JSON.stringify(codex)).not.toContain("sync-llm");
    }
  });

  it("has no check-only surface sync command", async () => {
    const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    const generator = await readFile(join(root, "scripts/skills/sync-llm.mjs"), "utf8");

    expect(Object.keys(manifest.scripts).filter((name) => name.startsWith("sync:llm"))).toEqual([
      "sync:llm",
    ]);
    expect(manifest.scripts["guard:agent"]).toContain("npm run sync:llm");
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

  it("recovers a killed owner while crediting exact Codex skill content", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "supa-hook-codex-load-"));
    const env = { ...process.env, STATE_DIR: stateDir };
    const sessionId = "entrypoint-codex-load";
    const skillPath = ".agents/skills/supaschema/SKILL.md";

    const prompt = await runHook(
      join(root, ".codex/hooks/context-user-prompt-submit.mjs"),
      {
        hook_event_name: "UserPromptSubmit",
        prompt: "$supaschema",
        session_id: sessionId,
      },
      env
    );
    expect(prompt.code).toBe(0);

    const lockHolder = await startLockHolder(sessionId, env);
    await killProcess(lockHolder);

    const command = `cat ${skillPath}`;
    const recoveryStartedAt = Date.now();
    const load = await runHook(
      join(root, ".codex/hooks/context-pre-tool-use.mjs"),
      {
        hook_event_name: "PreToolUse",
        session_id: sessionId,
        tool_input: { command },
        tool_name: "Bash",
      },
      env
    );
    expect(hookOutput(load.stdout).hookSpecificOutput?.permissionDecision).toBeUndefined();

    const recorded = await runHook(
      join(root, ".codex/hooks/context-post-tool-use.mjs"),
      {
        hook_event_name: "PostToolUse",
        session_id: sessionId,
        tool_input: { command },
        tool_name: "Bash",
        tool_response: await readFile(join(root, skillPath), "utf8"),
      },
      env
    );
    expect(recorded).toMatchObject({ code: 0, stderr: "", stdout: "" });
    expect(Date.now() - recoveryStartedAt).toBeLessThan(2000);

    const governed = await runHook(
      join(root, ".codex/hooks/context-pre-tool-use.mjs"),
      {
        hook_event_name: "PreToolUse",
        session_id: sessionId,
        tool_input: { file_path: "README.md" },
        tool_name: "Read",
      },
      env
    );
    expect(hookOutput(governed.stdout).hookSpecificOutput?.permissionDecision).toBeUndefined();
    expect(
      await pathExists(join(stateDir, `${Buffer.from(sessionId).toString("base64url")}.json.lock`))
    ).toBe(false);
  });

  it("never age-steals a live owner and lets SessionEnd reclaim it after SIGKILL", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "supa-hook-live-lock-"));
    const env = { ...process.env, STATE_DIR: stateDir };
    const sessionId = "entrypoint-live-lock";
    const lockDirectory = join(
      stateDir,
      `${Buffer.from(sessionId).toString("base64url")}.json.lock`
    );
    const lockHolder = await startLockHolder(sessionId, env);
    try {
      const [ownerName] = await readdir(lockDirectory);
      const ownerPath = join(lockDirectory, ownerName);
      const owner = JSON.parse(await readFile(ownerPath, "utf8"));
      const oldDate = new Date(Date.now() - 60_000);
      owner.acquiredAt = oldDate.toISOString();
      await writeFile(ownerPath, `${JSON.stringify(owner)}\n`, { mode: 0o600 });
      await utimes(lockDirectory, oldDate, oldDate);
      await utimes(ownerPath, oldDate, oldDate);

      const startedAt = Date.now();
      const liveEnd = await runHook(
        join(root, ".claude/hooks/context-session-end.mjs"),
        {
          cwd: root,
          hook_event_name: "SessionEnd",
          reason: "clear",
          session_id: sessionId,
          transcript_path: null,
        },
        env
      );
      const elapsedMs = Date.now() - startedAt;

      expect(elapsedMs).toBeGreaterThanOrEqual(450);
      expect(elapsedMs).toBeLessThan(2000);
      expect(hookOutput(liveEnd.stdout).systemMessage).toContain(
        "timed out waiting for session state lock"
      );
      expect(await readdir(lockDirectory)).toEqual([ownerName]);
      expect((await stat(lockDirectory)).mode % 0o1000).toBe(0o700);
      expect((await stat(ownerPath)).mode % 0o1000).toBe(0o600);
      expect(Object.keys(owner).sort()).toEqual(["acquiredAt", "pid", "token"]);
    } finally {
      await killProcess(lockHolder);
    }

    const recoveredEnd = await runHook(
      join(root, ".claude/hooks/context-session-end.mjs"),
      {
        cwd: root,
        hook_event_name: "SessionEnd",
        reason: "clear",
        session_id: sessionId,
        transcript_path: null,
      },
      env
    );
    expect(recoveredEnd).toMatchObject({ code: 0, stderr: "", stdout: "" });
    expect(await pathExists(lockDirectory)).toBe(false);
  });

  it("reclaims lock candidates left by killed waiters through the actual entrypoint", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "supa-hook-killed-waiters-"));
    const env = { ...process.env, STATE_DIR: stateDir };
    const hook = join(root, ".claude/hooks/context-pre-tool-use.mjs");
    const sessionId = "killed-lock-waiters";
    const encodedSessionId = Buffer.from(sessionId).toString("base64url");
    const candidatePrefix = `.${encodedSessionId}.json.lock.`;
    const lockHolder = await startLockHolder(sessionId, env);
    const waiters = Array.from({ length: 4 }, (_, index) =>
      startHookProcess(
        hook,
        {
          hook_event_name: "PreToolUse",
          session_id: sessionId,
          tool_input: { file_path: `README-${index}.md` },
          tool_name: "Read",
        },
        env
      )
    );
    try {
      const candidates = await waitForLockCandidates(stateDir, candidatePrefix, waiters.length);
      expect(candidates).toHaveLength(waiters.length);
      await Promise.all(waiters.map(({ child }) => killProcess(child)));
      const emptyCandidate = join(stateDir, candidates[0]);
      for (const ownerName of await readdir(emptyCandidate)) {
        await unlink(join(emptyCandidate, ownerName));
      }
      expect(await readdir(emptyCandidate)).toEqual([]);
    } finally {
      await Promise.all([...waiters.map(({ child }) => child), lockHolder].map(killProcess));
      await Promise.all(waiters.map(({ result }) => result));
    }

    const recovery = await runHook(
      hook,
      {
        hook_event_name: "PreToolUse",
        session_id: sessionId,
        tool_input: { file_path: "README.md" },
        tool_name: "Read",
      },
      env
    );

    expect(recovery).toMatchObject({ code: 0, stderr: "", stdout: "" });
    expect(
      (await readdir(stateDir)).filter(
        (entry) => entry.startsWith(candidatePrefix) && entry.endsWith(".tmp")
      )
    ).toEqual([]);
  });

  it("serializes concurrent evidence updates through the actual hook entrypoint", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "supa-hook-concurrent-state-"));
    const env = { ...process.env, STATE_DIR: stateDir };
    const hook = join(root, ".claude/hooks/context-post-tool-use.mjs");
    const sessionId = "concurrent-entrypoint";
    const lockHolder = await startLockHolder(sessionId, env);
    await killProcess(lockHolder);
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        runHookAsync(
          hook,
          {
            hook_event_name: "PostToolUse",
            session_id: sessionId,
            tool_input: { command: "npm test" },
            tool_name: "Bash",
            tool_response: { exit_code: 0 },
            turn_id: `turn-${index}`,
          },
          env
        )
      )
    );

    expect(results).toEqual(Array.from({ length: 8 }, () => ({ code: 0, stderr: "", stdout: "" })));
    const state = JSON.parse(
      await readFile(join(stateDir, `${Buffer.from(sessionId).toString("base64url")}.json`), "utf8")
    );
    const turns =
      state && typeof state === "object" && !Array.isArray(state) && state.turns
        ? Object.values(state.turns)
        : [];
    const evidence = turns.flatMap((turn) =>
      turn && typeof turn === "object" && !Array.isArray(turn) && Array.isArray(turn.evidence)
        ? turn.evidence
        : []
    );
    expect(evidence).toHaveLength(8);
    expect(evidence).toEqual(
      expect.arrayContaining(
        Array.from({ length: 8 }, () =>
          expect.objectContaining({ domain: "test", outcome: "success" })
        )
      )
    );
  });

  it("keeps a masked success from resolving an actual Stop failure conflict", async () => {
    const stateDir = await mkdtemp(join(tmpdir(), "supa-hook-outcome-state-"));
    const env = { ...process.env, STATE_DIR: stateDir };
    const sessionId = "entrypoint-outcome";
    const failed = await runHook(
      join(root, ".claude/hooks/context-post-tool-use-failure.mjs"),
      {
        hook_event_name: "PostToolUseFailure",
        session_id: sessionId,
        tool_input: { command: "npm test" },
        tool_name: "Bash",
      },
      env
    );
    expect(failed).toMatchObject({ code: 0, stderr: "", stdout: "" });

    const masked = await runHook(
      join(root, ".claude/hooks/context-post-tool-use.mjs"),
      {
        hook_event_name: "PostToolUse",
        session_id: sessionId,
        tool_input: { command: "npm test || true" },
        tool_name: "Bash",
      },
      env
    );
    expect(masked).toMatchObject({ code: 0, stderr: "", stdout: "" });

    const contradicted = await runHook(
      join(root, ".claude/hooks/context-stop.mjs"),
      {
        hook_event_name: "Stop",
        last_assistant_message: "Tests passed.",
        session_id: sessionId,
        stop_hook_active: false,
      },
      env
    );
    expect(hookOutput(contradicted.stdout)).toMatchObject({
      decision: "block",
      reason: expect.stringContaining("test"),
    });

    const honest = await runHook(
      join(root, ".claude/hooks/context-stop.mjs"),
      {
        hook_event_name: "Stop",
        last_assistant_message: "Tests passed previously, but the current tests failed.",
        session_id: sessionId,
        stop_hook_active: false,
      },
      env
    );
    expect(honest).toMatchObject({ code: 0, stderr: "", stdout: "" });
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
        hook_event_name: "PostToolUse",
        tool_input: { file_path: "docs/image.png" },
        tool_name: "Edit",
      },
      {
        hook_event_name: "PostToolUse",
        tool_input: { file_path: "scripts/skills/AGENTS.md" },
        tool_name: "Edit",
      },
      {
        hook_event_name: "PostToolUse",
        tool_input: { file_path: ".agents/prompts/unrelated.md" },
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

    for (const payload of [
      { tool_input: { command: canonicalPatch() }, tool_name: "apply_patch" },
      { tool_input: { file_path: "docs/guide.mdx" }, tool_name: "Edit" },
      {
        tool_input: { file_path: ".agents/prompts/supaschema-install.md" },
        tool_name: "Edit",
      },
      { tool_input: { file_path: "scripts/skills/bundle-docs.mjs" }, tool_name: "Edit" },
    ]) {
      const canonical = await runHook(
        fixture.hook,
        { cwd: fixture.root, hook_event_name: "PostToolUse", ...payload },
        process.env
      );
      expect(canonical).toMatchObject({ code: 0, stderr: "", stdout: "{}\n" });
    }
    expect(await readFile(fixture.log, "utf8")).toBe("sync\nsync\nsync\nsync\n");
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

function runHookAsync(
  hook: string,
  payload: Record<string, unknown>,
  env: NodeJS.ProcessEnv
): Promise<{ code: number; stderr: string; stdout: string }> {
  return startHookProcess(hook, payload, env).result;
}

function startHookProcess(
  hook: string,
  payload: Record<string, unknown>,
  env: NodeJS.ProcessEnv
): {
  child: ChildProcessWithoutNullStreams;
  result: Promise<{ code: number; stderr: string; stdout: string }>;
} {
  const child = spawn(process.execPath, [hook], {
    cwd: root,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const result = new Promise<{ code: number; stderr: string; stdout: string }>(
    (resolve, reject) => {
      let stderr = "";
      let stdout = "";
      child.stderr.setEncoding("utf8");
      child.stdout.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.on("error", reject);
      child.on("close", (code) => {
        resolve({ code: code ?? 1, stderr, stdout });
      });
    }
  );
  child.stdin.end(JSON.stringify(payload));
  return { child, result };
}

async function startLockHolder(
  sessionId: string,
  env: NodeJS.ProcessEnv
): Promise<ChildProcessWithoutNullStreams> {
  const stateModule = pathToFileURL(join(root, "scripts/agent-hooks/state.mjs")).href;
  const source = [
    `import { withSessionState } from ${JSON.stringify(stateModule)};`,
    `withSessionState({ session_id: ${JSON.stringify(sessionId)} }, (state) => {`,
    '  process.stdout.write("locked\\n");',
    "  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60_000);",
    "  return { state };",
    "});",
  ].join("\n");
  const child = spawn(process.execPath, ["--input-type=module", "--eval", source], {
    cwd: root,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timeout);
        child.off("error", onError);
        child.off("close", onClose);
        child.stdout.off("data", onData);
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };
      const onError = (error: Error) => finish(error);
      const onClose = (code: number | null) =>
        finish(new Error(`lock holder exited before acquiring the lock: ${code}; ${stderr}`));
      const onData = (chunk: string) =>
        finish(
          chunk === "locked\n" ? undefined : new Error(`unexpected lock holder output: ${chunk}`)
        );
      const timeout = setTimeout(
        () => finish(new Error(`timed out waiting for lock holder; ${stderr}`)),
        5000
      );
      child.once("error", onError);
      child.once("close", onClose);
      child.stdout.once("data", onData);
    });
  } catch (error) {
    await killProcess(child);
    throw error;
  }
  return child;
}

async function killProcess(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  const closed = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", () => resolve());
  });
  if (!child.kill("SIGKILL")) {
    throw new Error("failed to kill process");
  }
  await closed;
}

async function waitForLockCandidates(
  directory: string,
  prefix: string,
  expectedCount: number
): Promise<string[]> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const candidates = (await readdir(directory)).filter(
      (entry) => entry.startsWith(prefix) && entry.endsWith(".tmp")
    );
    if (candidates.length === expectedCount) {
      return candidates;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 20);
    });
  }
  throw new Error(`timed out waiting for ${expectedCount} lock candidates`);
}

async function pathExists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
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
