import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { evaluateBashPolicy } from "../../.claude/hooks/guards/bash-policy-checks.mjs";
import { classifyCommandDomains } from "../../scripts/agent-hooks/command-evidence.mjs";
import {
  editTargetStrings,
  governedToolTargetStrings,
  parseApplyPatch,
} from "../../scripts/agent-hooks/edit-targets.mjs";
import { shapeHookResult } from "../../scripts/agent-hooks/hook-output.mjs";
import { claimedVerificationDomains } from "../../scripts/agent-hooks/response-claims.mjs";
import { handleAgentHookEvent } from "../../scripts/agent-hooks/runner.mjs";
import { handleSessionLifecycleEvent } from "../../scripts/agent-hooks/session-lifecycle.mjs";
import { parseShellCommand } from "../../scripts/agent-hooks/shell-command.mjs";
import {
  currentTurnState,
  normalizeState,
  readSessionState,
  sessionStatePath,
  writeSessionState,
} from "../../scripts/agent-hooks/state.mjs";

const repositoryRoot = process.cwd();
const originalStateDir = process.env.STATE_DIR;

afterEach(() => {
  if (originalStateDir === undefined) {
    delete process.env.STATE_DIR;
  } else {
    process.env.STATE_DIR = originalStateDir;
  }
});

describe("parser-backed command and edit analysis", () => {
  it("uses a shell AST for quoting, pipelines, substitutions, and glob expansion", () => {
    const analysis = parseShellCommand(
      "TOKEN='literal value' psql -c 'select 1' | tee output.txt; rm -rf $TARGET"
    );

    expect(analysis.errors).toEqual([]);
    expect(analysis.invocations.map((invocation) => invocation.executable)).toEqual([
      "psql",
      "tee",
      "rm",
    ]);
    expect(analysis.invocations.find((invocation) => invocation.executable === "psql")?.piped).toBe(
      true
    );
    expect(
      analysis.invocations.find((invocation) => invocation.executable === "rm")?.arguments.at(-1)
        ?.parts[0]?.type
    ).toBe("SimpleExpansion");
  });

  it("parses only the documented apply_patch envelope and structured tool fields", () => {
    const source = [
      "*** Begin Patch",
      "*** Update File: .claude/rules/12-skill-loading-enforcement.md",
      "*** Move to: .claude/rules/12-skill-loading.md",
      "@@",
      "-old",
      "+new",
      "*** Add File: scripts/new.mjs",
      "+export {};",
      "*** End Patch",
    ].join("\n");

    expect(parseApplyPatch(source)).toEqual([
      {
        kind: "update",
        moveTo: ".claude/rules/12-skill-loading.md",
        path: ".claude/rules/12-skill-loading-enforcement.md",
      },
      { kind: "add", path: "scripts/new.mjs" },
    ]);
    expect(
      editTargetStrings({ tool_input: { command: source }, tool_name: "apply_patch" })
    ).toEqual([
      ".claude/rules/12-skill-loading-enforcement.md",
      ".claude/rules/12-skill-loading.md",
      "scripts/new.mjs",
    ]);
    expect(parseApplyPatch("*** Update File: .claude/rules/12.md")).toEqual([]);
    expect(
      governedToolTargetStrings({
        tool_input: { path: "services/agent-mcp" },
        tool_name: "Grep",
      })
    ).toEqual(["services/agent-mcp"]);
  });

  it("classifies verification domains from parsed commands and package scripts", () => {
    expect(classifyCommandDomains("npm run check", { root: repositoryRoot })).toEqual([
      "build",
      "lint",
      "test",
      "typecheck",
    ]);
    expect(classifyCommandDomains("npm run guard:agent", { root: repositoryRoot })).toEqual([
      "guard",
      "sync",
    ]);
    expect(classifyCommandDomains("npx vitest run && gh pr checks 42")).toEqual([
      "github-checks",
      "test",
    ]);
    expect(classifyCommandDomains("printf 'npm test' && unknown-command")).toEqual([]);
    expect(classifyCommandDomains("npm run does-not-exist")).toEqual([]);
  });
});

