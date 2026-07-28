import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateBashPolicy } from "../../.claude/hooks/guards/bash-policy-checks.mjs";
import { evaluateRepositoryBoundary } from "../../scripts/agent-hooks/repository-boundary.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const fixtureParent = resolve(repositoryRoot, ".tmp/repository-boundary-tests");

async function fixtureRoot(prefix: string, gitMetadata: "directory" | "file" = "directory") {
  await mkdir(fixtureParent, { recursive: true });
  const root = await mkdtemp(join(fixtureParent, prefix));
  if (gitMetadata === "directory") {
    await mkdir(join(root, ".git"));
  } else {
    await writeFile(join(root, ".git"), "gitdir: ../linked-worktree\n");
  }
  return root;
}

function bashPayload(command: string, cwd = repositoryRoot) {
  return {
    cwd,
    hook_event_name: "PreToolUse",
    tool_input: { command },
    tool_name: "Bash",
  };
}

function preToolPayload(toolName: string, toolInput: Record<string, unknown>, sessionId: string) {
  return {
    cwd: repositoryRoot,
    hook_event_name: "PreToolUse",
    session_id: sessionId,
    tool_input: toolInput,
    tool_name: toolName,
  };
}

async function runHook(
  script: string,
  payload: unknown,
  stateDir: string,
  stdin = JSON.stringify(payload)
): Promise<{ code: number; stderr: string; stdout: string }> {
  return await new Promise((resolvePromise) => {
    const child = execFile(
      process.execPath,
      [resolve(repositoryRoot, script)],
      {
        cwd: repositoryRoot,
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(([name]) => name !== "CODEX_PROJECT_DIR")
          ),
          STATE_DIR: stateDir,
        },
      },
      (error, stdout, stderr) => {
        const code =
          error && typeof error === "object" && "code" in error && typeof error.code === "number"
            ? error.code
            : 0;
        resolvePromise({ code, stderr, stdout });
      }
    );
    child.stdin?.end(stdin);
  });
}

function denial(stdout: string): string | undefined {
  const output = objectValue(JSON.parse(stdout));
  const hookOutput = objectValue(output.hookSpecificOutput);
  return hookOutput.permissionDecision === "deny" &&
    typeof hookOutput.permissionDecisionReason === "string"
    ? hookOutput.permissionDecisionReason
    : undefined;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}

describe("repository boundary evaluator", () => {
  it("allows contained paths and blocks cwd, tool, patch, and shell paths outside the root", async () => {
    const root = await fixtureRoot("paths-");
    const outside = resolve(root, "..", "outside.txt");

    expect(
      evaluateRepositoryBoundary(
        {
          cwd: root,
          tool_input: { file_path: join(root, "inside.txt") },
          tool_name: "Read",
        },
        { root }
      )
    ).toEqual({ action: "allow" });

    for (const payload of [
      {
        cwd: resolve(root, ".."),
        tool_input: { file_path: join(root, "inside.txt") },
        tool_name: "Read",
      },
      {
        cwd: root,
        tool_input: { file_path: outside },
        tool_name: "Read",
      },
      {
        cwd: root,
        tool_input: {
          command: `*** Begin Patch\n*** Add File: ${outside}\n+outside\n*** End Patch`,
        },
        tool_name: "apply_patch",
      },
      bashPayload(`sed -n '1p' ${outside}`, root),
      bashPayload(`printf outside > ${outside}`, root),
      bashPayload('touch "$TMPDIR/outside"', root),
      bashPayload('printf outside > "$TMPDIR/outside"', root),
      bashPayload(`OUT=${outside} touch "$OUT/file"`, root),
      bashPayload('node -e \'require("fs").writeFileSync("/tmp/outside", "x")\'', root),
      bashPayload('python3 -c \'open("/tmp/outside", "w").write("x")\'', root),
      bashPayload(`git -C${resolve(root, "..")} status --short`, root),
      bashPayload("printf changed > .git/HEAD", root),
      bashPayload("mktemp", root),
      {
        cwd: root,
        tool_input: { file_path: `file://${outside}` },
        tool_name: "Read",
      },
      bashPayload("touch ../outside.txt inside.txt", root),
      bashPayload("touch {../outside.txt,inside.txt}", root),
    ]) {
      expect(evaluateRepositoryBoundary(payload, { root }).action).toBe("block");
    }
  });

  it("blocks symlink escapes and linked-worktree metadata", async () => {
    const root = await fixtureRoot("symlink-");
    const outside = await fixtureRoot("outside-");
    await symlink(outside, join(root, "escape"));

    expect(
      evaluateRepositoryBoundary(
        {
          cwd: root,
          tool_input: { file_path: join(root, "escape", "target.txt") },
          tool_name: "Read",
        },
        { root }
      ).action
    ).toBe("block");

    const linkedRoot = await fixtureRoot("linked-", "file");
    expect(
      evaluateRepositoryBoundary(
        {
          cwd: linkedRoot,
          tool_input: { file_path: join(linkedRoot, "inside.txt") },
          tool_name: "Read",
        },
        { root: linkedRoot }
      ).action
    ).toBe("block");
  });
});

