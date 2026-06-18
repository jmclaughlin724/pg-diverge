import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoNodeModules = resolve("node_modules");

function tempGitRepo(packageJson: unknown, files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "supa-canonical-"));
  mkdirSync(join(dir, "scripts"), { recursive: true });
  cpSync(resolve("scripts/guards"), join(dir, "scripts/guards"), { recursive: true });
  symlinkSync(repoNodeModules, join(dir, "node_modules"), "dir");
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify({ ...(packageJson as Record<string, unknown>), type: "module" })}\n`
  );
  for (const [file, source] of Object.entries(files)) {
    mkdirSync(join(dir, dirname(file)), { recursive: true });
    writeFileSync(join(dir, file), source);
  }
  execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["add", "package.json", "scripts", ...Object.keys(files)], {
    cwd: dir,
    stdio: "ignore",
  });
  return dir;
}

describe("canonical surfaces guard", () => {
  it("blocks recursive force deletion in package scripts", () => {
    const cwd = tempGitRepo({
      scripts: { clean: "rm -rf dist" },
    });
    const result = spawnSync(process.execPath, ["scripts/guards/check-canonical-surfaces.mjs"], {
      cwd,
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("package script clean uses recursive force deletion");
  });

  it("blocks comments in code files", () => {
    const cwd = tempGitRepo(
      {},
      {
        "src/commented.ts": "const value = 1;\n// explain elsewhere\n",
      }
    );
    const result = spawnSync(process.execPath, ["scripts/guards/check-canonical-surfaces.mjs"], {
      cwd,
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("contains a line comment");
  });

  it("blocks regular expression engines in code files", () => {
    const cwd = tempGitRepo(
      {},
      {
        "scripts/pattern.mjs": "const pattern = new RegExp('x');\npattern.test('x');\n",
      }
    );
    const result = spawnSync(process.execPath, ["scripts/guards/check-canonical-surfaces.mjs"], {
      cwd,
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("contains pattern-engine syntax");
  });

  it("allows package scripts without recursive force deletion", () => {
    const cwd = tempGitRepo({
      scripts: { lint: "node scripts/check.mjs" },
    });
    const result = spawnSync(process.execPath, ["scripts/guards/check-canonical-surfaces.mjs"], {
      cwd,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("CANONICAL_SURFACES_OK");
  });
});
