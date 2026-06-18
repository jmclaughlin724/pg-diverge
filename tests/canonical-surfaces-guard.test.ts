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

  it("blocks DTO facade and view-model code surfaces", () => {
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
  });

  it("blocks duplicate monetization owners outside the Worker and Stripe catalog setup", () => {
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
    expect(result.stderr).toContain("services/license-worker");
  });

  it("blocks duplicate GitHub Marketplace billing owners outside the Worker", () => {
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

  it("allows the canonical Worker Stripe transport owner", () => {
    const cwd = tempGitRepo(
      {},
      {
        "services/license-worker/src/stripe-api.ts":
          "export const endpoint = 'https://api.stripe.com/v1/checkout/sessions';\n",
      }
    );
    const result = spawnSync(process.execPath, ["scripts/guards/check-canonical-surfaces.mjs"], {
      cwd,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("CANONICAL_SURFACES_OK");
  });

  it("allows the canonical Worker to own GitHub Marketplace webhook handling", () => {
    const cwd = tempGitRepo(
      {},
      {
        "services/license-worker/src/index.ts": "export const event = 'marketplace_purchase';\n",
      }
    );
    const result = spawnSync(process.execPath, ["scripts/guards/check-canonical-surfaces.mjs"], {
      cwd,
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("CANONICAL_SURFACES_OK");
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