describe("repository boundary path inspection", () => {
  async function boundaryFixture(prefix: string) {
    const root = await realpath(await fixtureRoot(prefix));
    await mkdir(join(root, "src"));
    await writeFile(join(root, "package.json"), "{}");
    await writeFile(join(root, "script.sed"), "s/a/b/\n");
    const outside = await realpath(await mkdtemp(join(fixtureParent, "outside-")));
    await writeFile(join(outside, "secret"), "s3cret\n");
    await symlink(outside, join(root, "escape"));
    return { outside, root };
  }

  function verdict(command: string, root: string) {
    return evaluateRepositoryBoundary(
      { cwd: root, tool_input: { command }, tool_name: "Bash" },
      { root }
    ).action;
  }

  it("does not treat regex or program expressions as read-command paths", async () => {
    const { root } = await boundaryFixture("expressions-");

    for (const command of [
      "rg 'foo$' src",
      "grep -rn 'bar$' src",
      "sed -n '/foo$/p' package.json",
      "awk '{print $1}' package.json",
      "sed -nf script.sed package.json",
    ]) {
      expect([command, verdict(command, root)]).toEqual([command, "allow"]);
    }
  });

  it("still blocks outside paths on read commands that carry expression arguments", async () => {
    const { root } = await boundaryFixture("expression-escapes-");

    for (const command of [
      "rg 'x' /etc/hosts",
      "cat ../secret",
      "awk '{print}' /etc/passwd",
      "sed -n '/foo$/p' /etc/hosts",
    ]) {
      expect([command, verdict(command, root)]).toEqual([command, "block"]);
    }
  });

  it("resolves symlink components before collapsing parent segments", async () => {
    const { root } = await boundaryFixture("symlink-order-");

    for (const command of [
      "cat escape/secret",
      "cat escape/../secret",
      "cat ./escape/../secret",
      "cat escape/../../etc/hosts",
    ]) {
      expect([command, verdict(command, root)]).toEqual([command, "block"]);
    }
  });

  it("exempts only known non-file URI schemes", async () => {
    const { root } = await boundaryFixture("uri-schemes-");

    expect(verdict("curl https://example.com", root)).toBe("allow");
    expect(verdict("cat x://../../etc/hosts", root)).toBe("block");
  });

  it("inspects reader attached path options", async () => {
    const { root } = await boundaryFixture("attached-options-");

    expect(verdict("sed -f/etc/passwd package.json", root)).toBe("block");
    expect(verdict("awk -f/etc/passwd", root)).toBe("block");
    expect(verdict("sed -nf script.sed package.json", root)).toBe("allow");
  });

  it("limits structured path inspection to local filesystem tools", async () => {
    const { root } = await boundaryFixture("structured-tools-");

    expect(
      evaluateRepositoryBoundary(
        { cwd: root, tool_input: { path: "/v1/items" }, tool_name: "mcp__example__list" },
        { root }
      )
    ).toEqual({ action: "allow" });

    expect(
      evaluateRepositoryBoundary(
        { cwd: root, tool_input: { file_path: "/etc/hosts" }, tool_name: "Read" },
        { root }
      ).action
    ).toBe("block");
  });
});