describe("narrow Bash enforcement", () => {
  const evaluate = (command: string, options: { env?: NodeJS.ProcessEnv; root?: string } = {}) =>
    evaluateBashPolicy(
      {
        cwd: options.root ?? repositoryRoot,
        tool_input: { command, cwd: options.root ?? repositoryRoot },
        tool_name: "Bash",
      },
      options.env ?? process.env,
      { root: options.root ?? repositoryRoot }
    );

  it.each([
    "git switch -c feature/parser-hooks",
    "git reset --hard HEAD",
    "git push --force origin main",
    "git merge --squash feature/parser-hooks",
    "git worktree add ../parser-hooks HEAD",
  ])("does not hook-block Git or worktree command: %s", (command) => {
    expect(evaluate(command)).toEqual({ action: "allow" });
  });

  it("blocks literal secrets and direct known-secret-file display", () => {
    expect(evaluate("API_TOKEN='abcdefghijklmnop' curl https://example.com").action).toBe("block");
    expect(evaluate("curl --api-key abcdefghijklmnop https://example.com").action).toBe("block");
    expect(evaluate("curl postgresql://user:abcdefghijklmnop@localhost/database").action).toBe(
      "block"
    );
    expect(evaluate("cat .env").action).toBe("block");
    expect(evaluate("cat config/.pgpass").action).toBe("block");
    expect(evaluate("cat .env.example")).toEqual({ action: "allow" });
    expect(evaluate("cat .env.template")).toEqual({ action: "allow" });
  });

  it("blocks parser-confirmed literal PostgreSQL DDL arguments only", () => {
    expect(evaluate("psql -c 'CREATE TABLE app.accounts (id bigint)'").action).toBe("block");
    expect(evaluate("psql --command='ALTER TABLE app.accounts ADD COLUMN name text'").action).toBe(
      "block"
    );
    expect(evaluate("supabase db execute --sql 'DROP TABLE app.accounts'").action).toBe("block");
    expect(evaluate("psql -c 'SELECT 1'")).toEqual({ action: "allow" });
    expect(evaluate("psql -f migration.sql")).toEqual({ action: "allow" });
    expect(evaluate("psql -c $SQL")).toEqual({ action: "allow" });
    expect(evaluate("psql <<'SQL'\nCREATE TABLE app.t(id int);\nSQL")).toEqual({ action: "allow" });
  });

  it("blocks only high-confidence dangerous recursive forced deletion", async () => {
    const root = await mkdtemp(join(tmpdir(), "supa-bash-delete-root-"));
    const env = { ...process.env, HOME: dirname(root) };

    expect(evaluate("rm -rf /", { env, root }).action).toBe("block");
    expect(evaluate(`rm -rf ${root}`, { env, root }).action).toBe("block");
    expect(evaluate("rm -rf ..", { env, root }).action).toBe("block");
    expect(evaluate("rm -rf $TARGET", { env, root }).action).toBe("block");
    expect(evaluate("rm -rf build/*", { env, root }).action).toBe("block");
    expect(evaluate('rm -rf / "unterminated', { env, root })).toEqual({ action: "allow" });
    expect(evaluate("rm -rf .tmp/cache", { env, root })).toEqual({ action: "allow" });
    expect(evaluate("rm -r /", { env, root })).toEqual({ action: "allow" });
    expect(evaluate("rm -f /", { env, root })).toEqual({ action: "allow" });
    expect(evaluate("rm -rf 'unterminated", { env, root })).toEqual({ action: "allow" });
  });
});

