import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderCodexAgent, renderCodexRule } from "../../scripts/skills/codex-rules.mjs";
import { checkAgentSurfaces, syncAgentSurfaces } from "../../scripts/skills/sync-llm.mjs";

describe("agent surface sync", { timeout: 30_000 }, () => {
  it("passes when generated mirrors match the Claude-owned directories", async () => {
    const root = await seedSurfaceRoot();
    syncAgentSurfaces({ root });

    expect(checkAgentSurfaces({ root })).toEqual([]);
  });

  it("reports missing, drifted, and unmanaged mirror files", async () => {
    const root = await seedSurfaceRoot();
    syncAgentSurfaces({ root });
    await rm(join(root, ".agents/skills/supaschema/SKILL.md"));
    await write(root, ".agents/skills/supaschema/extra.md", "extra\n");
    await write(root, ".agents/skills/upstream/SKILL.md", "drift\n");

    const errors = checkAgentSurfaces({ root });

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("mirror .agents/skills missing files: supaschema/SKILL.md"),
        expect.stringContaining("mirror .agents/skills has unmanaged files: supaschema/extra.md"),
        expect.stringContaining("mirror drifted for .agents/skills: upstream/SKILL.md"),
      ])
    );
  });

  it("rewrites skills, hooks, Codex agents, and Codex rules from Claude sources", async () => {
    const root = await seedSurfaceRoot();
    syncAgentSurfaces({ root });
    await write(root, ".agents/skills/upstream/extra.md", "extra\n");
    await write(root, ".codex/hooks/stale.mjs", "stale\n");
    await write(root, ".codex/agents/stale.toml", 'name = "stale"\n');
    await write(root, ".codex/rules/stale.rules", "# stale\n");
    await write(root, "skills/supaschema/stale.md", "stale\n");

    const result = syncAgentSurfaces({ root });

    expect(result).toMatchObject({
      agentBundle: 19,
      agents: 2,
      codexHookConfig: 1,
      hooks: 5,
      publicSkills: 2,
      rules: 2,
      skills: 3,
      skillTargets: 1,
    });
    expect(checkAgentSurfaces({ root })).toEqual([]);
    expect(existsSync(join(root, ".agents/skills/upstream/extra.md"))).toBe(false);
    expect(existsSync(join(root, ".codex/hooks/stale.mjs"))).toBe(false);
    expect(existsSync(join(root, ".codex/agents/stale.toml"))).toBe(false);
    expect(existsSync(join(root, ".codex/rules/stale.rules"))).toBe(false);
    expect(existsSync(join(root, "skills/supaschema/stale.md"))).toBe(false);
    expect(await readFile(join(root, "skills/supaschema/SKILL.md"), "utf8")).toBe(
      "supaschema skill\n"
    );
    expect(await readFile(join(root, ".codex/hooks/sample-hook.mjs"), "utf8")).toBe(
      await readFile(join(root, ".claude/hooks/sample-hook.mjs"), "utf8")
    );
    expect(await readFile(join(root, ".codex/agents/database.toml"), "utf8")).toContain(
      'name = "database"'
    );
    expect(await readFile(join(root, ".codex/rules/supaschema.rules"), "utf8")).toContain(
      "Canonical rule owner: .claude/rules/supaschema.md"
    );
  });

  it("detects and repairs generated Codex hook config drift", async () => {
    const root = await seedSurfaceRoot();
    syncAgentSurfaces({ root });
    await write(root, ".codex/hooks.json", `${JSON.stringify({ hooks: { Stop: [] } }, null, 2)}\n`);

    expect(checkAgentSurfaces({ root })).toEqual(
      expect.arrayContaining(["generated Codex hook config drifted: .codex/hooks.json"])
    );

    const result = syncAgentSurfaces({ root });

    expect(result.codexHookConfig).toBe(1);
    expect(checkAgentSurfaces({ root })).toEqual([]);
    expect(await readFile(join(root, ".codex/hooks.json"), "utf8")).toContain("context-stop.mjs");
  });

  it("reconciles minimal Claude source directories into generated mirrors", async () => {
    const root = await mkdtemp(join(tmpdir(), "supa-agent-surfaces-empty-"));
    await seedRequiredAgentBundleInputs(root);
    await mkdir(join(root, ".claude/agents"), { recursive: true });

    const result = syncAgentSurfaces({ root });

    expect(result).toMatchObject({
      agentBundle: 19,
      agents: 0,
      codexHookConfig: 1,
      hooks: 3,
      publicSkills: 1,
      rules: 1,
      skills: 1,
      skillTargets: 1,
    });
    expect(existsSync(join(root, ".agents/skills"))).toBe(true);
    expect(existsSync(join(root, ".codex/skills"))).toBe(false);
    expect(existsSync(join(root, "skills/supaschema"))).toBe(true);
    expect(existsSync(join(root, ".codex/hooks"))).toBe(true);
    expect(existsSync(join(root, ".codex/agents"))).toBe(true);
    expect(existsSync(join(root, ".codex/rules"))).toBe(true);
    expect(checkAgentSurfaces({ root })).toEqual([]);
  });

  it("does not follow pre-existing temp-file symlinks while syncing mirrors", async () => {
    if (process.platform === "win32") {
      return;
    }

    const root = await seedSurfaceRoot();
    const targetDir = join(root, ".agents/skills/supaschema");
    await mkdir(targetDir, { recursive: true });
    const sentinel = join(root, "sentinel.txt");
    await writeFile(sentinel, "keep\n");

    const timestamp = 1_234_567_890;
    const tempCandidate = join(targetDir, `.SKILL.md.${process.pid}.${timestamp}.tmp`);
    await symlink(sentinel, tempCandidate);

    const originalNow = Date.now;
    Date.now = () => timestamp;
    try {
      syncAgentSurfaces({ root });
    } finally {
      Date.now = originalNow;
    }

    expect(await readFile(sentinel, "utf8")).toBe("keep\n");
    expect(await readFile(join(targetDir, "SKILL.md"), "utf8")).toBe("supaschema skill\n");
  });

  it("renders Claude agents as Codex custom-agent TOML", () => {
    const rendered = renderCodexAgent(
      `---
name: code-reviewer
description: |
  Review code for correctness.
tools: Read, Grep, Glob, Bash
---

# Code Reviewer

Review like an owner.
`,
      ".claude/agents/code-reviewer.md"
    );

    expect(rendered).toContain('name = "code-reviewer"');
    expect(rendered).toContain('description = "Review code for correctness."');
    expect(rendered).toContain('sandbox_mode = "read-only"');
    expect(rendered).toContain(
      'developer_instructions = "# Code Reviewer\\n\\nReview like an owner."'
    );
  });

  it("renders wildcard Claude agents as writable Codex custom agents", () => {
    const rendered = renderCodexAgent(
      `---
name: worker
description: Execute autonomous worker tasks.
tools: "*"
---

Work directly.
`,
      ".claude/agents/worker.md"
    );

    expect(rendered).toContain('sandbox_mode = "workspace-write"');
  });

  it("renders Claude rule command policy as Codex prefix rules", () => {
    const rendered = renderCodexRule(
      `---
codexExecPolicy: |
  [
    {
      "pattern": ["git", "checkout"],
      "decision": "forbidden",
      "justification": "Use git switch instead.",
      "match": ["git checkout main"],
      "not_match": ["git switch main"]
    }
  ]
---

# Supaschema Rule

- Keep migrations replay-safe.
`,
      ".claude/rules/supaschema.md"
    );

    expect(rendered).toContain("# Generated by npm run sync:llm from .claude/rules/supaschema.md.");
    expect(rendered).toContain('pattern = ["git", "checkout"]');
    expect(rendered).toContain('decision = "forbidden"');
    expect(rendered).toContain('match = ["git checkout main"]');
    expect(rendered).not.toContain("# - Keep migrations replay-safe.");
  });
});

