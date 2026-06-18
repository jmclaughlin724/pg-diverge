import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);
const npmExec = (args: string[]): { file: string; args: string[] } => {
  const execpath = process.env.npm_execpath;
  return execpath
    ? { file: process.execPath, args: [execpath, ...args] }
    : { file: process.platform === "win32" ? "npm.cmd" : "npm", args };
};

function packageBinPath(): string {
  const manifest: unknown = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../package.json"), "utf8")
  );
  if (!manifest || typeof manifest !== "object") {
    throw new Error("package.json must be an object");
  }
  const bin = Reflect.get(manifest, "bin");
  if (!bin || typeof bin !== "object") {
    throw new Error("package.json must define bin");
  }
  const supaschema = Reflect.get(bin, "supaschema");
  if (typeof supaschema !== "string") {
    throw new Error("package.json must define bin.supaschema");
  }
  return supaschema;
}

describe("npm package contents", () => {
  it("keeps the generated install-time config contract executable", async () => {
    const mirror = await import(
      pathToFileURL(resolve(import.meta.dirname, "../bin/config-contract.mjs")).href
    );

    expect(mirror.configSchemaFileName).toBe("supaschema-config.schema.json");
    expect(mirror.createInstalledConfig()).toMatchObject({
      adapter: "auto",
      managedSchemas: [],
      schemaPaths: ["database/schemas"],
      sources: {
        from: "auto",
        to: "dir:database/schemas",
      },
    });
  });

  it("ships the necessary surface and no build-cache, source, or tooling leaks", {
    timeout: 60_000,
  }, async () => {
    const { file, args } = npmExec(["pack", "--dry-run", "--json", "--ignore-scripts"]);
    const { stdout } = await run(file, args, { maxBuffer: 32 * 1024 * 1024 });
    const [packed] = JSON.parse(stdout);
    const paths = packed.files.map((file) => file.path);
    const readmes = paths.filter((path) => path.endsWith("README.md")).sort();
    expect(readmes, "only the root README should ship").toEqual(["README.md"]);

    const required = [
      "dist/cli.js",
      "dist/index.js",
      "dist/index.d.ts",
      packageBinPath(),
      "bin/scaffold.mjs",
      "bin/config-contract.mjs",
      "supaschema-config.schema.json",
      ".agents/prompts/supaschema-install.md",
      ".agents/skills/supaschema/SKILL.md",
      ".claude/hooks/guards/bash-policy-checks.mjs",
      ".claude/hooks/sync-llm-on-claude-surface-change.mjs",
      ".claude/rules/supaschema.md",
      ".claude/skills/supaschema/SKILL.md",
      ".codex/hooks/general-guard.mjs",
      ".codex/hooks/guards/bash-policy-checks.mjs",
      ".codex/hooks/sync-llm-on-claude-surface-change.mjs",
      ".codex/hooks.json",
      ".codex/rules/supaschema.rules",
      "README.md",
      "LICENSE",
      "LICENSE-COMMERCIAL.md",
    ];
    for (const entry of required) {
      expect(paths, `missing required package file: ${entry}`).toContain(entry);
    }
    expect(paths, "legacy extensionless bin wrapper must not ship").not.toContain("bin/supaschema");
    expect(paths, "postinstall lifecycle setup must not ship").not.toContain("bin/postinstall.mjs");
    const forbiddenInternalAgentPrefixes = [
      ".claude/hooks/context-",
      ".codex/hooks/context-",
      "scripts/agent-hooks/",
    ];
    const internalAgentLeaks = paths.filter((path) =>
      forbiddenInternalAgentPrefixes.some((prefix) => path.startsWith(prefix))
    );
    expect(
      internalAgentLeaks,
      `internal repo-only agent files reached npm tarball: ${internalAgentLeaks.join(", ")}`
    ).toEqual([]);
    expect(paths, "pack should include consumer Codex hook registration").toContain(
      ".codex/hooks.json"
    );
    const codexHookContents = readFileSync(
      resolve(import.meta.dirname, "../.codex/hooks.json"),
      "utf8"
    );
    expect(codexHookContents).not.toContain("context-");
    expect(codexHookContents).not.toContain("scripts/agent-hooks");
    expect(codexHookContents).toContain("general-guard.mjs");
    expect(codexHookContents).toContain("supaschema hook generated-migration-edit");
    expect(codexHookContents).toContain("supaschema hook schema-write");
    expect(codexHookContents).not.toContain("npx --no-install");
    expect(
      paths.filter((path) => path.startsWith(".codex/skills/")),
      "Codex skill duplicates must not ship"
    ).toEqual([]);
    expect(paths, "config-schema.json must not ship").not.toContain("config-schema.json");

    const forbiddenPrefixes = [
      "benchmarks/",
      "corpus/",
      "docs/",
      "examples/",
      "scripts/",
      "services/",
      "skills/",
      "src/",
      "tests/",
    ];
    const isLeak = (path: string): boolean =>
      path.endsWith(".tsbuildinfo") ||
      path.endsWith(".tgz") ||
      path === ".env" ||
      path.startsWith(".env.") ||
      forbiddenPrefixes.some((prefix) => path.startsWith(prefix)) ||
      path.startsWith("node_modules/");
    const leaks = paths.filter(isLeak);
    expect(leaks, `unexpected files in npm tarball: ${leaks.join(", ")}`).toEqual([]);
    expect(packed.unpackedSize, `npm tarball unpacked bytes: ${packed.unpackedSize}`).toBeLessThan(
      1_500_000
    );
  });
});