describe("skill routing context", () => {
  it("blocks governed main-session tools until a complete observed skill load", async () => {
    const fixture = await hookFixture();
    process.env.STATE_DIR = fixture.stateDir;
    const session = { prompt: "Use $fastmcp for this change", session_id: "skill-main" };

    handleAgentHookEvent("UserPromptSubmit", session, fixture.options);
    expect(currentTurnState(readSessionState(session)).pendingSkills).toHaveProperty("fastmcp");

    const ordinaryEdit = preTool("skill-main", "Edit", { file_path: "src/cli.ts" }, fixture);
    expect(ordinaryEdit.output.hookSpecificOutput).toMatchObject({
      permissionDecision: "deny",
      permissionDecisionReason: expect.stringContaining("fastmcp"),
    });

    const loadRead = preTool("skill-main", "Read", { file_path: fixture.fastmcpSkill }, fixture);
    expect(loadRead.output.hookSpecificOutput?.permissionDecision).toBeUndefined();
    postTool("skill-main", "Read", { file_path: fixture.fastmcpSkill }, fixture, {
      content: fixture.skillSource,
    });

    expect(currentTurnState(readSessionState(session)).pendingSkills).not.toHaveProperty("fastmcp");
    expect(preTool("skill-main", "Edit", { file_path: "src/cli.ts" }, fixture).output).toEqual({});

    const shellSession = { prompt: "$fastmcp", session_id: "skill-shell" };
    handleAgentHookEvent("UserPromptSubmit", shellSession, fixture.options);
    const command = `cat '${fixture.fastmcpSkill}'`;
    expect(preTool("skill-shell", "Bash", { command }, fixture).output).toEqual({});
    postTool("skill-shell", "Bash", { command }, fixture, { stdout: fixture.skillSource });
    expect(currentTurnState(readSessionState(shellSession)).pendingSkills).not.toHaveProperty(
      "fastmcp"
    );
  });

  it("matches curated keywords and file triggers from parsed skill frontmatter", async () => {
    const fixture = await hookFixture();
    process.env.STATE_DIR = fixture.stateDir;

    handleAgentHookEvent(
      "UserPromptSubmit",
      { prompt: "Please inspect the fast mcp service", session_id: "keyword" },
      fixture.options
    );
    expect(
      currentTurnState(readSessionState({ session_id: "keyword" })).pendingSkills
    ).toHaveProperty("fastmcp");

    const fileTriggered = preTool(
      "file-trigger",
      "Edit",
      { file_path: "services/agent-mcp/server.py" },
      fixture
    );
    expect(fileTriggered.output.hookSpecificOutput?.permissionDecision).toBe("deny");
    expect(fileTriggered.output.hookSpecificOutput?.additionalContext).toContain(
      'target "services/agent-mcp/server.py" matches configured file trigger "services/agent-mcp/**"'
    );
    expect(fileTriggered.output.hookSpecificOutput?.additionalContext).toContain(
      "Maintain the local FastMCP server."
    );
    expect(fileTriggered.output.hookSpecificOutput?.additionalContext).toContain(
      ".claude/skills/fastmcp/SKILL.md"
    );
    expect(
      currentTurnState(readSessionState({ session_id: "file-trigger" })).pendingSkills.fastmcp
        ?.trigger
    ).toBe("file-trigger");
  });

  it("rejects partial, wildcard, search-only, unknown, and failed load evidence", async () => {
    const fixture = await hookFixture();
    process.env.STATE_DIR = fixture.stateDir;
    const sessionId = "invalid-loads";
    handleAgentHookEvent(
      "UserPromptSubmit",
      { prompt: "$fastmcp", session_id: sessionId },
      fixture.options
    );

    postTool(sessionId, "Read", { file_path: fixture.fastmcpSkill, limit: 20 }, fixture);
    postTool(sessionId, "Read", { file_path: fixture.fastmcpSkill }, fixture, {
      content: `${fixture.skillSource}truncated`,
    });
    postTool(sessionId, "Bash", { command: "cat .claude/skills/*/SKILL.md" }, fixture);
    postTool(sessionId, "Grep", { path: fixture.fastmcpSkill, pattern: "#" }, fixture);
    postTool(sessionId, "Skill", { skill: "not-in-inventory" }, fixture);
    handleAgentHookEvent(
      "PostToolUseFailure",
      {
        hook_event_name: "PostToolUseFailure",
        session_id: sessionId,
        tool_input: { command: `cat ${fixture.fastmcpSkill}` },
        tool_name: "Bash",
      },
      fixture.options
    );

    expect(
      currentTurnState(readSessionState({ session_id: sessionId })).pendingSkills
    ).toHaveProperty("fastmcp");

    postTool(sessionId, "Skill", { skill: "fastmcp" }, fixture);
    expect(
      currentTurnState(readSessionState({ session_id: sessionId })).pendingSkills
    ).not.toHaveProperty("fastmcp");
  });

  it("carries pending prompt context to subagents without blocking tools", async () => {
    const fixture = await hookFixture();
    process.env.STATE_DIR = fixture.stateDir;
    const sessionId = "subagent-skills";
    handleAgentHookEvent(
      "UserPromptSubmit",
      { prompt: "$fastmcp", session_id: sessionId },
      fixture.options
    );

    const subagentTool = handleAgentHookEvent(
      "PreToolUse",
      {
        agent_id: "worker-1",
        session_id: sessionId,
        tool_input: { file_path: "src/cli.ts" },
        tool_name: "Edit",
      },
      fixture.options
    );
    expect(subagentTool.output.hookSpecificOutput?.permissionDecision).toBeUndefined();
    expect(subagentTool.output.hookSpecificOutput?.additionalContext).toContain("fastmcp");

    const start = handleAgentHookEvent(
      "SubagentStart",
      { agent_id: "worker-1", session_id: sessionId },
      fixture.options
    );
    expect(start.output.hookSpecificOutput?.additionalContext).toContain("fastmcp");
  });

  it("blocks only Claude task completion while required skills remain pending", async () => {
    const fixture = await hookFixture();
    process.env.STATE_DIR = fixture.stateDir;
    const sessionId = "task-completion";
    handleAgentHookEvent(
      "UserPromptSubmit",
      { prompt: "$fastmcp", session_id: sessionId },
      fixture.options
    );

    expect(
      handleAgentHookEvent("TaskCompleted", { session_id: sessionId }, fixture.options).output
    ).toMatchObject({ decision: "block", reason: expect.stringContaining("fastmcp") });

    postTool(sessionId, "Skill", { skill: "fastmcp" }, fixture);
    expect(
      handleAgentHookEvent("TaskCompleted", { session_id: sessionId }, fixture.options).output
    ).toEqual({});
    expect(
      handleAgentHookEvent(
        "TaskCompleted",
        { session_id: sessionId },
        { ...fixture.options, runtime: "codex" }
      ).output
    ).toEqual({});
  });
});

