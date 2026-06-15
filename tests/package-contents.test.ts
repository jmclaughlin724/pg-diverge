import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";

// Locks the npm publish boundary (package.json `files`) described in
// docs/reference/package-boundary.mdx. The dry-run tarball is the authoritative
// preview of what `npm publish` ships. This guards two things:
//   1. the necessary runtime + installer surface stays present, and
//   2. build caches, sources, maintainer tooling, and secrets never leak in.
// docs/, examples/, benchmarks/, and corpus/ are intentional "public-support
// assets" per the boundary policy and are therefore NOT treated as leaks.
describe("npm package contents", () => {
  it("ships the necessary surface and no build-cache, source, or tooling leaks", {
    timeout: 60_000,
  }, async () => {
    const { stdout } = await run(npmBin, ["pack", "--dry-run", "--json", "--ignore-scripts"], {
      maxBuffer: 32 * 1024 * 1024,
    });
    const [packed] = JSON.parse(stdout) as { files: { path: string }[] }[];
    const paths = packed.files.map((file) => file.path);

    const required = [
      "dist/cli.js",
      "dist/index.js",
      "dist/index.d.ts",
      "bin/supaschema",
      "bin/postinstall.mjs",
      "config-schema.json",
      ".agents/skills/supaschema/SKILL.md",
      ".claude/hooks/auto-diff-on-schema-change.mjs",
      ".claude/hooks/block-generated-migration-edits.mjs",
      ".claude/rules/supaschema.md",
      ".claude/skills/supaschema/SKILL.md",
      ".codex/hooks/auto-diff-on-schema-change.mjs",
      ".codex/hooks/supaschema-tool-gate.mjs",
      ".codex/hooks.json",
      ".codex/rules/supaschema.rules",
      ".codex/skills/supaschema/SKILL.md",
      "README.md",
      "LICENSE",
      "LICENSE-COMMERCIAL.md",
    ];
    for (const entry of required) {
      expect(paths, `missing required package file: ${entry}`).toContain(entry);
    }

    const isLeak = (path: string): boolean =>
      path.endsWith(".tsbuildinfo") ||
      path.endsWith(".tgz") ||
      path === ".env" ||
      path.startsWith(".env.") ||
      path.startsWith("src/") ||
      path.startsWith("tests/") ||
      path.startsWith("services/") ||
      path.startsWith("scripts/") ||
      path.startsWith("node_modules/");
    const leaks = paths.filter(isLeak);
    expect(leaks, `unexpected files in npm tarball: ${leaks.join(", ")}`).toEqual([]);
  });
});
