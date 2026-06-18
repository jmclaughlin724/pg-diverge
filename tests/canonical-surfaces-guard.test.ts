import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoNodeModules = resolve("node_modules");
const guardIntegrationTimeoutMs = 15_000;

function tempGitRepo(packageJson: unknown, files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "supa-canonical-"));
  mkdirSync(join(dir, "scripts"), { recursive: true });
  cpSync(resolve("scripts/guards"), join(dir, "scripts/guards"), { recursive: true });
  symlinkSync(repoNodeModules, join(dir, "node_modules"), "dir");
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify({ ...objectValue(packageJson), type: "module" })}\n`
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

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(Object.entries(value));
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

  it.each([
    "install",
    "postinstall",
    "preinstall",
    "prepare",
  ])("blocks public package lifecycle script %s", (script) => {
    const cwd = tempGitRepo(
      {
        scripts: { [script]: "node scripts/check.mjs" },
      },
      {
        "scripts/check.mjs": "process.stdout.write('ok\\n');\n",
      }
    );
    const result = spawnSync(process.execPath, ["scripts/guards/check-canonical-surfaces.mjs"], {
      cwd,
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`package script ${script} is a public install lifecycle`);
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

  it("blocks TypeScript assertions in code files", () => {
    const cwd = tempGitRepo(
      {},
      {
        "src/assertion.ts":
          "const raw: unknown = {};\nexport const value = raw as { ok: boolean };\n",
      }
    );
    const result = spawnSync(process.execPath, ["scripts/guards/check-canonical-surfaces.mjs"], {
      cwd,
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("contains a TypeScript assertion");
  });

  it("blocks inline zod enum tuples in code files", () => {
    const cwd = tempGitRepo(
      {},
      {
        "src/schema.ts": "import { z } from 'zod';\nexport const schema = z.enum(['a', 'b']);\n",
      }
    );
    const result = spawnSync(process.execPath, ["scripts/guards/check-canonical-surfaces.mjs"], {
      cwd,
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("contains an inline z.enum tuple");
  });

  it("blocks regex-shaped string contracts in code files", () => {
    const groupStart = ["(", "?", ":"].join("");
    const pattern = ["^", groupStart, "dir:.+", "|empty:", ")", "$"].join("");
    const cwd = tempGitRepo(
      {},
      {
        "src/source-contract.ts": `export const sourceSpecPattern = ${JSON.stringify(pattern)};\n`,
      }
    );
    const result = spawnSync(process.execPath, ["scripts/guards/check-canonical-surfaces.mjs"], {
      cwd,
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("contains a regex-shaped string contract");
  });

  it(
    "blocks comments and regular expression engines in skill reference code",
    () => {
      const cwd = tempGitRepo(
        {},
        {
          ".claude/skills/research/references/workflow.js": "const value = /x/;\n",
          ".agents/skills/research/references/workflow.js":
            "const value = 1;\n// generated mirror must stay clean\n",
        }
      );
      const result = spawnSync(process.execPath, ["scripts/guards/check-canonical-surfaces.mjs"], {
        cwd,
        encoding: "utf8",
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        ".claude/skills/research/references/workflow.js:1:15 contains pattern-engine syntax"
      );
      expect(result.stderr).toContain(
        ".agents/skills/research/references/workflow.js:2:1 contains a line comment"
      );
    },
    guardIntegrationTimeoutMs
  );

  it(
    "blocks DTO facade and view-model code surfaces",
    () => {
      const cwd = tempGitRepo(
        {},
        {
          "src/account-dto.ts": "export const value = 1;\n",
          "src/profile-facade.ts": "export const value = 1;\n",
          "src/user-view-model.ts": "export const value = 1;\n",
        }
      );
      const result = spawnSync(process.execPath, ["scripts/guards/check-canonical-surfaces.mjs"], {
        cwd,
        encoding: "utf8",
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("src/account-dto.ts has a forbidden compatibility");
      expect(result.stderr).toContain("src/profile-facade.ts has a forbidden compatibility");
      expect(result.stderr).toContain("src/user-view-model.ts has a forbidden compatibility");
    },
    guardIntegrationTimeoutMs
  );

  it("blocks public Stripe checkout implementation", () => {
    const cwd = tempGitRepo(
      {},
      {
        "src/marketplace.ts":
          "export const endpoint = 'https://api.stripe.com/v1/checkout/sessions';\n",
      }
    );
    const result = spawnSync(process.execPath, ["scripts/guards/check-canonical-surfaces.mjs"], {
      cwd,
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("contains monetization term");
    expect(result.stderr).toContain("outside the public repository");
  });

  it("blocks public GitHub Marketplace billing implementation", () => {
    const cwd = tempGitRepo(
      {},
      {
        "src/billing.ts": "export const event = 'marketplace_purchase';\n",
      }
    );
    const result = spawnSync(process.execPath, ["scripts/guards/check-canonical-surfaces.mjs"], {
      cwd,
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("contains monetization term marketplace_purchase");
    expect(result.stderr).toContain("GitHub Marketplace");
  });

  it("allows package scripts without recursive force deletion", () => {
    const cwd = tempGitRepo(
      {
        scripts: { lint: "node scripts/check.mjs" },
      },
      {
        "scripts/check.mjs": "process.stdout.write('ok\\n');\n",
      }
    );
    const result = spawnSync(process.execPath, ["scripts/guards/check-canonical-surfaces.mjs"], {
      cwd,
      encoding: "utf8",
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain("CANONICAL_SURFACES_OK");
  });
});