describe("structured verification conflicts", () => {
  it("blocks only a success claim contradicted by the latest matching failure", async () => {
    const fixture = await hookFixture();
    process.env.STATE_DIR = fixture.stateDir;
    const sessionId = "verification-conflict";

    expect(stop(sessionId, "Tests passed.", fixture).output).toEqual({});
    failedCommand(sessionId, "npm test", fixture);
    expect(stop(sessionId, "Tests failed; the error remains.", fixture).output).toEqual({});
    expect(stop(sessionId, "Tests passed.", fixture).output).toMatchObject({
      decision: "block",
      reason: expect.stringContaining("test"),
    });
    successfulCommand(sessionId, "npm test", fixture);
    expect(stop(sessionId, "Tests passed.", fixture).output).toEqual({});
  });

  it("requires structured Codex outcomes before recording verification evidence", async () => {
    const fixture = await hookFixture();
    process.env.STATE_DIR = fixture.stateDir;
    const sessionId = "codex-verification";
    const options: HookFixture["options"] = { ...fixture.options, runtime: "codex" };
    const payload = {
      hook_event_name: "PostToolUse",
      session_id: sessionId,
      tool_input: { command: "npm test" },
      tool_name: "Bash",
    };

    handleAgentHookEvent("PostToolUse", payload, options);
    expect(stop(sessionId, "Tests passed.", fixture).output).toEqual({});

    handleAgentHookEvent("PostToolUse", { ...payload, tool_response: { exit_code: 1 } }, options);
    expect(stop(sessionId, "Tests passed.", fixture).output.decision).toBe("block");

    handleAgentHookEvent("PostToolUse", { ...payload, tool_response: { exit_code: 0 } }, options);
    expect(stop(sessionId, "Tests passed.", fixture).output).toEqual({});
  });

  it("ignores hedging, decision menus, incidents, and raw response text", async () => {
    const fixture = await hookFixture();
    process.env.STATE_DIR = fixture.stateDir;
    const sessionId = "verification-nonclaims";
    failedCommand(sessionId, "npm test", fixture);

    for (const message of [
      "Tests did not pass.",
      "I could rerun tests or inspect the failure; which do you prefer?",
      "Command not found: vitest.",
      "The likely test outcome is uncertain.",
      "Could tests pass after another change?",
      "Will tests pass?",
    ]) {
      expect(stop(sessionId, message, fixture).output, message).toEqual({});
    }

    successfulCommand(sessionId, "npm test", fixture, {
      stdout: "Process exited with code 1; tests failed",
    });
    expect(stop(sessionId, "Tests passed.", fixture).output).toEqual({});
  });

  it("parses explicit verification claim grammar without subjective response scoring", () => {
    expect(claimedVerificationDomains("Tests and typecheck passed; lint failed.")).toEqual([
      "test",
      "typecheck",
    ]);
    expect(claimedVerificationDomains("Tests did not pass.")).toEqual([]);
    expect(claimedVerificationDomains("Here are options for running tests.")).toEqual([]);
    expect(claimedVerificationDomains("Could tests pass after another change?")).toEqual([]);
  });
});