async function seedSurfaceRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "supa-agent-surfaces-"));
  await seedRequiredAgentBundleInputs(root);
  await write(root, ".claude/skills/supaschema/references/workflow.md", "workflow\n");
  await write(root, ".claude/skills/upstream/SKILL.md", "upstream skill\n");
  await write(root, ".claude/hooks/sample-hook.mjs", "sample hook\n");
  await write(root, ".claude/hooks/sample-hook-extra.mjs", "sample hook extra\n");
  await write(root, ".claude/rules/operating.md", "# Operating Rule\n");
  await write(
    root,
    ".claude/agents/database.md",
    `---
name: database
description: Database agent
tools: Read, Write, Edit, Grep, Glob, Bash
---

# Database

Work on database behavior.
`
  );
  await write(
    root,
    ".claude/agents/code-reviewer.md",
    `---
name: code-reviewer
description: Review code
tools: Read, Grep, Glob, Bash
---

# Code Reviewer

Review code.
`
  );
  return root;
}

async function seedRequiredAgentBundleInputs(root: string): Promise<void> {
  await write(root, "agent-bundle/INSTALL.md", "install\n");
  await write(root, ".agents/prompts/supaschema-install.md", "install prompt\n");
  await write(root, ".claude/skills/supaschema/SKILL.md", "supaschema skill\n");
  await write(root, ".claude/hooks/general-guard.mjs", "general guard\n");
  await write(root, ".claude/hooks/guards/bash-policy-checks.mjs", "bash guard\n");
  await write(root, ".claude/hooks/sync-llm-on-claude-surface-change.mjs", "sync hook\n");
  await write(root, ".claude/rules/supaschema.md", "# Supaschema Rule\n");
  await write(root, ".codex/hooks.json", "{}\n");
  await write(root, ".codex/hooks/general-guard.mjs", "general guard\n");
}

async function write(root: string, relativePath: string, text: string): Promise<void> {
  const file = join(root, relativePath);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, text);
}
