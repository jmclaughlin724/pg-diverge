import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const guardIntegrationTimeoutMs = 20_000;

function tempGitRepo(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "supa-public-surface-"));
  mkdirSync(join(dir, "scripts"), { recursive: true });
  cpSync(resolve("scripts/guards"), join(dir, "scripts/guards"), { recursive: true });
  writeFileSync(join(dir, "package.json"), `${JSON.stringify({ type: "module" })}\n`);
  for (const [file, source] of Object.entries(files)) {
    mkdirSync(join(dir, dirname(file)), { recursive: true });
    writeFileSync(join(dir, file), source);
  }
  execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["add", "package.json", "scripts"], { cwd: dir, stdio: "ignore" });
  return dir;
}

function runGuard(cwd: string) {
  return spawnSync(process.execPath, ["scripts/guards/check-public-repo-surface.mjs"], {
    cwd,
    encoding: "utf8",
  });
}

describe("public repo surface guard", { timeout: guardIntegrationTimeoutMs }, () => {
  it(
    "allows ignored private local skills to remain on disk",
    () => {
      const cwd = tempGitRepo({
        ".gitignore": ".agents/skills/*\n",
        ".agents/skills/elegant/SKILL.md": "# elegant\n",
      });
      const result = runGuard(cwd);
      expect(result.status, result.stderr || result.stdout).toBe(0);
      expect(result.stdout).toContain("PUBLIC_REPO_SURFACE_OK");
    },
    guardIntegrationTimeoutMs
  );

  it("allows reviewed source-repo hook runtime surfaces", () => {
    const cwd = tempGitRepo({
      ".claude/settings.json": "{}\n",
      ".claude/hooks/context-pre-tool-use.mjs": "export {};\n",
      ".claude/hooks/supaschema-source-hook.mjs": "export {};\n",
      ".claude/rules/22-agent-surface-sync-ownership.md": "# Rule 22\n",
      ".codex/hooks/context-pre-tool-use.mjs": "export {};\n",
      ".codex/hooks/supaschema-source-hook.mjs": "export {};\n",
      ".codex/rules/22-agent-surface-sync-ownership.rules": "# Rule 22\n",
      "scripts/agent-hooks/runner.mjs": "export {};\n",
    });
    const result = runGuard(cwd);
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain("PUBLIC_REPO_SURFACE_OK");
  });

  it("blocks unreviewed source-repo hook runtime files", () => {
    const cwd = tempGitRepo({
      "scripts/agent-hooks/local-debug.mjs": "export {};\n",
    });
    const result = runGuard(cwd);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("tracked public GitHub exposure");
    expect(result.stderr).toContain("scripts/agent-hooks/local-debug.mjs");
  });

  it("blocks unignored private local skills before they can be staged", () => {
    const cwd = tempGitRepo({
      ".agents/skills/elegant/SKILL.md": "# elegant\n",
    });
    const result = runGuard(cwd);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unignored local files that could be staged");
    expect(result.stderr).toContain(".agents/skills/elegant/SKILL.md");
    expect(result.stderr).toContain("add or repair .gitignore coverage");
  });

  it("blocks tracked private local skills with an untrack-only repair", () => {
    const cwd = tempGitRepo({
      ".agents/skills/elegant/SKILL.md": "# elegant\n",
    });
    execFileSync("git", ["add", ".agents/skills/elegant/SKILL.md"], {
      cwd,
      stdio: "ignore",
    });
    const result = runGuard(cwd);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("tracked public GitHub exposure");
    expect(result.stderr).toContain("git rm --cached -- <path>");
    expect(result.stderr).toContain("do not delete local skills, agents, rules, or hooks");
  });
});