describe("minimal private hook state", () => {
  it("persists no prompt or command text and uses private permissions", async () => {
    const fixture = await hookFixture();
    process.env.STATE_DIR = fixture.stateDir;
    const sessionId = "private-state";
    const promptMarker = "do-not-persist-this-prompt";
    const commandMarker = "do-not-persist-this-command";

    handleAgentHookEvent(
      "UserPromptSubmit",
      { prompt: `$fastmcp ${promptMarker}`, session_id: sessionId },
      fixture.options
    );
    successfulCommand(sessionId, `npm test -- ${commandMarker}`, fixture);

    const file = sessionStatePath({ session_id: sessionId });
    const serialized = await readFile(file, "utf8");
    expect(serialized).not.toContain(promptMarker);
    expect(serialized).not.toContain(commandMarker);
    expect(serialized).not.toContain("lastPrompt");
    expect(serialized).not.toContain("command");
    expect((await stat(fixture.stateDir)).mode % 0o1000).toBe(0o700);
    expect((await stat(file)).mode % 0o1000).toBe(0o600);
  });

  it("does not rewrite state for no-op events", async () => {
    const fixture = await hookFixture();
    process.env.STATE_DIR = fixture.stateDir;
    const payload = { session_id: "no-op-state" };
    writeSessionState(payload, normalizeState({}, payload.session_id));
    const file = sessionStatePath(payload);
    const before = (await stat(file)).mtimeMs;

    handleAgentHookEvent(
      "PreToolUse",
      {
        session_id: payload.session_id,
        tool_input: { file_path: "README.md" },
        tool_name: "Read",
      },
      fixture.options
    );

    expect((await stat(file)).mtimeMs).toBe(before);
  });

  it("expires state after 24 hours and treats malformed state as empty with a warning", async () => {
    const fixture = await hookFixture();
    process.env.STATE_DIR = fixture.stateDir;
    const expired = { session_id: "expired-state" };
    writeSessionState(expired, normalizeState({}, expired.session_id));
    const expiredFile = sessionStatePath(expired);
    const expiredValue = JSON.parse(await readFile(expiredFile, "utf8"));
    expiredValue.updatedAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    await writeFile(expiredFile, `${JSON.stringify(expiredValue)}\n`, { mode: 0o600 });

    expect(readSessionState(expired).sessionId).toBe(expired.session_id);
    expect(existsSync(expiredFile)).toBe(false);

    const malformed = { session_id: "malformed-state" };
    const malformedFile = sessionStatePath(malformed);
    await mkdir(dirname(malformedFile), { recursive: true, mode: 0o700 });
    await writeFile(malformedFile, "{not-json", { mode: 0o600 });
    const result = handleAgentHookEvent(
      "PreToolUse",
      {
        session_id: malformed.session_id,
        tool_input: { file_path: "README.md" },
        tool_name: "Read",
      },
      fixture.options
    );
    expect(result.output.systemMessage).toContain("ignored invalid JSON");
    expect(JSON.parse(await readFile(malformedFile, "utf8"))).toMatchObject({
      sessionId: malformed.session_id,
    });
  });

  it("bounds state to 20 turns and 50 evidence entries", () => {
    const at = new Date().toISOString();
    const turns = Object.fromEntries(
      Array.from({ length: 25 }, (_, turnIndex) => [
        `turn-${turnIndex}`,
        {
          createdAt: at,
          evidence: Array.from({ length: 4 }, (_, evidenceIndex) => ({
            at,
            domain: `test-${turnIndex}-${evidenceIndex}`,
            outcome: "failure",
          })),
          pendingSkills: {},
        },
      ])
    );
    const state = normalizeState(
      {
        createdAt: at,
        currentTurnId: "turn-24",
        loadedSkills: {},
        sessionId: "bounded",
        turnSequence: 25,
        turns,
        updatedAt: at,
      },
      "bounded"
    );

    expect(Object.keys(state.turns)).toHaveLength(20);
    expect(Object.values(state.turns).flatMap((turn) => turn.evidence)).toHaveLength(50);
    expect(state.turns).toHaveProperty("turn-24");
  });

  it("resets and removes lifecycle state without standing context", async () => {
    const fixture = await hookFixture();
    process.env.STATE_DIR = fixture.stateDir;
    const payload = { session_id: "lifecycle" };

    expect(handleSessionLifecycleEvent("SessionStart", payload, fixture.options).stdout).toBe("");
    expect(existsSync(sessionStatePath(payload))).toBe(true);
    const state = readSessionState(payload);
    state.loadedSkills.fastmcp = new Date().toISOString();
    writeSessionState(payload, state);
    expect(
      handleSessionLifecycleEvent("SessionStart", { ...payload, source: "resume" }, fixture.options)
        .stdout
    ).toBe("");
    expect(readSessionState(payload).loadedSkills).toEqual({});
    expect(handleSessionLifecycleEvent("SessionEnd", payload, fixture.options).stdout).toBe("");
    expect(existsSync(sessionStatePath(payload))).toBe(false);
  });
});

