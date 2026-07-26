import { execFile } from "node:child_process";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateBashPolicy } from "../../.claude/hooks/guards/bash-policy-checks.mjs";
import {
  evaluateRepositoryBoundary,
  promptAuthorizesBranchMutation,
} from "../../scripts/agent-hooks/repository-boundary.mjs";

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

describe("active-branch policy", () => {
  it("requires an explicit, non-conditional branch request in the current prompt", () => {
    expect(promptAuthorizesBranchMutation("Create a new branch for this change.")).toBe(true);
    expect(promptAuthorizesBranchMutation("Switch to the existing feature branch.")).toBe(true);
    expect(
      promptAuthorizesBranchMutation(
        "Create a blocking hook. Stay on the active branch unless told to add or switch branches."
      )
    ).toBe(false);
    expect(promptAuthorizesBranchMutation("Do not create or switch branches.")).toBe(false);
  });

  it("blocks every worktree command and unauthorized branch mutation in source mode", () => {
    const sourceOptions = {
      blockAllWorktrees: true,
      branchMutationAuthorized: false,
      enforceActiveBranch: true,
    };
    expect(
      evaluateBashPolicy(bashPayload("git worktree list --porcelain -z"), {}, sourceOptions).action
    ).toBe("block");
    expect(
      evaluateBashPolicy(bashPayload("git switch -c feature/demo origin/main"), {}, sourceOptions)
        .action
    ).toBe("block");
    expect(
      evaluateBashPolicy(bashPayload("git update-ref refs/heads/demo HEAD"), {}, sourceOptions)
        .action
    ).toBe("block");
    expect(evaluateBashPolicy(bashPayload("gh pr checkout 123"), {}, sourceOptions).action).toBe(
      "block"
    );
    expect(
      evaluateBashPolicy(
        bashPayload("git switch -c feature/demo origin/main"),
        {},
        {
          ...sourceOptions,
          branchMutationAuthorized: true,
        }
      ).action
    ).toBe("allow");
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

  it("uses the current prompt to deny or allow only the approved switch shape", async () => {
    const stateDir = await fixtureRoot("branch-state-");
    const promptScript = ".claude/hooks/context-user-prompt-submit.mjs";
    const preToolScript = ".claude/hooks/context-pre-tool-use.mjs";
    const command = "git switch -c feature/demo origin/main";

    const promptCases: [string, string, boolean][] = [
      ["branch-denied", "Stay on the active branch. Do not switch branches.", true],
      ["branch-allowed", "Create a new branch for this change.", false],
    ];
    for (const [sessionId, prompt, expectedDenial] of promptCases) {
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
        expect(denial(result.stdout)).toContain("not explicitly authorized");
      } else {
        expect(result.stdout).toBe("");
      }
    }
  });
});