describe("active-branch policy", () => {
  const sourceOptions = {
    blockAllWorktrees: true,
    enforceActiveBranch: true,
  };

  it("allows the Rule 21 branch forms on command shape alone", () => {
    expect(
      evaluateBashPolicy(bashPayload("git branch -D feature/demo"), {}, sourceOptions).action
    ).toBe("allow");
    expect(
      evaluateBashPolicy(bashPayload("git switch -c feature/demo origin/main"), {}, sourceOptions)
        .action
    ).toBe("allow");
    expect(
      evaluateBashPolicy(bashPayload("git switch --track origin/feature/demo"), {}, sourceOptions)
        .action
    ).toBe("allow");
    expect(evaluateBashPolicy(bashPayload("git switch main"), {}, sourceOptions).action).toBe(
      "allow"
    );
  });

  it("still blocks branch forms outside the Rule 21 shapes", () => {
    expect(evaluateBashPolicy(bashPayload("git branch -D main"), {}, sourceOptions).action).toBe(
      "block"
    );
    expect(evaluateBashPolicy(bashPayload("git branch -D one two"), {}, sourceOptions).action).toBe(
      "block"
    );
    expect(
      evaluateBashPolicy(bashPayload("git branch feature/demo"), {}, sourceOptions).action
    ).toBe("block");
    expect(
      evaluateBashPolicy(bashPayload("git switch -C feature/demo origin/main"), {}, sourceOptions)
        .action
    ).toBe("block");
  });

  it("blocks every worktree command and active-branch bypass in source mode", () => {
    expect(
      evaluateBashPolicy(bashPayload("git worktree list --porcelain -z"), {}, sourceOptions).action
    ).toBe("block");
    expect(
      evaluateBashPolicy(bashPayload("git update-ref refs/heads/demo HEAD"), {}, sourceOptions)
        .action
    ).toBe("block");
    expect(evaluateBashPolicy(bashPayload("gh pr checkout 123"), {}, sourceOptions).action).toBe(
      "block"
    );
  });
});

describe("registered repository boundary hooks", () => {
  it("denies outside paths through the real Claude and generated Codex entrypoints", async () => {
    const stateDir = await fixtureRoot("entrypoint-state-");
    const runtimeScripts: [string, string][] = [
      ["Claude", ".claude/hooks/context-pre-tool-use.mjs"],
      ["Codex", ".codex/hooks/context-pre-tool-use.mjs"],
    ];
    for (const [runtime, script] of runtimeScripts) {
      const result = await runHook(
        script,
        preToolPayload("Read", { file_path: "/etc/hosts" }, `outside-${runtime}`),
        stateDir
      );
      expect(result.code, runtime).toBe(0);
      expect(denial(result.stdout), runtime).toContain("repository boundary violation");
    }
  });

  it("blocks Claude WorktreeCreate and fails closed on malformed input", async () => {
    const stateDir = await fixtureRoot("worktree-state-");
    const script = ".claude/hooks/context-worktree-create.mjs";
    const blocked = await runHook(
      script,
      {
        cwd: repositoryRoot,
        hook_event_name: "WorktreeCreate",
        session_id: "worktree-create",
      },
      stateDir
    );
    expect(blocked.code).toBe(2);
    expect(blocked.stderr).toContain("worktree creation is prohibited");

    const malformed = await runHook(script, {}, stateDir, "{not-json");
    expect(malformed.code).toBe(2);
    expect(malformed.stderr).toContain("Agent hook failed closed");
  });

  it("allows approved branch shapes under a prompt that never mentions branches, and denies force-create under a prompt that asks for a branch", async () => {
    const stateDir = await fixtureRoot("branch-state-");
    const promptScript = ".claude/hooks/context-user-prompt-submit.mjs";
    const preToolScript = ".claude/hooks/context-pre-tool-use.mjs";

    const cases: [string, string, string, boolean][] = [
      [
        "shape-allowed",
        "Stay on the active branch. Do not switch branches.",
        "git switch -c feature/demo origin/main",
        false,
      ],
      ["shape-allowed-delete", "Tidy up after the merge.", "git branch -D feature/demo", false],
      [
        "shape-denied",
        "Create a new branch for this change.",
        "git switch -C feature/demo origin/main",
        true,
      ],
    ];
    for (const [sessionId, prompt, command, expectedDenial] of cases) {
      const promptResult = await runHook(
        promptScript,
        {
          cwd: repositoryRoot,
          hook_event_name: "UserPromptSubmit",
          prompt,
          session_id: sessionId,
        },
        stateDir
      );
      expect(promptResult.code).toBe(0);

      const result = await runHook(
        preToolScript,
        preToolPayload("Bash", { command }, sessionId),
        stateDir
      );
      expect(result.code).toBe(0);
      if (expectedDenial) {
        expect(denial(result.stdout)).toContain("git switch is limited to");
      } else {
        expect(result.stdout).toBe("");
      }
    }
  });
});