describe("hook output contracts", () => {
  it("maps only positive decisions to blocking output", () => {
    expect(shapeHookResult("PreToolUse", { deny: "unsafe" }).output).toMatchObject({
      hookSpecificOutput: { permissionDecision: "deny", permissionDecisionReason: "unsafe" },
    });
    expect(shapeHookResult("Stop", {}, "codex").stdout).toBe("{}\n");
  });
});

interface HookFixture {
  fastmcpSkill: string;
  options: { root: string; runtime: "claude" | "codex" };
  root: string;
  skillSource: string;
  stateDir: string;
}

async function hookFixture(): Promise<HookFixture> {
  const root = await mkdtemp(join(tmpdir(), "supa-agent-hook-root-"));
  const stateDir = await mkdtemp(join(tmpdir(), "supa-agent-hook-state-"));
  const fastmcpSkill = join(root, ".claude", "skills", "fastmcp", "SKILL.md");
  await mkdir(dirname(fastmcpSkill), { recursive: true });
  const skillSource = [
    "---",
    "name: fastmcp",
    "description: Maintain the local FastMCP server.",
    "metadata:",
    "  keywords:",
    '    - "fast mcp"',
    "  file-triggers:",
    '    - "services/agent-mcp/**"',
    "---",
    "",
    "# FastMCP",
    "",
    "Use the parser-backed workflow.",
    "",
  ].join("\n");
  await writeFile(fastmcpSkill, skillSource);
  return { fastmcpSkill, options: { root, runtime: "claude" }, root, skillSource, stateDir };
}

function preTool(
  sessionId: string,
  toolName: string,
  toolInput: Record<string, unknown>,
  fixture: HookFixture
) {
  return handleAgentHookEvent(
    "PreToolUse",
    { session_id: sessionId, tool_input: toolInput, tool_name: toolName },
    fixture.options
  );
}

function postTool(
  sessionId: string,
  toolName: string,
  toolInput: Record<string, unknown>,
  fixture: HookFixture,
  toolResponse: Record<string, unknown> = {}
) {
  return handleAgentHookEvent(
    "PostToolUse",
    {
      hook_event_name: "PostToolUse",
      session_id: sessionId,
      tool_input: toolInput,
      tool_name: toolName,
      tool_response: toolResponse,
    },
    fixture.options
  );
}

function failedCommand(sessionId: string, command: string, fixture: HookFixture) {
  return handleAgentHookEvent(
    "PostToolUseFailure",
    {
      hook_event_name: "PostToolUseFailure",
      session_id: sessionId,
      tool_input: { command },
      tool_name: "Bash",
    },
    fixture.options
  );
}

function successfulCommand(
  sessionId: string,
  command: string,
  fixture: HookFixture,
  toolResponse: Record<string, unknown> = {}
) {
  return postTool(sessionId, "Bash", { command }, fixture, toolResponse);
}

function stop(sessionId: string, message: string, fixture: HookFixture) {
  return handleAgentHookEvent(
    "Stop",
    { last_assistant_message: message, session_id: sessionId },
    fixture.options
  );
}
