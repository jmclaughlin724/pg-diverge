import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  check,
  hookImportGraph,
} from "../../scripts/guards/agent-surface/check-hook-import-graph.mjs";

describe("hook import graph", () => {
  it("maps multiline imports, re-exports, literal dynamic imports, and builtins", async () => {
    const root = await mkdtemp(join(tmpdir(), "supa-hook-import-graph-"));
    await write(
      root,
      ".claude/hooks/example.mjs",
      [
        'import fs from "node:fs";',
        "import {",
        "  shared,",
        '} from "../../scripts/agent-hooks/shared.mjs";',
        'export { lazy } from "./lazy.mjs";',
        'await import("./dynamic.mjs");',
        "void fs;",
        "void shared;",
        "",
      ].join("\n")
    );
    await write(root, ".claude/hooks/lazy.mjs", "export const lazy = true;\n");
    await write(root, ".claude/hooks/dynamic.mjs", "export const dynamic = true;\n");
    await write(root, "scripts/agent-hooks/shared.mjs", "export const shared = true;\n");

    const graph = hookImportGraph(root);

    expect(graph).toHaveLength(4);
    expect(graph).toEqual(
      expect.arrayContaining([
        {
          file: ".claude/hooks/example.mjs",
          kind: "builtin",
          specifier: "node:fs",
        },
        {
          file: ".claude/hooks/example.mjs",
          kind: "relative",
          specifier: "../../scripts/agent-hooks/shared.mjs",
          target: "scripts/agent-hooks/shared.mjs",
        },
        {
          file: ".claude/hooks/example.mjs",
          kind: "relative",
          specifier: "./dynamic.mjs",
          target: ".claude/hooks/dynamic.mjs",
        },
        {
          file: ".claude/hooks/example.mjs",
          kind: "relative",
          specifier: "./lazy.mjs",
          target: ".claude/hooks/lazy.mjs",
        },
      ])
    );
    expect(() => check(root)).not.toThrow();
  });

  it("rejects missing relative and bare runtime dependencies", async () => {
    const missingRoot = await mkdtemp(join(tmpdir(), "supa-hook-import-missing-"));
    await write(missingRoot, ".claude/hooks/example.mjs", 'import "./missing.mjs";\n');
    expect(() => check(missingRoot)).toThrow(
      ".claude/hooks/example.mjs imports missing relative hook dependency ./missing.mjs"
    );

    const bareRoot = await mkdtemp(join(tmpdir(), "supa-hook-import-bare-"));
    await write(bareRoot, ".claude/hooks/example.mjs", 'import "zod";\n');
    expect(() => check(bareRoot)).toThrow(
      ".claude/hooks/example.mjs imports non-runtime-safe module zod"
    );
  });

  it("inspects the first argument of dynamic imports with options", async () => {
    const root = await mkdtemp(join(tmpdir(), "supa-hook-import-options-"));
    await write(
      root,
      ".claude/hooks/example.mjs",
      'await import("./dynamic.mjs", { with: { type: "json" } });\n'
    );
    await write(root, ".claude/hooks/dynamic.mjs", "export const dynamic = true;\n");

    expect(hookImportGraph(root)).toContainEqual({
      file: ".claude/hooks/example.mjs",
      kind: "relative",
      specifier: "./dynamic.mjs",
      target: ".claude/hooks/dynamic.mjs",
    });
  });

  it("rejects fake node-prefixed builtin specifiers", async () => {
    const root = await mkdtemp(join(tmpdir(), "supa-hook-import-builtin-"));
    await write(root, ".claude/hooks/example.mjs", 'import "node:not-a-real-builtin";\n');

    expect(() => check(root)).toThrow(
      ".claude/hooks/example.mjs imports unknown Node builtin node:not-a-real-builtin"
    );
  });

  it("transitively inspects reachable helpers outside hook roots", async () => {
    const root = await mkdtemp(join(tmpdir(), "supa-hook-import-transitive-"));
    await write(root, ".claude/hooks/example.mjs", 'import "../../shared/helper.mjs";\n');
    await write(root, "shared/helper.mjs", 'import "zod";\n');

    expect(() => check(root)).toThrow("shared/helper.mjs imports non-runtime-safe module zod");
  });

  it("terminates on cycles in the reachable helper graph", async () => {
    const root = await mkdtemp(join(tmpdir(), "supa-hook-import-cycle-"));
    await write(root, ".claude/hooks/example.mjs", 'import "../../shared/helper.mjs";\n');
    await write(root, "shared/helper.mjs", 'import "../.claude/hooks/example.mjs";\n');

    expect(hookImportGraph(root)).toHaveLength(2);
    expect(() => check(root)).not.toThrow();
  });
});

async function write(root: string, relativePath: string, content: string): Promise<void> {
  const file = join(root, relativePath);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
}
